"""The installed backend stops itself once the app that started it is gone.

electron.js stops the backend when MRLatte quits (stopServices). A force-quit
(Activity Monitor, Task Manager) or a crash skips that, and the backend used
to keep running: holding port 8001 and its memory, so the next start ran a
second one beside it. electron.js passes its own process id in
MRLATTE_PARENT_PID; server.py's lifespan starts this watch, which ends the
backend (and on macOS / Linux the analysis workers in its process group) once
that process is gone. Without the variable (a developer's uvicorn) nothing is
watched.

How it knows, without being fooled by a reused process id:
  Windows       a handle to the app's process, waited on until it exits;
  macOS, Linux  the app is this process's parent: when it dies, this process
                is re-parented (to launchd / init), so getppid() changes. If
                the id given is not the parent, its existence is polled.
"""
import logging
import os
import signal
import sys
import threading
import time

log = logging.getLogger(__name__)


def _wait_windows(pid):
    """Block until process `pid` exits. False if it can't be watched."""
    import ctypes
    from ctypes import wintypes

    synchronize = 0x00100000
    infinite = 0xFFFFFFFF
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.OpenProcess.restype = wintypes.HANDLE
    k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    k32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
    k32.CloseHandle.argtypes = (wintypes.HANDLE,)
    handle = k32.OpenProcess(synchronize, False, pid)
    if not handle:
        return False
    try:
        k32.WaitForSingleObject(handle, infinite)
    finally:
        k32.CloseHandle(handle)
    return True


def _wait_posix(pid, interval):
    """Block until process `pid` is gone."""
    start = os.getppid()
    if start == pid:
        while os.getppid() == start:
            time.sleep(interval)
        return True
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            pass  # exists, owned by someone else
        time.sleep(interval)


def _end_backend():
    log.warning("the MRLatte app that started this backend is gone; stopping")
    if sys.platform != "win32" and os.getpgrp() == os.getpid():
        # The backend leads its own process group (electron.js spawns it
        # detached): the workers in it stop too, and this process with them.
        try:
            os.killpg(os.getpgrp(), signal.SIGTERM)
        except OSError:
            pass
        time.sleep(3)
    os._exit(0)


def start_from_env(interval=1.0, on_gone=_end_backend):
    """Start watching the app named by MRLATTE_PARENT_PID. Returns whether a
    watch started (False without a valid id)."""
    raw = (os.environ.get("MRLATTE_PARENT_PID") or "").strip()
    if not raw.isdigit() or int(raw) <= 0:
        return False
    pid = int(raw)

    def watch():
        gone = _wait_windows(pid) if sys.platform == "win32" else _wait_posix(pid, interval)
        if gone:
            on_gone()
        else:
            log.warning("could not watch the app process %s; the backend won't stop with it", pid)

    threading.Thread(target=watch, name="parent-watch", daemon=True).start()
    return True
