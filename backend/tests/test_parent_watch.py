"""The installed backend stops itself once the app that started it is gone.

A force-quit or a crash of MRLatte skips electron.js stopServices, and the
backend used to keep running (holding port 8001; the next start ran a second
one beside it). Found on the Intel Mac CI runner, 11 Nov: a hard-killed app
left its backend running for the rest of the job.
"""
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]

# The "app": starts the "backend" (a child that runs the watch the way
# server.py does, then would run forever), prints the backend's pid, waits.
APP = r"""
import os, subprocess, sys, time
env = dict(os.environ, MRLATTE_PARENT_PID=str(os.getpid()))
child = subprocess.Popen([sys.executable, "-c", sys.argv[1]], env=env, cwd=sys.argv[2])
print(child.pid, flush=True)
time.sleep(120)
"""
BACKEND_PROC = r"""
import time, parent_watch
assert parent_watch.start_from_env(interval=0.2)
time.sleep(120)
"""


def _alive(pid):
    if sys.platform == "win32":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # A zombie (exited, not yet reaped by its new parent) counts as gone.
    try:
        state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
        return bool(state) and not state.startswith("Z")
    except OSError:
        return True


def test_backend_exits_when_its_app_is_killed():
    app = subprocess.Popen([sys.executable, "-c", APP, BACKEND_PROC, str(BACKEND)],
                           stdout=subprocess.PIPE, text=True)
    backend_pid = int(app.stdout.readline().strip())
    try:
        time.sleep(1.5)  # the watch is running
        assert _alive(backend_pid), "the backend should run while its app does"
        app.kill()  # a force-quit: no shutdown code runs in the app
        app.wait(timeout=10)
        deadline = time.time() + 10
        while time.time() < deadline and _alive(backend_pid):
            time.sleep(0.2)
        assert not _alive(backend_pid), "the backend kept running after its app was killed"
    finally:
        if _alive(backend_pid):
            if sys.platform == "win32":
                subprocess.run(["taskkill", "/F", "/PID", str(backend_pid)], capture_output=True)
            else:
                os.kill(backend_pid, 9)


@pytest.mark.parametrize("value", [None, "", "abc", "0", "-5"])
def test_no_watch_without_a_valid_parent(monkeypatch, value):
    import parent_watch
    if value is None:
        monkeypatch.delenv("MRLATTE_PARENT_PID", raising=False)
    else:
        monkeypatch.setenv("MRLATTE_PARENT_PID", value)
    assert parent_watch.start_from_env() is False
