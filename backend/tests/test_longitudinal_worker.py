"""Longitudinal comparison: the follow-up is always registered to the
baseline, also when both scans share a grid (owner, 10 Nov: a head that moved
between sessions on the same scanner grid was compared unaligned)."""
import numpy as np
import nibabel as nib
import pytest

sitk = pytest.importorskip("SimpleITK")

from longitudinal_worker import _run_longitudinal  # noqa: E402


def _blob(shift=0):
    z, y, x = np.mgrid[0:48, 0:48, 0:48].astype(np.float32)
    img = np.exp(-((x - 24 - shift) ** 2 + (y - 24) ** 2 + (z - 24) ** 2) / 60.0) * 100
    img += np.exp(-((x - 16 - shift) ** 2 + (y - 30) ** 2 + (z - 20) ** 2) / 20.0) * 60
    return img


def test_same_grid_shifted_followup_is_registered(tmp_path):
    aff = np.diag([2.0, 2.0, 2.0, 1.0])
    base, fu, out = tmp_path / "b.nii.gz", tmp_path / "f.nii.gz", tmp_path / "d.nii.gz"
    nib.save(nib.Nifti1Image(_blob(0), aff), str(base))
    nib.save(nib.Nifti1Image(_blob(2), aff), str(fu))  # same grid, moved 2 voxels
    m = _run_longitudinal(base, fu, out)
    assert m["same_grid"] is True
    diff = nib.load(str(out)).get_fdata()
    # Unregistered, the 2-voxel shift leaves a large difference; aligned, little remains.
    assert np.abs(diff).max() < 0.25 * 100, np.abs(diff).max()
    assert m["registration_metric"] != 0.0
