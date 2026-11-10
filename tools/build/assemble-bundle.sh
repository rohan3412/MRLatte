#!/usr/bin/env bash
# Assemble the self-contained, offline MRLatte bundle for macOS or Linux
# (MRLatte-build/MRLatte/), which `cd frontend && yarn dist:mac:<arch>` packages
# into a .dmg, or `yarn dist:linux` into an AppImage. The counterpart of
# assemble-bundle.ps1: the same steps and the same layout, so electron.js and
# package.json's extraResources need no per-platform paths beyond the
# interpreter's name.
#
#   tools/build/assemble-bundle.sh [--arch arm64|x64] [--full] [--skip-frontend-build]
#
#     --arch                 defaults to this machine's architecture. pip resolves
#                            wheels for the bundled interpreter, so build each
#                            architecture on (or under Rosetta for) that one.
#                            Linux: x64 only.
#     --full                 also stage the optional Python stacks, as -Full does.
#     --skip-frontend-build  reuse frontend/build if it exists.
#
# Needs: macOS or Linux, internet, Node + yarn, rsync. No system Python: the
# bundle's own interpreter (python-build-standalone, pinned by sha256) runs pip.
# CI runs this in .github/workflows/mac-build.yml and linux-build.yml.
#
# Written for the bash 3.2 that ships with macOS: no associative arrays.
set -euo pipefail

# --- Pinned interpreter -------------------------------------------------------
# CPython 3.11, matching the Windows bundle's 3.11 line. To upgrade: pick a
# release of astral-sh/python-build-standalone, copy both sha256 lines for the
# *-apple-darwin-install_only_stripped.tar.gz assets from its SHA256SUMS.
PBS_RELEASE="20261013"
PY_VERSION="3.11.17"
PBS_SHA_ARM64="5e656e09fc73c7ae10e4df66e6aa253f1f5980509b3be8a242e883d67a5fdf26"
PBS_SHA_X64="a870f5bb476ebe4483761ffdcd39b316dbef9f59f158706296d2c6f138057cae"
PBS_SHA_LINUX_X64="3b8e5a248bcc351265ffe68f5e457668a2e09c99a47f81f658988c7d3d107522"

ARCH=""; FULL=0; SKIP_FE=0; VIEWER=0
while [ $# -gt 0 ]; do
  case "$1" in
    --arch) ARCH="${2:-}"; shift 2 ;;
    --full) FULL=1; shift ;;
    # The viewer-only bundle: the server and its module store only
    # (requirements-core.txt), no bundled data modules. See assemble-bundle.ps1 -Viewer.
    --viewer) VIEWER=1; shift ;;
    --skip-frontend-build) SKIP_FE=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '    [ok] %s\n' "$1"; }
warn() { printf '    [warn] %s\n' "$1"; }

case "$(uname -s)" in
  Darwin) OS=mac ;;
  Linux)  OS=linux ;;
  *) echo "assemble-bundle.sh builds the macOS or Linux bundle (Windows: assemble-bundle.ps1)." >&2; exit 1 ;;
esac
if [ -z "$ARCH" ]; then
  case "$(uname -m)" in arm64|aarch64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) echo "unknown machine $(uname -m); pass --arch" >&2; exit 2 ;; esac
fi
case "$OS-$ARCH" in
  mac-arm64)  PBS_TRIPLE="aarch64-apple-darwin";     PBS_SHA="$PBS_SHA_ARM64";     WANT_CPU="arm64" ;;
  mac-x64)    PBS_TRIPLE="x86_64-apple-darwin";      PBS_SHA="$PBS_SHA_X64";       WANT_CPU="x86_64" ;;
  linux-x64)  PBS_TRIPLE="x86_64-unknown-linux-gnu"; PBS_SHA="$PBS_SHA_LINUX_X64"; WANT_CPU="x86-64" ;;
  *) echo "--arch must be arm64 or x64 on macOS, x64 on Linux" >&2; exit 2 ;;
esac
# shasum ships with macOS; Linux has sha256sum (and often shasum too).
sha256() { if command -v shasum >/dev/null; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DOWNLOADS="$REPO_ROOT/tools/build/downloads"
OUT_DIR="${MRLATTE_BUILD_DIR:-$(dirname "$REPO_ROOT")/MRLatte-build}"
BUNDLE="$OUT_DIR/MRLatte"
PBS_FILE="cpython-${PY_VERSION}+${PBS_RELEASE}-${PBS_TRIPLE}-install_only_stripped.tar.gz"
PBS_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_RELEASE}/${PBS_FILE//+/%2B}"

# Download once into tools/build/downloads (gitignored), checking the sha256 on
# every run so a cached file can't drift either.
fetch() {  # url sha256 dest
  local url="$1" sha="$2" dest="$3"
  mkdir -p "$(dirname "$dest")"
  if [ -f "$dest" ] && [ "$(sha256 "$dest")" = "$sha" ]; then
    ok "using cached $(basename "$dest")"; return
  fi
  echo "    downloading $url"
  curl -fL --retry 3 -o "$dest.part" "$url"
  local got; got="$(sha256 "$dest.part")"
  if [ "$got" != "$sha" ]; then
    rm -f "$dest.part"
    echo "sha256 mismatch for $(basename "$dest"): expected $sha, got $got" >&2; exit 1
  fi
  mv "$dest.part" "$dest"
  ok "downloaded $(basename "$dest")"
}

step "Preflight checks"
command -v yarn >/dev/null || { echo "Required tool 'yarn' not found on PATH. Install Node + yarn." >&2; exit 1; }
command -v rsync >/dev/null || { echo "Required tool 'rsync' not found on PATH." >&2; exit 1; }
ok "$OS $ARCH, output $BUNDLE"

step "Preparing bundle directory: $BUNDLE"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE"

# --- 1. Interpreter -------------------------------------------------------------
step "1/5  Python $PY_VERSION ($PBS_TRIPLE)"
fetch "$PBS_URL" "$PBS_SHA" "$DOWNLOADS/$PBS_FILE"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$DOWNLOADS/$PBS_FILE" -C "$TMP"
mv "$TMP/python" "$BUNDLE/python"
# The real interpreter file; bin/python3 is only a symlink to it, and the
# symlinks are dropped below. electron.js starts exactly this path.
PY="$BUNDLE/python/bin/python3.11"
"$PY" -c "import platform, sys; print('    ' + sys.version.split()[0], platform.machine())"
SITE="$BUNDLE/python/site-packages"
mkdir -p "$SITE"

# --- 2. Backend dependencies --------------------------------------------------------
step "2/5  Installing backend dependencies into site-packages (this is slow)"
pipi() {  # target requirements-file [extra pip args]
  local t="$1" r="$2"; shift 2
  "$PY" -m pip install --disable-pip-version-check --no-warn-script-location \
    --target "$t" -r "$r" "$@"
}
# Wheels for macOS 12 and newer, whatever macOS builds the bundle (pip would
# otherwise take wheels for the build machine's own, newer, version). The same
# floor as pin_python_modules.py's module pins and package.json's
# mac.minimumSystemVersion. Linux: glibc 2.28 and older (Ubuntu 20.04+, RHEL
# 8+); pip takes only the tags it is given and packages ship either the newer
# or the older one, so all are listed, as in the module pins.
if [ "$OS" = mac ]; then PLATS=(--platform "macosx_12_0_${WANT_CPU}")
else PLATS=(--platform manylinux_2_28_x86_64 --platform manylinux_2_17_x86_64 --platform manylinux2014_x86_64); fi
MACOS_FLOOR=(--only-binary=:all: "${PLATS[@]}"
             --python-version 3.11 --implementation cp --abi cp311)
[ "$VIEWER" = 1 ] && [ "$FULL" = 1 ] && { echo "--viewer and --full are opposites: pass one of them" >&2; exit 2; }
REQ="$REPO_ROOT/backend/requirements-frozen.txt"
[ "$VIEWER" = 1 ] && REQ="$REPO_ROOT/backend/requirements-core.txt"
pipi "$SITE" "$REQ" "${MACOS_FLOOR[@]}"
ok "dependencies installed"

if [ "$FULL" = 1 ]; then
  # Not held to the macOS 12 floor: neuropythy has no wheel at all, so these
  # target the build machine's macOS.
  step "2a/5  Installing optional dependency stacks (--full)"
  for pair in reports:python-reports validation:python-validation \
              longitudinal:python-longitudinal dissection:python-dissection; do
    req="${pair%%:*}"; dir="${pair#*:}"
    mkdir -p "$BUNDLE/$dir"
    pipi "$BUNDLE/$dir" "$REPO_ROOT/backend/requirements-$req.txt"
    ok "$dir installed"
  done
  # SciPy and lqtpy (modules since 0.6.0). --no-deps: numpy and nibabel are in
  # the core site-packages, and a second numpy here would shadow it. Held to
  # the macOS 12 floor like the core: these are wheels the core's numpy loads.
  for stack in scipy lqtpy; do
    mkdir -p "$BUNDLE/python-$stack"
    pipi "$BUNDLE/python-$stack" "$REPO_ROOT/backend/requirements-$stack.txt" --no-deps "${MACOS_FLOOR[@]}"
    ok "python-$stack installed"
  done
else
  ok "optional stacks skipped (pass --full to include them)"
fi

# Same pruning as the .ps1, scoped to site-packages: test suites, byte-code
# caches, type stubs and build-only files never run in the shipped app.
step "2b/5  Pruning site-packages and the interpreter"
before="$(du -sk "$BUNDLE/python" | cut -f1)"
find "$SITE" -depth -type d \( -name tests -o -name test -o -name __pycache__ \) -exec rm -rf {} +
find "$SITE" -type f \( -name '*.pyi' -o -name '*.c' -o -name '*.cpp' -o -name '*.h' -o -name '*.hpp' \
  -o -name '*.pyx' -o -name '*.pxd' -o -name '*.pxi' -o -name '*.a' \) -delete
# The interpreter's own extras: the Windows embeddable Python has none of
# these either (no Tk, IDLE, pip, headers or man pages), and the app installs
# modules without pip. Its symlinks go too, so electron-builder copies plain
# files only.
P="$BUNDLE/python"
rm -rf "$P/include" "$P/share" "$P/lib/pkgconfig" \
  "$P"/lib/libtcl* "$P"/lib/libtk* "$P"/lib/tcl* "$P"/lib/tk* "$P"/lib/itcl* "$P"/lib/thread* \
  "$P/lib/python3.11/idlelib" "$P/lib/python3.11/tkinter" "$P/lib/python3.11/turtledemo" \
  "$P/lib/python3.11/ensurepip" \
  "$P"/lib/python3.11/site-packages/pip "$P"/lib/python3.11/site-packages/pip-*.dist-info
find "$P/bin" -mindepth 1 ! -name python3.11 -exec rm -f {} +
find "$P" -type l -exec rm -f {} +
"$PY" -c "import json, ssl, sqlite3, ctypes, multiprocessing" || { echo "pruning broke the interpreter" >&2; exit 1; }
# Every start of this interpreter must see python/site-packages, not only the
# backend (electron.js inserts it for that one process). The analysis workers
# are fresh `python3.11 worker.py` processes and import numpy (via
# worker_common) before they read the paths the backend passes them, so
# without this they failed with "No module named 'numpy'". The Windows
# embeddable Python gets the same from the site-packages line in its ._pth.
# A .pth line is relative to the folder the .pth file sits in, so the path
# survives the app being moved.
printf '../../../site-packages\n' > "$P/lib/python3.11/site-packages/mrlatte-site-packages.pth"
# The viewer-only bundle has no numpy: check a package it does have.
CHECK="import numpy, nibabel"; [ "$VIEWER" = 1 ] && CHECK="import fastapi, uvicorn"
( cd / && "$PY" -c "$CHECK" ) \
  || { echo "a bare start of the interpreter can't import its packages ($CHECK)" >&2; exit 1; }
after="$(du -sk "$BUNDLE/python" | cut -f1)"
ok "pruned $(( (before - after) / 1024 )) MB"

# --- 3. Frontend ----------------------------------------------------------------
FE_BUILD="$REPO_ROOT/frontend/build"
if [ "$SKIP_FE" = 1 ] && [ -d "$FE_BUILD" ]; then
  step "3/5  Frontend build (skipped, using existing frontend/build)"
else
  step "3/5  Building the React frontend (yarn build)"
  # Same-origin API (served by the bundled backend); no source maps shipped.
  ( cd "$REPO_ROOT/frontend" \
    && REACT_APP_BACKEND_URL="" GENERATE_SOURCEMAP=false yarn install --frozen-lockfile \
    && REACT_APP_BACKEND_URL="" GENERATE_SOURCEMAP=false yarn build )
fi
# Atlases ship once, under modules/ (step 5); CRA's verbatim copy of public/
# and its unit tests stay out, as in the .ps1.
rsync -a --exclude 'atlases/' --exclude '*.test.js' "$FE_BUILD/" "$BUNDLE/frontend_build/"
ok "frontend copied (atlases excluded)"

# --- 4. dcm2niix, backend, scripts ------------------------------------------------
step "4/5  Backend, dcm2niix, scripts"
mkdir -p "$BUNDLE/dcm2niix"
# The pip 'dcm2niix' package carries the binary (package dir and bin/); pip
# --target may also write a Python launcher of the same name, so take the
# first candidate that is really a program (Mach-O on macOS, ELF on Linux).
BIN_KIND="Mach-O"; [ "$OS" = linux ] && BIN_KIND="ELF"
DCM=""
for c in "$SITE/dcm2niix/dcm2niix" "$SITE/bin/dcm2niix"; do
  if [ -f "$c" ] && file -b "$c" | grep -q "$BIN_KIND"; then DCM="$c"; break; fi
done
if [ -n "$DCM" ]; then
  cp "$DCM" "$BUNDLE/dcm2niix/dcm2niix"
  chmod 755 "$BUNDLE/dcm2niix/dcm2niix"
  if [ "$OS" = mac ]; then
    if ! lipo -archs "$BUNDLE/dcm2niix/dcm2niix" | grep -qw "$WANT_CPU"; then
      echo "dcm2niix is $(lipo -archs "$BUNDLE/dcm2niix/dcm2niix"), not $WANT_CPU" >&2; exit 1
    fi
  elif ! file -b "$BUNDLE/dcm2niix/dcm2niix" | grep -q "$WANT_CPU"; then
    echo "dcm2niix is not an $WANT_CPU program: $(file -b "$BUNDLE/dcm2niix/dcm2niix")" >&2; exit 1
  fi
  ok "dcm2niix copied ($("$BUNDLE/dcm2niix/dcm2niix" -v 2>&1 | head -1 || true))"
  # The package was installed only to supply that binary: remove exactly the
  # files its RECORD lists, inside site-packages, then the folders it emptied.
  "$PY" - "$SITE" <<'PYEOF'
import glob, os, shutil, sys
site = os.path.realpath(sys.argv[1])
for rec in glob.glob(os.path.join(site, "dcm2niix-*.dist-info", "RECORD")):
    dist = os.path.dirname(rec)
    for line in open(rec, encoding="utf-8").read().splitlines():
        rel = line.split(",")[0]
        p = os.path.realpath(os.path.join(site, rel))
        if rel and p.startswith(site + os.sep) and os.path.isfile(p):
            os.remove(p)
    for d in ("bin", "dcm2niix", os.path.basename(dist)):
        full = os.path.join(site, d)
        if os.path.isdir(full) and not any(f for _, _, fs in os.walk(full) for f in fs):
            shutil.rmtree(full)
PYEOF
  ok "dcm2niix pip package removed (the app runs the copy above)"
else
  warn "no $BIN_KIND dcm2niix in site-packages. DICOM import will be disabled."
fi

# Backend source; caches and local result folders stay behind.
rsync -a \
  --exclude '__pycache__/' --exclude '.pytest_cache/' --exclude 'tracts/' \
  --exclude 'dicom_results/' --exclude 'roi_results/' --exclude 'lnm_results/' \
  --exclude 'summary_results/' --exclude 'tract_results/' \
  --exclude 'lesion_jobs/' --exclude 'dissect_jobs/' --exclude 'lnm_jobs/' \
  --exclude '*.pyc' --exclude '.env' \
  "$REPO_ROOT/backend/" "$BUNDLE/backend/"

# Runtime scripts subset (validate_round_trip imports postprocess_atlases).
mkdir -p "$BUNDLE/scripts"
for f in validate_round_trip.py postprocess_atlases.py benson_validation_report.txt; do
  if [ -f "$REPO_ROOT/tools/scripts/$f" ]; then cp "$REPO_ROOT/tools/scripts/$f" "$BUNDLE/scripts/"
  else warn "tools/scripts/$f not found (skipped)"; fi
done
[ -d "$REPO_ROOT/tools/scripts/validation_plots" ] && cp -R "$REPO_ROOT/tools/scripts/validation_plots" "$BUNDLE/scripts/"

# --- 5. Module tree ---------------------------------------------------------------
step "5/5  Module tree (manifest, atlases, drop-in slots)"
"$PY" - "$REPO_ROOT/data/modules" "$BUNDLE/modules" "$FULL" "$VIEWER" <<'PYEOF'
# Mirrors step 5 of assemble-bundle.ps1: the manifest, the atlas catalog, the
# data modules the manifest marks "bundled" (all of them with --full), and the
# two user-supplied slots, empty but for a README (electron-builder drops
# empty folders).
import json, os, shutil, sys
src, dst, full = sys.argv[1], sys.argv[2], sys.argv[3] == "1"
viewer = sys.argv[4] == "1"        # ships no data modules: all install from the store
os.makedirs(dst, exist_ok=True)
man = os.path.join(src, "manifest.json")
if not os.path.isfile(man):
    sys.exit(f"Module manifest missing: {man}")
shutil.copy2(man, dst)
cat = os.path.join(src, "atlas-catalog.json")
if os.path.isfile(cat):
    shutil.copy2(cat, dst)
else:
    print("    [warn] data/modules/atlas-catalog.json not found - the Atlas Manager will offer no further atlases.")
ids, n, size = [], 0, 0
for m in json.load(open(man, encoding="utf-8"))["modules"]:
    if (m.get("type") or "data") != "data" or viewer or not (full or m.get("bundled")):
        continue
    for f in m.get("files", []):
        rel = os.path.join(m.get("installTo") or "", f["path"])
        s = os.path.join(src, rel)
        if not os.path.isfile(s):
            sys.exit(f"module {m['id']}: {f['path']} is missing from data/modules")
        d = os.path.join(dst, rel)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(s, d)
        n += 1
        size += os.path.getsize(s)
    ids.append(m["id"])
print(f"    [ok] data modules staged: {', '.join(ids)} ({n} files, {size / 2**20:.1f} MB)")
slots = {
    "tracts": ["Drop a whole-brain tractogram here to enable lesion-based virtual",
               "tract dissection.", "",
               "  * format:  .trk  (a .tck is rejected - it carries no reference grid)",
               "  * space:   registered to the MNI template",
               "  * name:    anything; any conforming file here is picked up", "",
               "Nothing to install. Restart MRLatte after dropping the file in."],
    "lnm": ["Drop a DA-LNM connectome bundle here to enable lesion network mapping.", "",
            "  * format:  .npz  (as produced by the DA-LNM preparation stage)",
            "  * name:    anything; any conforming file here is picked up", "",
            "Nothing to install. Restart MRLatte after dropping the file in."],
}
for name, lines in slots.items():
    os.makedirs(os.path.join(dst, name), exist_ok=True)
    with open(os.path.join(dst, name, "README.txt"), "w", encoding="ascii", newline="\n") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"    [ok] slot modules/{name}/ created (empty)")
PYEOF

printf '\n============================================================\n'
printf '  Bundle assembled: %s  (~%s MB, %s)\n' "$BUNDLE" "$(( $(du -sk "$BUNDLE" | cut -f1) / 1024 ))" "$ARCH"
printf '============================================================\n'
if [ "$OS" = mac ]; then printf '  Next: cd frontend && yarn dist:mac:%s\n\n' "$ARCH"
else printf '  Next: cd frontend && yarn dist:linux\n\n'; fi
