"""DICOM import (/api/convert/dicom): uploads are saved (loose files and
zips), dcm2niix's output is listed as series, and the slow part runs off the
event loop, so other requests keep being answered meanwhile. dcm2niix itself
is replaced by a stand-in that writes one series, so no DICOM data or binary
is needed."""
import io
import json
import threading
import zipfile

import numpy as np
import nibabel as nib
from fastapi.testclient import TestClient

import routers.dicom as dicom
from server import app


def _fake_dcm2niix(seen):
    def run(in_dir, out_dir):
        seen["files"] = sorted(p.name for p in in_dir.rglob("*") if p.is_file())
        seen["thread"] = threading.current_thread().name
        nib.save(nib.Nifti1Image(np.zeros((4, 5, 6), np.int16), np.eye(4)), str(out_dir / "T1_2.nii.gz"))
        (out_dir / "T1_2.json").write_text(json.dumps({"SeriesDescription": "T1 MPRAGE"}))
        return type("P", (), {"returncode": 0, "stderr": ""})()
    return run


def test_loose_files_and_a_zip_are_saved_and_converted(monkeypatch):
    seen = {}
    monkeypatch.setattr(dicom.shutil, "which", lambda name: "/fake/dcm2niix")
    monkeypatch.setattr(dicom, "_run_dcm2niix", _fake_dcm2niix(seen))
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        zf.writestr("series/IM0003", b"slice-3")
    files = [
        ("files", ("IM0001", b"slice-1", "application/octet-stream")),
        ("files", ("IM0002.dcm", b"slice-2", "application/dicom")),
        ("files", ("more.zip", zbuf.getvalue(), "application/zip")),
    ]
    r = TestClient(app).post("/api/convert/dicom", files=files)
    assert r.status_code == 200, r.text
    body = r.json()
    assert seen["files"] == ["IM0001", "IM0002.dcm", "IM0003"]  # the zip unpacked, then removed
    assert [s["description"] for s in body["series"]] == ["T1 MPRAGE"]
    # Not on the event loop's own thread.
    assert seen["thread"] != threading.main_thread().name


def test_no_output_is_a_clear_error(monkeypatch):
    monkeypatch.setattr(dicom.shutil, "which", lambda name: "/fake/dcm2niix")
    monkeypatch.setattr(dicom, "_run_dcm2niix",
                        lambda i, o: type("P", (), {"returncode": 1, "stderr": "no DICOM found"})())
    r = TestClient(app).post("/api/convert/dicom", files=[("files", ("x", b"junk", "application/octet-stream"))])
    assert r.status_code == 422
    assert "no DICOM found" in r.json()["detail"]
