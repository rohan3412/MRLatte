"""Lesion-metrics HTTP surface: lqtpy-backed volume + atlas-overlap numbers.

This is the fast, in-process replacement for the JavaScript lesion-metrics
math (frontend/src/lib/lesionReport.js, volumeAnalysis.js) — no subprocess
worker, no job/poll dance (contrast routers/tracts.py, routers/lnm.py): the
numpy work here is milliseconds per call, not minutes, so it runs directly on
FastAPI's threadpool. See backend/lesion_metrics.py for the engine
(atlas bridging, lqtpy call, exception mapping) this router is a thin HTTP
wrapper over.

Handlers below are declared `def`, not `async def`, on purpose: FastAPI runs
a sync path-operation function in its threadpool automatically, which keeps
lqtpy's numpy/scipy work off the asyncio event loop without any explicit
run_in_threadpool call — the same reasoning as the sync `_build()` closures
in routers/roi.py, just without the extra indirection since there's no
long-lived job to track.
"""
import hashlib
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from deps import LESION_JOBS_DIR

import lesion_metrics as engine

router = APIRouter()
logger = logging.getLogger(__name__)

# sha256 hex digest — the content-addressed lesion id. Same "validate with a
# regex before it ever touches a path" idiom as deps._UUID4_RE / result_id.
_LESION_ID_RE = re.compile(r'^[0-9a-f]{64}$')


def _resolve_lesion_path(lesion_id: str) -> Path:
    if not _LESION_ID_RE.match(lesion_id or ""):
        raise HTTPException(status_code=400, detail="Invalid lesion id.")
    for ext in (".nii.gz", ".nii"):
        p = LESION_JOBS_DIR / f"{lesion_id}{ext}"
        if p.exists():
            return p
    raise HTTPException(status_code=404, detail="Unknown lesion id.")


@router.post("/lesion/upload")
def lesion_upload(file: UploadFile = File(...)):
    """Store an uploaded NIfTI content-addressed by sha256 of its raw bytes.

    Re-uploading identical bytes returns the same lesion_id without
    rewriting the file (write is skip-if-exists, not merely idempotent —
    avoids re-writing a possibly-large file that's already on disk byte for
    byte). Extension (.nii vs .nii.gz) is sniffed from the gzip magic bytes,
    the same way deps.save_upload_nifti does it, not trusted from the
    client-supplied filename.
    """
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    digest = hashlib.sha256(data).hexdigest()
    ext = ".nii.gz" if data[:2] == b"\x1f\x8b" else ".nii"

    LESION_JOBS_DIR.mkdir(parents=True, exist_ok=True)
    dest = LESION_JOBS_DIR / f"{digest}{ext}"
    if not dest.exists():
        # Write-then-rename: a half-written file from a crashed/duplicate
        # upload can never be mistaken for a complete one under this id.
        tmp = dest.with_name(dest.name + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, dest)

    return {"lesion_id": digest, "bytes": len(data), "filename": dest.name}


class LesionMetricsRequest(BaseModel):
    lesion_id: str
    atlas_ids: List[str] = []
    threshold: Optional[float] = None


@router.post("/lesion/metrics")
def lesion_metrics_endpoint(payload: LesionMetricsRequest):
    """Lesion morphometry + per-atlas overlap, computed by lqtpy.

    Status codes: 404 unknown lesion_id, 400 invalid lesion_id / unknown
    atlas_id / lqtpy caller error (bad lesion input), 503 lqtpy not
    installed, 500 lqtpy environment error (missing data file/dependency).
    """
    lesion_path = _resolve_lesion_path(payload.lesion_id)
    threshold = (payload.threshold if payload.threshold is not None
                 else engine.DEFAULT_THRESHOLD)

    t0 = time.monotonic()
    error_status = None
    try:
        result = engine.compute_metrics(lesion_path, payload.atlas_ids, threshold)
        return result
    except engine.LqtpyUnavailableError as exc:
        error_status = 503
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except engine.LesionMetricsError as exc:
        error_status = exc.status_code
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — lqtpy's own typed errors land here
        error_status = engine.status_code_for(exc)
        raise HTTPException(status_code=error_status, detail=str(exc)) from exc
    finally:
        # Per-request timing log — the plan requires MEASURED latency, not an
        # assumption that "in-process" implies fast.
        duration_ms = (time.monotonic() - t0) * 1000.0
        logger.info(
            "lesion metrics lesion_id=%s atlas_ids=%s threshold=%s "
            "duration_ms=%.2f status=%s",
            payload.lesion_id, payload.atlas_ids, threshold,
            duration_ms, error_status or 200,
        )


class ReportFragmentsRequest(BaseModel):
    lesion_id: str
    atlas_ids: List[str] = []
    sections: List[str]
    threshold: Optional[float] = None
    theme: Optional[dict] = None


@router.post("/lesion/report-fragments")
def lesion_report_fragments_endpoint(payload: ReportFragmentsRequest):
    """lqtpy's embeddable HTML fragments (morphometry detail, network rollup,
    streamline disconnection, and -- if a caller asks -- parcel damage /
    tract-overlap proxy) for sections MRLatte doesn't render itself. See
    backend/lesion_metrics.py::build_report_fragments for the engine.

    Status codes mirror /lesion/metrics: 404 unknown lesion_id, 400 invalid
    lesion_id / unknown section id / unknown atlas id / bad theme colour /
    lqtpy caller error (bad lesion input), 503 lqtpy not installed, 500 lqtpy
    environment error (missing data file/dependency).
    """
    lesion_path = _resolve_lesion_path(payload.lesion_id)
    threshold = (payload.threshold if payload.threshold is not None
                 else engine.DEFAULT_THRESHOLD)

    t0 = time.monotonic()
    error_status = None
    try:
        result = engine.build_report_fragments(
            lesion_path, payload.atlas_ids, payload.sections,
            threshold=threshold, theme=payload.theme,
        )
        return result
    except engine.LqtpyUnavailableError as exc:
        error_status = 503
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except engine.LesionMetricsError as exc:
        error_status = exc.status_code
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — lqtpy's own typed errors land here
        error_status = engine.status_code_for(exc)
        raise HTTPException(status_code=error_status, detail=str(exc)) from exc
    finally:
        duration_ms = (time.monotonic() - t0) * 1000.0
        logger.info(
            "lesion report-fragments lesion_id=%s atlas_ids=%s sections=%s threshold=%s "
            "duration_ms=%.2f status=%s",
            payload.lesion_id, payload.atlas_ids, payload.sections, threshold,
            duration_ms, error_status or 200,
        )


class LesionQcRequest(BaseModel):
    lesion_id: str
    mni: bool = True
    threshold: Optional[float] = None
    # lqtpy 0.6.0+: what the drawing tool knows (see lqtpy docs/QC.md, "Drawing
    # context") and which tier to run. Ignored by an older lqtpy.
    context: Optional[dict] = None
    tier: Optional[str] = None


@router.post("/lesion/qc")
def lesion_qc_endpoint(payload: LesionQcRequest):
    """Lesion quality-control flags (sparse slices, flat/single-slice, hollow
    outline, tiny specks, outside-brain, header problems), computed by
    lqtpy.qc.check(). See backend/lesion_metrics.py::run_qc for the engine.

    Status codes: 404 unknown lesion_id, 400 invalid lesion_id / lqtpy caller
    error (bad lesion input), 503 lqtpy not installed OR installed without
    the qc module (see engine.qc_available() / GET /lesion/capabilities),
    500 lqtpy environment error.
    """
    lesion_path = _resolve_lesion_path(payload.lesion_id)
    threshold = (payload.threshold if payload.threshold is not None
                 else engine.DEFAULT_THRESHOLD)

    t0 = time.monotonic()
    error_status = None
    try:
        result = engine.run_qc(lesion_path, mni=payload.mni, threshold=threshold,
                               context=payload.context, tier=payload.tier)
        return result
    except engine.LqtpyUnavailableError as exc:
        error_status = 503
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except engine.LesionMetricsError as exc:
        error_status = exc.status_code
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — lqtpy's own typed errors land here
        error_status = engine.status_code_for(exc)
        raise HTTPException(status_code=error_status, detail=str(exc)) from exc
    finally:
        duration_ms = (time.monotonic() - t0) * 1000.0
        logger.info(
            "lesion qc lesion_id=%s mni=%s threshold=%s duration_ms=%.2f status=%s",
            payload.lesion_id, payload.mni, threshold, duration_ms, error_status or 200,
        )


class LesionQcFixRequest(BaseModel):
    lesion_id: str
    finding_ids: List[str]
    threshold: Optional[float] = None
    context: Optional[dict] = None
    return_fixed: bool = False


@router.post("/lesion/qc/fix")
def lesion_qc_fix_endpoint(payload: LesionQcFixRequest):
    """The voxels lqtpy's fix would remove for the given findings (stray
    specks and strokes, image-edge fragments, voxels far outside the brain).
    See backend/lesion_metrics.py::run_qc_fix. Status codes as /lesion/qc,
    plus 400 for a finding that can't be fixed automatically. `return_fixed`
    also returns the fixed mask itself (a loaded mask is fixed as a copy)."""
    lesion_path = _resolve_lesion_path(payload.lesion_id)
    threshold = (payload.threshold if payload.threshold is not None
                 else engine.DEFAULT_THRESHOLD)
    t0 = time.monotonic()
    error_status = None
    try:
        return engine.run_qc_fix(lesion_path, payload.finding_ids, threshold=threshold,
                                 context=payload.context, return_fixed=payload.return_fixed)
    except engine.LesionMetricsError as exc:
        error_status = exc.status_code
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — lqtpy's own typed errors land here
        error_status = engine.status_code_for(exc)
        raise HTTPException(status_code=error_status, detail=str(exc)) from exc
    finally:
        logger.info(
            "lesion qc fix lesion_id=%s ids=%s duration_ms=%.2f status=%s",
            payload.lesion_id, payload.finding_ids, (time.monotonic() - t0) * 1000.0, error_status or 200,
        )


def _engine_call(what: str, fn, *args, **kwargs):
    """Run an engine call, mapping its errors the way the endpoints above do."""
    t0 = time.monotonic()
    status = 200
    try:
        return fn(*args, **kwargs)
    except engine.LesionMetricsError as exc:
        status = exc.status_code
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — lqtpy's own typed errors land here
        status = engine.status_code_for(exc)
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    finally:
        logger.info("lesion %s duration_ms=%.2f status=%s", what, (time.monotonic() - t0) * 1000.0, status)


class LesionFixPlanRequest(BaseModel):
    lesion_id: str
    finding_ids: Optional[List[str]] = None
    threshold: Optional[float] = None
    context: Optional[dict] = None
    mni: bool = True


@router.post("/lesion/qc/fix-plan")
def lesion_qc_fix_plan_endpoint(payload: LesionFixPlanRequest):
    """lqtpy 0.8.0+: each fix lqtpy can make, with the voxels it would add and
    remove, for a preview (see engine.run_fix_plan). 503 on an older lqtpy."""
    lesion_path = _resolve_lesion_path(payload.lesion_id)
    threshold = payload.threshold if payload.threshold is not None else engine.DEFAULT_THRESHOLD
    return _engine_call("qc fix-plan", engine.run_fix_plan, lesion_path, payload.finding_ids,
                        threshold=threshold, context=payload.context, mni=payload.mni)


_LIVE_KEY_RE = re.compile(r'^[A-Za-z0-9_-]{8,64}$')


@router.post("/lesion/qc/live")
def lesion_qc_live_endpoint(file: UploadFile = File(...), session: str = Form(...),
                            mni: bool = Form(True), context: Optional[str] = Form(None),
                            tier: Optional[str] = Form(None)):
    """lqtpy 0.8.0+: check the drawing being drawn, in memory (see
    engine.live_check). `session` names the open drawing; `file` is the same
    NIfTI Save would upload. Nothing is written to disk. 503 on an older lqtpy."""
    if not _LIVE_KEY_RE.match(session or ""):
        raise HTTPException(status_code=400, detail="Invalid session id.")
    data = file.file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    try:
        ctx = json.loads(context) if context else None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="context must be JSON.") from exc
    if ctx is not None and not isinstance(ctx, dict):
        raise HTTPException(status_code=400, detail="context must be a JSON object.")
    return _engine_call("qc live", engine.live_check, session, data, mni=mni, context=ctx, tier=tier)


@router.delete("/lesion/qc/live/{session}")
def lesion_qc_live_close(session: str):
    """Forget a drawing's live session (drawing switched off or cleared)."""
    if not _LIVE_KEY_RE.match(session or ""):
        raise HTTPException(status_code=400, detail="Invalid session id.")
    return {"closed": engine.live_close(session)}


class LesionCompareRequest(BaseModel):
    a_lesion_id: str
    b_lesion_id: str
    threshold: Optional[float] = None


@router.post("/lesion/compare")
def lesion_compare_endpoint(payload: LesionCompareRequest):
    """lqtpy 0.8.0+: what changed from mask a to mask b (see
    engine.run_compare). 503 on an older lqtpy."""
    a = _resolve_lesion_path(payload.a_lesion_id)
    b = _resolve_lesion_path(payload.b_lesion_id)
    threshold = payload.threshold if payload.threshold is not None else engine.DEFAULT_THRESHOLD
    return _engine_call("compare", engine.run_compare, a, b, threshold=threshold)


@router.get("/lesion/capabilities")
def lesion_capabilities():
    """Whether the lqtpy engine is usable right now, and on what atlases.
    `features`: lqtpy 0.8.0's own list of what this installation can do
    ("qc.advice", "qc.fix_plan", "qc.session", "compare", ...); empty before."""
    if not engine.available():
        return {
            "available": False,
            "version": None,
            "disconnection_index_available": False,
            "qc_available": False,
            "atlas_ids": [],
            "features": [],
            "reason": str(engine.import_error()) if engine.import_error() else None,
        }
    return {
        "available": True,
        "version": engine.version(),
        "disconnection_index_available": engine.disconnection_index_available(),
        "qc_available": engine.qc_available(),
        "atlas_ids": engine.bridged_atlas_ids(),
        "features": sorted(engine.features()),
    }
