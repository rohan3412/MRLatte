"""The LQTpy module can be installed while MRLatte runs: lesion_metrics must
pick lqtpy up then, without a restart, and must not keep retrying a failing
import on every request when nothing changed."""
import importlib.util
import sys

import pytest

import lesion_metrics

pytest.importorskip("lqtpy")


def test_lqtpy_installed_after_startup_is_picked_up(monkeypatch):
    monkeypatch.setattr(lesion_metrics, "lqtpy", None)
    monkeypatch.setattr(lesion_metrics, "_lqtpy_datasets", None)
    monkeypatch.setattr(lesion_metrics, "_LQTPY_FAILED_FOR", None)
    assert lesion_metrics.available() is True
    assert lesion_metrics.version()


def test_absent_lqtpy_stays_absent_without_an_import_attempt(monkeypatch):
    monkeypatch.setattr(lesion_metrics, "lqtpy", None)
    monkeypatch.setattr(lesion_metrics, "_LQTPY_FAILED_FOR", None)
    monkeypatch.setattr(importlib.util, "find_spec", lambda name, *a: None)
    assert lesion_metrics.available() is False
    assert lesion_metrics.version() is None


def test_a_failing_import_is_retried_only_after_sys_path_changes(monkeypatch):
    monkeypatch.setattr(lesion_metrics, "lqtpy", None)
    monkeypatch.setattr(lesion_metrics, "_LQTPY_FAILED_FOR", None)
    calls = []
    real_import = __import__

    def failing_import(name, *a, **k):
        if name == "lqtpy" or name.startswith("lqtpy."):
            calls.append(name)
            raise ImportError("No module named 'scipy'")
        return real_import(name, *a, **k)

    monkeypatch.setattr("builtins.__import__", failing_import)
    monkeypatch.setattr(sys, "path", list(sys.path))
    assert lesion_metrics.available() is False
    assert lesion_metrics.available() is False
    assert len(calls) == 1                      # the second call didn't re-import
    sys.path.insert(0, "a-module-folder-just-installed")
    lesion_metrics.available()
    assert len(calls) == 2
