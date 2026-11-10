"""The viewer-only build runs without numpy and nibabel (the python-numpy
module brings them): a feature that needs one answers 503 and names the module,
and the stand-in picks the package up once it is installed."""
import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

import core_packages
from core_packages import MissingCorePackage, _StandIn, missing_package
from server import app

router = APIRouter()


@router.get("/api/_test/needs-numpy")
def _needs_numpy():
    raise MissingCorePackage("numpy")


@router.get("/api/_test/needs-scipy")
def _needs_scipy():
    raise ModuleNotFoundError("No module named 'scipy'", name="scipy")


@router.get("/api/_test/other-import")
def _other_import():
    raise ModuleNotFoundError("No module named 'nothing_we_ship'", name="nothing_we_ship")


app.include_router(router)
# The catch-all "/" static mount must stay last (see server.py): move these up.
app.router.routes[:0] = [app.router.routes.pop() for _ in range(3)][::-1]


def test_a_missing_core_package_is_a_503_that_names_the_module():
    r = TestClient(app).get("/api/_test/needs-numpy")
    assert r.status_code == 503
    body = r.json()
    assert body["requires"] == ["python-numpy"]
    assert "NumPy" in body["detail"]            # a sentence every panel can show as is


def test_a_plain_import_error_for_a_module_package_is_answered_the_same_way():
    assert TestClient(app).get("/api/_test/needs-scipy").json()["requires"] == ["python-scipy"]


def test_an_unrelated_import_error_is_not_dressed_up(capsys):
    r = TestClient(app, raise_server_exceptions=False).get("/api/_test/other-import")
    assert r.status_code == 500


def test_the_stand_in_imports_the_real_package_once_it_exists():
    s = _StandIn("json")                    # any importable package
    assert s.dumps({"a": 1}) == '{"a": 1}'
    with pytest.raises(MissingCorePackage) as e:
        _StandIn("numpy_that_is_not_installed").zeros
    assert missing_package(e.value) is None   # not one we ship
    assert missing_package(ModuleNotFoundError("x", name="nibabel.processing")) == "nibabel"
    assert core_packages.PROVIDED_BY["nibabel"] == "python-numpy"
