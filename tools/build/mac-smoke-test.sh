#!/usr/bin/env bash
# Smoke tests for the macOS build, standing in for a person at a Mac. Run by
# .github/workflows/mac-build.yml after each step it checks:
#
#   tools/build/mac-smoke-test.sh bundle   after assemble-bundle.sh: the bundled
#                                          interpreter starts the backend the way
#                                          electron.js does and it answers
#   tools/build/mac-smoke-test.sh app      after yarn dist:mac:<arch>: the
#                                          packaged app is signed, starts its own
#                                          backend, and leaves nothing running
#                                          once it quits
#
# What it cannot check is anything on screen (rendering, dialogs, Finder).
set -euo pipefail

MODE="${1:-}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${MRLATTE_BUILD_DIR:-$(dirname "$REPO_ROOT")/MRLatte-build}"
PORT="${MRLATTE_SMOKE_PORT:-8011}"

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
pass() { echo "  ok  $*"; }

# Polls a URL until it answers 200, for up to $2 seconds.
wait_http() {
  local url="$1" secs="$2" i=0
  while [ "$i" -lt "$secs" ]; do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then return 0; fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

json_get() {  # json-file python-expression-on-d
  "$PYJ" -c "import json,sys; d=json.load(open(sys.argv[1])); print($2)" "$1"
}

case "$MODE" in
bundle)
  RES="$OUT_DIR/MRLatte"
  PY="$RES/python/bin/python3.11"
  PYJ="$PY"
  [ -x "$PY" ] || fail "no bundled interpreter at $PY"
  [ -x "$RES/dcm2niix/dcm2niix" ] || fail "no dcm2niix in the bundle"
  # A worker starts as a bare `python3.11 worker.py`, with no bootstrap: it
  # must find numpy and the shared worker module on its own.
  ( cd "$RES/backend" && "$PY" -c "import numpy, nibabel, worker_common" ) \
    || fail "a bare interpreter (as the analysis workers start) can't import numpy / worker_common"
  pass "analysis workers can import numpy"
  DATA="$(mktemp -d)"
  # What electron.js's seedModules leaves in a fresh module root.
  mkdir -p "$DATA/modules"
  cp "$RES/modules/manifest.json" "$DATA/modules/"
  [ -f "$RES/modules/atlas-catalog.json" ] && cp "$RES/modules/atlas-catalog.json" "$DATA/modules/"
  for s in tracts lnm; do mkdir -p "$DATA/modules/$s"; cp "$RES/modules/$s/README.txt" "$DATA/modules/$s/"; done
  # Same environment and bootstrap as electron.js startBackend().
  env STATIC_DIR="$RES/frontend_build" MRLATTE_MODULE_ROOT="$DATA/modules" \
    MRLATTE_BUNDLED_MODULES="$RES/modules" \
    TRACT_RESULTS_DIR="$DATA/tract_results" ROI_RESULTS_DIR="$DATA/roi_results" \
    DICOM_RESULTS_DIR="$DATA/dicom_results" LNM_RESULTS_DIR="$DATA/lnm_results" \
    SUMMARY_RESULTS_DIR="$DATA/summary_results" \
    PATH="$RES/dcm2niix:$PATH" PYTHONUNBUFFERED=1 \
    "$PY" -c "import sys, os; sys.path.insert(0, r'$RES/python/site-packages'); sys.path.insert(0, r'$RES/backend'); os.chdir(r'$RES/backend'); import uvicorn; uvicorn.run('server:app', host='127.0.0.1', port=$PORT)" \
    > "$DATA/backend.log" 2>&1 &
  BPID=$!
  trap 'kill $BPID 2>/dev/null || true' EXIT
  if ! wait_http "http://127.0.0.1:$PORT/api/" 120; then
    cat "$DATA/backend.log"; fail "the bundled backend did not answer /api/ within 120 s"
  fi
  pass "bundled backend answers /api/"
  curl -fsS "http://127.0.0.1:$PORT/" | grep -q "MRLatte" || fail "/ does not serve the MRLatte page"
  pass "serves the interface"
  curl -fsS "http://127.0.0.1:$PORT/api/modules" > "$DATA/modules.json"
  # Every module the installer ships is seeded, hash-checked: a file whose
  # bytes don't match its pin (e.g. line endings) leaves its module out.
  NOT_SEEDED="$(json_get "$DATA/modules.json" "' '.join(m['id'] for m in d['modules'] if m.get('bundled') and not m['installed'])")"
  [ -z "$NOT_SEEDED" ] || fail "bundled modules not seeded: $NOT_SEEDED"
  pass "template and core atlases seeded ($(json_get "$DATA/modules.json" "sum(1 for m in d['modules'] if m.get('bundled'))") modules)"
  curl -fsS "http://127.0.0.1:$PORT/api/convert/dicom/available" > "$DATA/dicom.json"
  [ "$(json_get "$DATA/dicom.json" "d['available']")" = "True" ] || fail "dcm2niix is not found on PATH"
  pass "DICOM import available ($(json_get "$DATA/dicom.json" "d['dcm2niix']"))"

  # A report job (the Report section's background path) on a test lesion:
  # atlas overlap and visual field, so it runs the render worker, a separate
  # python process, the way tract dissection and network mapping run theirs.
  "$PY" - "$DATA/lesion.nii.gz" <<'PYEOF'
import sys
import numpy as np, nibabel as nib
aff = np.array([[-2, 0, 0, 90], [0, 2, 0, -126], [0, 0, 2, -72], [0, 0, 0, 1]], float)
ijk = np.indices((91, 109, 91)).reshape(3, -1).T
xyz = ijk @ aff[:3, :3].T + aff[:3, 3]
mask = (np.linalg.norm(xyz - [-40, -20, 50], axis=1) <= 10).reshape(91, 109, 91)
nib.save(nib.Nifti1Image(mask.astype(np.uint8), aff), sys.argv[1])
PYEOF
  curl -fsS -F "file=@$DATA/lesion.nii.gz" \
    -F 'payload={"name":"smoke","stages":{"overlap":true,"retino":true,"dissect":false,"lnm":false},"atlas_ids":["aal"]}' \
    "http://127.0.0.1:$PORT/api/summary/run" > "$DATA/sum.json" || fail "the report job was refused"
  SJOB="$(json_get "$DATA/sum.json" "d['job_id']")"
  for _ in $(seq 1 180); do
    curl -fsS "http://127.0.0.1:$PORT/api/summary/status/$SJOB" > "$DATA/sumst.json"
    [ "$(json_get "$DATA/sumst.json" "bool(d.get('done') or d.get('error'))")" = "True" ] && break
    sleep 1
  done
  [ "$(json_get "$DATA/sumst.json" "d.get('stage') == 'done' and not d.get('error')")" = "True" ] \
    || { cat "$DATA/sumst.json"; tail -40 "$DATA/backend.log"; fail "the report job failed"; }
  pass "report job ran its render worker"

  # The Module Store on this platform, as a user would use it. The standard
  # build ships numpy and nibabel but not SciPy (d17d366), so a module that
  # needs SciPy first needs the python-scipy module: the store refuses it with
  # a 409 until then. Install SciPy, then the dissection engine (dipy) on top,
  # from their pinned wheels for this platform, as the store's Install button
  # does. (linux-smoke-test.sh runs this same bundle check on Linux.)
  install_module() {  # module-id
    local M="$1" J
    curl -fsS -X POST "http://127.0.0.1:$PORT/api/modules/$M/install" > "$DATA/start.json"       || fail "the store refused to install $M"
    J="$(json_get "$DATA/start.json" "d['job_id']")"
    for _ in $(seq 1 300); do
      curl -fsS "http://127.0.0.1:$PORT/api/modules/jobs/$J" > "$DATA/job.json"
      [ "$(json_get "$DATA/job.json" "bool(d.get('done'))")" = "True" ] && break
      sleep 1
    done
    [ "$(json_get "$DATA/job.json" "d.get('stage')")" = "done" ] || { cat "$DATA/job.json"; fail "installing $M failed"; }
    curl -fsS "http://127.0.0.1:$PORT/api/modules" > "$DATA/modules.json"
    [ "$(json_get "$DATA/modules.json" "next(m for m in d['modules'] if m['id'] == '$M')['installed']")" = "True" ]       || fail "$M is not installed after its job finished"
    pass "Module Store installed $M from its pinned wheels for this platform"
  }
  install_module python-scipy
  install_module tract-dissection-dipy
  ;;

app)
  APP="$(find "$OUT_DIR/electron" -maxdepth 2 -name 'MRLatte.app' -type d | head -1)"
  [ -n "$APP" ] || fail "no MRLatte.app under $OUT_DIR/electron"
  PYJ="python3"
  RESD="$APP/Contents/Resources"
  codesign --verify --deep "$APP" || fail "codesign does not verify $APP"
  pass "ad-hoc signature verifies"
  [ -x "$RESD/python/bin/python3.11" ] || fail "packaged interpreter missing or not executable"
  [ -x "$RESD/dcm2niix/dcm2niix" ] || fail "packaged dcm2niix missing or not executable"
  pass "interpreter and dcm2niix packaged as executables"
  ls "$(dirname "$APP")"/../*.dmg >/dev/null 2>&1 || fail "no .dmg next to the app"
  pass "disk image built"

  # Launch the real app against a throwaway profile (userData = settings, data
  # folder and single-instance lock on macOS), so it is a first start on any
  # machine and never attaches to a real install. Its own backend runs on 8001
  # normally, on a free port if 8001 is taken: the port is read from the
  # bundled python's command line (uvicorn.run(..., port=N)), not assumed.
  PROFILE="$(mktemp -d)"
  LOG_DIR="$PROFILE/logs"
  MRLATTE_USER_DATA_DIR="$PROFILE" "$APP/Contents/MacOS/MRLatte" > /tmp/mrlatte-app.log 2>&1 &
  APID=$!
  APP_PORT=""
  for _ in $(seq 1 180); do
    APP_PORT="$(ps -axo command | grep "Contents/Resources/python/bin/python3.11" | grep -o 'port=[0-9]*' | head -1 | cut -d= -f2 || true)"
    if [ -n "$APP_PORT" ] && curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT/api/" 2>/dev/null; then break; fi
    APP_PORT=""
    sleep 1
  done
  if [ -z "$APP_PORT" ]; then
    cat /tmp/mrlatte-app.log; cat "$LOG_DIR/backend.log" 2>/dev/null || true
    kill "$APID" 2>/dev/null || true
    fail "the packaged app's own backend did not answer within 180 s"
  fi
  pass "packaged app started its own backend (port $APP_PORT)"

  # Quit as a user would; fall back to SIGTERM if Apple Events are not allowed.
  QUIT_HOW="osascript"
  osascript -e 'quit app "MRLatte"' 2>/tmp/mrlatte-osascript.log || { QUIT_HOW="SIGTERM (osascript failed)"; kill -TERM "$APID"; }
  QUIT_SECS=0
  rm -f /tmp/mrlatte-quit-sample.txt
  for _ in $(seq 1 20); do
    kill -0 "$APID" 2>/dev/null || break
    sleep 1; QUIT_SECS=$((QUIT_SECS + 1))
    # Still there after 3 s: record where its main thread is (native stack),
    # while it is still stuck, before a backstop ends it.
    if [ "$QUIT_SECS" = 3 ] && kill -0 "$APID" 2>/dev/null; then
      sample "$APID" 2 > /tmp/mrlatte-quit-sample.txt 2>/dev/null || true
    fi
  done
  if kill -0 "$APID" 2>/dev/null; then
    # Where the main thread is stuck (native stack), before anything else.
    echo "--- sample of the app's main process:"; sample "$APID" 2 2>/dev/null | head -n 80 || true
    # Cheap and permanent: say what the app was doing when it would not quit.
    echo "--- quit requested via $QUIT_HOW; osascript said:"; cat /tmp/mrlatte-osascript.log 2>/dev/null || true
    echo "--- app output (/tmp/mrlatte-app.log):"; cat /tmp/mrlatte-app.log 2>/dev/null || true
    echo "--- backend.log:"; tail -n 40 "$LOG_DIR/backend.log" 2>/dev/null || true
    echo "--- remaining MRLatte processes:"; ps -axo pid,ppid,stat,etime,command | grep -i "[M]RLatte" || true
    fail "the app did not quit"
  fi
  # A quit of 4 s or more means it hung in shutdown and a backstop (electron.js
  # before-quit: 4 s inside, 6 s outside) ended it: passes, but says so, with
  # the app's own lines and where its main thread was stuck.
  if [ "$QUIT_SECS" -ge 4 ]; then
    echo "--- note: quit took ${QUIT_SECS} s (a backstop ended it); app output:"
    grep "^\[electron\]" /tmp/mrlatte-app.log 2>/dev/null || true
    echo "--- main thread while stuck (sample at 3 s):"
    sed -n '/Call graph:/,/Total number in stack/p' /tmp/mrlatte-quit-sample.txt 2>/dev/null | head -n 60 || true
  fi
  sleep 2
  if pgrep -fl "Contents/Resources/python/bin/python3.11"; then
    fail "bundled python still running after the app quit"
  fi
  pass "quit in ${QUIT_SECS} s, no backend left running"
  ;;

*)
  echo "usage: $0 bundle|app" >&2; exit 2 ;;
esac
