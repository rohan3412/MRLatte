#!/usr/bin/env bash
# Smoke tests for the Windows build (core installer, build-minimal.bat's
# output), the twin of mac-smoke-test.sh. Run by .github/workflows/win-build.yml
# in Git Bash after each step it checks:
#
#   tools/build/win-smoke-test.sh bundle   after assemble-bundle.ps1: the bundled
#                                          embeddable Python starts the backend the
#                                          way electron.js does and it answers
#   tools/build/win-smoke-test.sh app      after yarn dist:win: the installer and
#                                          win-unpacked exist, the packaged app
#                                          starts its own backend, and leaves
#                                          nothing running once it quits
#
# What it cannot check is anything on screen, and the installer itself is not
# run (that would change the runner's registry and file associations).
set -euo pipefail

MODE="${1:-}"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${MRLATTE_BUILD_DIR:-$(dirname "$REPO_ROOT")/MRLatte-build}"
PORT="${MRLATTE_SMOKE_PORT:-8011}"

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
pass() { echo "  ok  $*"; }
win() { cygpath -w "$1"; }   # native Windows programs need C:\ paths

wait_http() {  # url seconds: poll until it answers 200
  local url="$1" secs="$2" i=0
  while [ "$i" -lt "$secs" ]; do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then return 0; fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

json_get() {  # json-file python-expression-on-d
  "$PYJ" -c "import json,sys; d=json.load(open(sys.argv[1])); print($2)" "$(win "$1")" | tr -d '\r'
}

# Bundled python.exe processes still alive under a folder (PowerShell sees paths).
# Always exits 0: Get-Process sets a failing exit status when no python is left,
# and under `set -eo pipefail` that used to end the script silently.
bundled_pythons() {
  powershell -NoProfile -Command "Get-Process python -ErrorAction SilentlyContinue | Where-Object { \$_.Path -like '*$1*' } | ForEach-Object { \$_.Id }; exit 0" 2>/dev/null | tr -d '' || true
}

# The port the packaged app's own backend listens on, read from its command
# line (uvicorn.run(..., port=N)). Usually 8001, but the app picks a free port
# when 8001 is taken, so the test must not assume it. Always exits 0.
bundled_backend_port() {
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { \$_.ExecutablePath -like '*$1*' } | ForEach-Object { \$_.CommandLine }; exit 0" 2>/dev/null     | tr -d '' | grep -o 'port=[0-9]*' | head -1 | cut -d= -f2 || true
}

# MRLatte.exe processes started from a folder (the app is several processes).
app_processes() {
  powershell -NoProfile -Command "Get-Process MRLatte -ErrorAction SilentlyContinue | Where-Object { \$_.Path -like '*$1*' } | ForEach-Object { \$_.Id }; exit 0" 2>/dev/null | tr -d '' || true
}

case "$MODE" in
bundle)
  RES="$OUT_DIR/MRLatte"
  PY="$RES/python/python.exe"
  PYJ="$PY"
  [ -f "$PY" ] || fail "no bundled interpreter at $PY"
  [ -f "$RES/dcm2niix/dcm2niix.exe" ] || fail "no dcm2niix.exe in the bundle"
  [ -f "$RES/frontend_build/index.html" ] || fail "no staged interface in the bundle"
  # A worker starts as a bare `python.exe worker.py`: the embeddable Python's
  # ._pth must give it site-packages. Its ._pth also leaves the script's own
  # folder off sys.path, so each worker puts it there itself before importing
  # worker_common (dissect_worker.py etc.); check the same.
  "$PY" -c "import sys; sys.path.insert(0, r'$(win "$RES/backend")'); import numpy, nibabel, worker_common" \
    || fail "a bare interpreter (as the analysis workers start) can't import numpy / worker_common"
  pass "analysis workers can import numpy"

  DATA="$(mktemp -d)"
  mkdir -p "$DATA/modules"
  cp "$RES/modules/manifest.json" "$DATA/modules/"
  [ -f "$RES/modules/atlas-catalog.json" ] && cp "$RES/modules/atlas-catalog.json" "$DATA/modules/"
  for s in tracts lnm; do mkdir -p "$DATA/modules/$s"; cp "$RES/modules/$s/README.txt" "$DATA/modules/$s/"; done
  # Same environment and -c bootstrap as electron.js startBackend().
  W_RES="$(win "$RES")"; W_DATA="$(win "$DATA")"
  env STATIC_DIR="$W_RES\\frontend_build" MRLATTE_MODULE_ROOT="$W_DATA\\modules" \
    MRLATTE_BUNDLED_MODULES="$W_RES\\modules" \
    TRACT_RESULTS_DIR="$W_DATA\\tract_results" ROI_RESULTS_DIR="$W_DATA\\roi_results" \
    DICOM_RESULTS_DIR="$W_DATA\\dicom_results" LNM_RESULTS_DIR="$W_DATA\\lnm_results" \
    SUMMARY_RESULTS_DIR="$W_DATA\\summary_results" \
    PATH="$RES/dcm2niix:$PATH" PYTHONUNBUFFERED=1 \
    "$PY" -c "import sys, os; sys.path.insert(0, r'$W_RES\\python\\site-packages'); sys.path.insert(0, r'$W_RES\\backend'); os.chdir(r'$W_RES\\backend'); import uvicorn; uvicorn.run('server:app', host='127.0.0.1', port=$PORT)" \
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
  NOT_SEEDED="$(json_get "$DATA/modules.json" "' '.join(m['id'] for m in d['modules'] if m.get('bundled') and not m['installed'])")"
  [ -z "$NOT_SEEDED" ] || fail "bundled modules not seeded: $NOT_SEEDED"
  pass "template and core atlases seeded ($(json_get "$DATA/modules.json" "sum(1 for m in d['modules'] if m.get('bundled'))") modules)"
  curl -fsS "http://127.0.0.1:$PORT/api/convert/dicom/available" > "$DATA/dicom.json"
  [ "$(json_get "$DATA/dicom.json" "d['available']")" = "True" ] || fail "dcm2niix is not found on PATH"
  pass "DICOM import available"

  # A report job on a test lesion: atlas overlap and visual field, so it runs
  # the render worker, a separate python process.
  "$PY" - "$(win "$DATA/lesion.nii.gz")" <<'PYEOF'
import sys
import numpy as np, nibabel as nib
aff = np.array([[-2, 0, 0, 90], [0, 2, 0, -126], [0, 0, 2, -72], [0, 0, 0, 1]], float)
ijk = np.indices((91, 109, 91)).reshape(3, -1).T
xyz = ijk @ aff[:3, :3].T + aff[:3, 3]
mask = (np.linalg.norm(xyz - [-40, -20, 50], axis=1) <= 10).reshape(91, 109, 91)
nib.save(nib.Nifti1Image(mask.astype(np.uint8), aff), sys.argv[1])
PYEOF
  curl -fsS -F "file=@$(win "$DATA/lesion.nii.gz")" \
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

  # The Module Store, as a user would use it. The standard installer ships
  # numpy and nibabel but not SciPy (d17d366), so a module that needs SciPy
  # first needs the python-scipy module: the store refuses it with a 409
  # until then. Install SciPy, then the dissection engine (dipy) on top, from
  # their pinned Windows wheels, as the store's Install button does.
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
    pass "Module Store installed $M from its Windows wheels"
  }
  install_module python-scipy
  install_module tract-dissection-dipy
  ;;

app)
  EL="$OUT_DIR/electron"
  UNP="$EL/win-unpacked"
  EXE="$UNP/MRLatte.exe"
  PYJ="python"
  [ -f "$EXE" ] || fail "no win-unpacked/MRLatte.exe under $EL"
  # This version's installer, not any older one left in the output folder.
  VER="$(grep -m1 '"version"' "$REPO_ROOT/frontend/package.json" | cut -d'"' -f4)"
  SETUP="$EL/MRLatte-Setup-$VER-mini-x64.exe"
  [ -f "$SETUP" ] || fail "no $(basename "$SETUP") in $EL"
  pass "installer built: $(basename "$SETUP")"
  for f in python/python.exe dcm2niix/dcm2niix.exe frontend_build/index.html modules/manifest.json; do
    [ -f "$UNP/resources/$f" ] || fail "packaged resources/$f missing"
  done
  pass "interpreter, dcm2niix, interface and modules packaged"

  # Launch the real app against a throwaway profile (data folder, settings,
  # single-instance lock), so it is a first start on any machine and never
  # touches or attaches to a real install. It starts its own backend: on 8001
  # normally, on a free port if 8001 is taken; the port is read, not assumed.
  TMPD="$(mktemp -d)"
  mkdir -p "$TMPD/local" "$TMPD/user"
  LOG_DIR="$TMPD/local/MRLatte/logs"
  show_logs() {
    echo "--- app output:"; cat "$TMPD/app.log" 2>/dev/null || true
    echo "--- backend.log:"; tail -n 60 "$LOG_DIR/backend.log" 2>/dev/null || true
    echo "--- MRLatte / python processes:"; powershell -NoProfile -Command "Get-Process MRLatte,python -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,Path | Format-Table -AutoSize | Out-String -Width 200; exit 0" 2>/dev/null || true
  }
  force_kill_app() {
    powershell -NoProfile -Command "Get-Process MRLatte,python -ErrorAction SilentlyContinue | Where-Object { \$_.Path -like '*win-unpacked*' } | Stop-Process -Force -ErrorAction SilentlyContinue; exit 0" >/dev/null 2>&1 || true
  }
  LOCALAPPDATA="$(win "$TMPD/local")" MRLATTE_USER_DATA_DIR="$(win "$TMPD/user")" "$EXE" > "$TMPD/app.log" 2>&1 &
  APP_PORT=""
  for _ in $(seq 1 180); do
    APP_PORT="$(bundled_backend_port win-unpacked)"
    if [ -n "$APP_PORT" ] && curl -fsS -o /dev/null "http://127.0.0.1:$APP_PORT/api/" 2>/dev/null; then break; fi
    APP_PORT=""
    sleep 1
  done
  if [ -z "$APP_PORT" ]; then
    show_logs; force_kill_app
    fail "the packaged app's own backend did not answer within 180 s"
  fi
  pass "packaged app started its own backend (port $APP_PORT)"
  curl -fsS "http://127.0.0.1:$APP_PORT/" | grep -q "MRLatte" || { show_logs; force_kill_app; fail "the packaged app's backend does not serve the interface"; }
  pass "its backend serves the interface"

  # Quit as closing the window does: ask this app's main window to close
  # (WM_CLOSE, like the X button). Only this build's processes are touched.
  powershell -NoProfile -Command "Get-Process MRLatte -ErrorAction SilentlyContinue | Where-Object { \$_.Path -like '*win-unpacked*' -and \$_.MainWindowHandle -ne 0 } | ForEach-Object { [void]\$_.CloseMainWindow() }; exit 0" >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    [ -z "$(app_processes win-unpacked)" ] && break
    sleep 1
  done
  if [ -n "$(app_processes win-unpacked)" ]; then
    show_logs; force_kill_app
    fail "the app did not quit when its window was closed"
  fi
  sleep 3
  LEFT="$(bundled_pythons win-unpacked)"
  if [ -n "$LEFT" ]; then show_logs; force_kill_app; fail "bundled python still running after the app quit (pid $LEFT)"; fi
  pass "quit cleanly, no backend left running"

  # A force-quit (Task Manager's End task, a crash) skips the app's own
  # shutdown: its backend must notice and stop by itself (parent_watch.py).
  # Only the app's processes are killed here, never the python.
  LOCALAPPDATA="$(win "$TMPD/local")" MRLATTE_USER_DATA_DIR="$(win "$TMPD/user")" "$EXE" > "$TMPD/app2.log" 2>&1 &
  for _ in $(seq 1 180); do
    [ -n "$(bundled_pythons win-unpacked)" ] && [ -n "$(bundled_backend_port win-unpacked)" ] && break
    sleep 1
  done
  [ -n "$(bundled_pythons win-unpacked)" ] || { show_logs; force_kill_app; fail "the relaunched app started no backend"; }
  sleep 3
  powershell -NoProfile -Command "Get-Process MRLatte -ErrorAction SilentlyContinue | Where-Object { \$_.Path -like '*win-unpacked*' } | Stop-Process -Force -ErrorAction SilentlyContinue; exit 0" >/dev/null 2>&1 || true
  GONE_SECS=0
  for _ in $(seq 1 15); do
    [ -z "$(bundled_pythons win-unpacked)" ] && break
    sleep 1; GONE_SECS=$((GONE_SECS + 1))
  done
  LEFT="$(bundled_pythons win-unpacked)"
  if [ -n "$LEFT" ]; then show_logs; force_kill_app; fail "after a force-quit the backend kept running (pid $LEFT)"; fi
  pass "after a force-quit the backend stopped by itself (${GONE_SECS} s)"
  ;;

*)
  echo "usage: $0 bundle|app" >&2; exit 2 ;;
esac
