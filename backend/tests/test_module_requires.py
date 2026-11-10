"""`requires`: a module that needs another (lqtpy needs scipy) reports what is
missing, stays off until it is there, is refused install before it, and the
module it needs can't be removed from under it.

Scratch module root and manifest; downloads are local copies (no internet).
"""
import hashlib
import json
import shutil
import sys
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

import deps
import routers.modules as mods
from server import app

# base <- middle <- top, plus a cycle pair that must not hang anything.
PKGS = {"base": "mrl_req_base", "middle": "mrl_req_middle", "top": "mrl_req_top"}


def _wheel(path, pkg):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr(f"{pkg}/__init__.py", "OK = True\n")
    return path


@pytest.fixture
def env(tmp_path, monkeypatch):
    root = tmp_path / "module-root"
    root.mkdir()
    by_url, modules = {}, []
    requires = {"base": [], "middle": ["base"], "top": ["middle"]}
    for mid, pkg in PKGS.items():
        w = _wheel(tmp_path / f"{mid}.whl", pkg)
        url = f"https://example.invalid/{mid}.whl"
        by_url[url] = w
        modules.append({
            "id": mid, "name": mid.title(), "type": "python-package", "tier": "optional",
            "version": "1.0", "unlocks": [f"cap-{mid}"], "bytes": w.stat().st_size,
            "sha256": None, "installTo": f"python/{mid}", "pythonPackages": [pkg],
            "requires": requires[mid],
            "sources": [{"type": "wheel", "url": url, "bytes": w.stat().st_size,
                         "sha256": hashlib.sha256(w.read_bytes()).hexdigest()}],
        })
    modules += [
        {"id": "loop-a", "name": "A", "type": "python-package", "installTo": "python/loop-a",
         "pythonPackages": ["mrl_req_loop_a"], "requires": ["loop-b"], "sources": []},
        {"id": "loop-b", "name": "B", "type": "python-package", "installTo": "python/loop-b",
         "pythonPackages": ["mrl_req_loop_b"], "requires": ["loop-a", "not-in-manifest"], "sources": []},
    ]
    p = tmp_path / "manifest.json"
    p.write_text(json.dumps({"schemaVersion": 1, "modules": modules}), encoding="utf-8")
    mods._manifest_cache["mtime"] = None
    monkeypatch.setattr(deps, "MODULE_ROOT", root)
    monkeypatch.setenv("MRLATTE_MODULE_MANIFEST", str(p))
    monkeypatch.setenv("MRLATTE_MODULE_JOBS_DIR", str(tmp_path / "jobs"))
    monkeypatch.setattr(sys, "path", list(sys.path))

    def fake_download(url, part, job_id, expected_bytes=None, **_progress):
        part.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(by_url[url], part)
        return part.stat().st_size

    monkeypatch.setattr(mods, "_download", fake_download)
    yield root
    for pkg in PKGS.values():
        sys.modules.pop(pkg, None)


def _mod(client, mid):
    return next(m for m in client.get("/api/modules").json()["modules"] if m["id"] == mid)


def _install(client, mid):
    r = client.post(f"/api/modules/{mid}/install")
    if r.status_code != 200:
        return r
    job = r.json()["job_id"]
    for _ in range(750):
        s = client.get(f"/api/modules/jobs/{job}").json()
        if s.get("done"):
            assert s["stage"] == "done", s
            return r
        time.sleep(0.02)
    raise AssertionError("install job never finished")


def test_missing_requirements_are_listed_dependencies_first(env):
    client = TestClient(app)
    top = _mod(client, "top")
    assert top["requires"] == ["middle"]
    assert top["missingRequires"] == ["base", "middle"]
    assert _mod(client, "base")["missingRequires"] == []


def test_install_before_its_requirement_is_refused_and_names_it(env):
    client = TestClient(app)
    r = _install(client, "middle")
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["requires"] == ["base"]
    assert "Base" in detail["message"]
    assert not (env / "python" / "middle").exists()


def test_installed_in_order_everything_turns_on(env):
    client = TestClient(app)
    for mid in ("base", "middle", "top"):
        assert _install(client, mid).status_code == 200
    caps = client.get("/api/modules").json()["capabilities"]
    assert caps == {**caps, "cap-base": True, "cap-middle": True, "cap-top": True}
    assert _mod(client, "top")["missingRequires"] == []


def test_present_but_requirement_missing_keeps_its_capability_off(env):
    # The middle package importable from elsewhere (a dev machine's own Python),
    # its requirement not: the module counts as installed, its feature as off.
    client = TestClient(app)
    folder = env / "elsewhere"
    (folder / PKGS["middle"]).mkdir(parents=True)
    (folder / PKGS["middle"] / "__init__.py").write_text("")
    sys.path.insert(0, str(folder))
    m = _mod(client, "middle")
    assert m["installed"] is True and m["missingRequires"] == ["base"]
    assert client.get("/api/modules").json()["capabilities"]["cap-middle"] is False


def test_a_required_module_cannot_be_removed_from_under_another(env):
    client = TestClient(app)
    for mid in ("base", "middle"):
        _install(client, mid)
    r = client.delete("/api/modules/base")
    assert r.status_code == 409
    assert r.json()["detail"]["requiredBy"] == ["middle"]
    assert (env / "python" / "base").exists()
    assert _mod(client, "base")["requiredBy"] == ["middle"]
    # Once nothing installed needs it, it goes.
    assert client.delete("/api/modules/middle").status_code == 200
    assert client.delete("/api/modules/base").status_code == 200


def test_a_requirement_cycle_or_unknown_id_does_not_hang(env):
    client = TestClient(app)
    b = _mod(client, "loop-b")
    assert set(b["missingRequires"]) == {"loop-a", "not-in-manifest"}
