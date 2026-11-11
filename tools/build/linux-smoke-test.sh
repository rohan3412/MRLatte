#!/usr/bin/env bash
# Smoke tests for the Linux build, run by .github/workflows/linux-build.yml:
#
#   tools/build/linux-smoke-test.sh bundle   after assemble-bundle.sh: the same
#                                            checks as on macOS (the bundled
#                                            backend answers, modules seed, a
#                                            report job runs, the Module Store
#                                            installs from its Linux wheels)
#   tools/build/linux-smoke-test.sh app      after yarn dist:linux: the AppImage
#                                            exists, the packaged app starts its
#                                            own backend, and closing its window
#                                            leaves nothing running
#
# The app step needs a display (the workflow runs it under xvfb-run) and
# wmctrl to close the window as a person would.
set -euo pipefail

MODE="${1:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
OUT_DIR="${MRLATTE_BUILD_DIR:-$(dirname "$REPO_ROOT")/MRLatte-build}"

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
pass() { echo "  ok  $*"; }

case "$MODE" in
bundle)
  # The bundle layout and its checks are the same on macOS and Linux.
  exec bash "$HERE/mac-smoke-test.sh" bundle
  ;;

app)
  UNPACKED="$OUT_DIR/electron/linux-unpacked"
  EXE="$UNPACKED/mrlatte"
  [ -x "$EXE" ] || fail "no packaged app at $EXE"
  RESD="$UNPACKED/resources"
  [ -x "$RESD/python/bin/python3.11" ] || fail "packaged interpreter missing or not executable"
  [ -x "$RESD/dcm2niix/dcm2niix" ] || fail "packaged dcm2niix missing or not executable"
  pass "interpreter and dcm2niix packaged as executables"
  ls "$OUT_DIR"/electron/MRLatte-*-linux-*.AppImage >/dev/null 2>&1 || fail "no AppImage in $OUT_DIR/electron"
  pass "AppImage built ($(basename "$(ls "$OUT_DIR"/electron/MRLatte-*-linux-*.AppImage | head -1)"))"

  # A throwaway profile (settings, data folder and single-instance lock), so it
  # is a first start and never attaches to a real install. --no-sandbox: the
  # unpacked app's chrome-sandbox helper is not setuid outside an install.
  PROFILE="$(mktemp -d)"
  LOG_DIR="$PROFILE/logs"
  MRLATTE_USER_DATA_DIR="$PROFILE" "$EXE" --no-sandbox > /tmp/mrlatte-app.log 2>&1 &
  APID=$!
  APP_PORT=""
  for _ in $(seq 1 180); do
    APP_PORT="$(ps -eo args | grep "resources/python/bin/python3.11" | grep -o 'port=[0-9]*' | head -1 | cut -d= -f2 || true)"
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
  curl -fsS "http://127.0.0.1:$APP_PORT/" | grep -q "MRLatte" || fail "its backend does not serve the interface"
  pass "its backend serves the interface"

  # Close the window as a person would (the last window closing quits on
  # Linux); SIGTERM if no window manager answers.
  QUIT_HOW="wmctrl"
  sleep 3
  wmctrl -c "MRLatte" 2>/dev/null || { QUIT_HOW="SIGTERM (no window to close)"; kill -TERM "$APID"; }
  QUIT_SECS=0
  for _ in $(seq 1 25); do
    kill -0 "$APID" 2>/dev/null || break
    sleep 1; QUIT_SECS=$((QUIT_SECS + 1))
  done
  if kill -0 "$APID" 2>/dev/null; then
    echo "--- quit requested via $QUIT_HOW"
    echo "--- app output:"; cat /tmp/mrlatte-app.log 2>/dev/null || true
    echo "--- backend.log:"; tail -n 40 "$LOG_DIR/backend.log" 2>/dev/null || true
    echo "--- remaining MRLatte processes:"; ps -eo pid,ppid,stat,etime,args | grep -i "[m]rlatte" || true
    kill -KILL "$APID" 2>/dev/null || true
    fail "the app did not quit"
  fi
  sleep 2
  if pgrep -f "resources/python/bin/python3.11" >/dev/null; then
    pgrep -fa "resources/python/bin/python3.11"
    fail "bundled python still running after the app quit"
  fi
  pass "quit in ${QUIT_SECS} s ($QUIT_HOW), no backend left running"

  # A force-quit (a crash, kill -9) skips the app's own shutdown: its backend
  # must notice and stop by itself, workers included (parent_watch.py). Only
  # the app's main process is killed here.
  MRLATTE_USER_DATA_DIR="$PROFILE" "$EXE" --no-sandbox > /tmp/mrlatte-app2.log 2>&1 &
  APID2=$!
  for _ in $(seq 1 180); do
    pgrep -f "resources/python/bin/python3.11" >/dev/null && break
    sleep 1
  done
  pgrep -f "resources/python/bin/python3.11" >/dev/null || { kill -9 "$APID2" 2>/dev/null || true; fail "the relaunched app started no backend"; }
  sleep 5
  kill -9 "$APID2"
  GONE_SECS=0
  for _ in $(seq 1 15); do
    pgrep -f "resources/python/bin/python3.11" >/dev/null || break
    sleep 1; GONE_SECS=$((GONE_SECS + 1))
  done
  if pgrep -f "resources/python/bin/python3.11" >/dev/null; then
    pgrep -fa "resources/python/bin/python3.11"
    tail -n 20 "$LOG_DIR/backend.log" 2>/dev/null || true
    pkill -9 -f "resources/python/bin/python3.11" || true
    fail "after a force-quit the backend kept running"
  fi
  pass "after a force-quit the backend stopped by itself (${GONE_SECS} s)"
  ;;

*)
  echo "usage: $0 bundle|app" >&2; exit 2 ;;
esac
