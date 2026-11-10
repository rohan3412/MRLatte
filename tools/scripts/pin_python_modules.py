#!/usr/bin/env python
"""Pin the files of every one-click `python-package` module in
data/modules/manifest.json, so the module store can install it without pip.

Run with Python 3.11 (the bundled interpreter's version) after a build, and
again whenever a module's requirements file or the bundled stack changes:

    py -3.11 tools/scripts/pin_python_modules.py [--site-packages PATH]

PATH is the bundled interpreter's site-packages (default:
$MRLATTE_BUILD_DIR or ../MRLatte-build, then MRLatte/python/site-packages).

For each module with a `pip` source naming a backend/requirements-*.txt file:

  * Resolve its requirements to cp311 wheels for each platform the app ships
    on (PLATFORMS: Windows x64, macOS Apple Silicon and Intel) with pip's own
    resolver (dry run — nothing is installed), constrained to the exact
    versions the bundle already has. Packages the bundle has are left out:
    module folders go first on sys.path, so a second numpy would shadow the
    bundled one.
  * Every platform gets the same versions: the versions already pinned (so a
    re-run leaves existing pins as they are) and the joint picks below are
    constraints for all of them. A compiled wheel is tagged with its platform
    (`"platform": "macosx_arm64"`); a pure-Python one is not, and serves all.
    A platform that can't be satisfied (no wheel for a pinned version) is
    reported and left out, so the app says the module isn't available there.
    pip evaluates environment markers for the machine running this script,
    so a dependency that only one OS needs may be pinned for all of them;
    that is harmless for pure-Python ones.
  * All modules are resolved together first, then each against those picks,
    so a package two modules share (python-dateutil, six) is the same version
    in both folders and neither can serve the other the wrong one.
  * A package PyPI has no wheel for (neuropythy, pimms) is pinned as its
    source archive, but only if it is pure Python (no C / Cython / Fortran, no
    links): the installer copies out just the package folder and its metadata
    — what a wheel would hold — and never runs the build script.

Each file is pinned by URL, sha256 (from PyPI via pip) and size; the module's
`bytes` becomes the total download. The `pip`, `upstream` and `sideload`
sources stay as they are (the full installer still uses `pip`).
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MANIFEST = REPO / "data" / "modules" / "manifest.json"
# Manifest tag -> pip --platform. macOS wheels are taken for macOS 12 and
# newer (pip also accepts older ones), the floor assemble-bundle.sh installs
# the bundle's own packages for and package.json's mac.minimumSystemVersion.
# Linux: glibc 2.28 and older (Ubuntu 20.04+, RHEL 8+). pip takes only the
# tags it is given, and packages ship either the newer (numpy) or the older
# (SimpleITK, matplotlib) tag, so all of them are listed; the same as the
# bundle. The key is what routers/modules.py _platform_tag() reports there.
PLATFORMS = {
    "win_amd64": ["win_amd64"],
    "macosx_arm64": ["macosx_12_0_arm64"],
    "macosx_x86_64": ["macosx_12_0_x86_64"],
    "linux_x86_64": ["manylinux_2_28_x86_64", "manylinux_2_17_x86_64", "manylinux2014_x86_64"],
}


def target(platform):
    plats = [a for p in PLATFORMS[platform] for a in ("--platform", p)]
    return ["--only-binary=:all:", *plats, "--python-version", "3.11",
            "--implementation", "cp", "--abi", "cp311"]
COMPILED = (".c", ".cc", ".cpp", ".pyx", ".pxd", ".f", ".f90")
BUNDLED = []        # "name==version" of every package in the bundle; set in main()


def norm(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def req_name(line):
    return norm(re.split(r"[<>=!~;@ \[]", line.strip(), maxsplit=1)[0])


def read_requirements(path):
    return [line.split("#", 1)[0].strip() for line in path.read_text(encoding="utf-8").splitlines()
            if line.split("#", 1)[0].strip()]


def pypi(name, version=None):
    url = f"https://pypi.org/pypi/{name}/{version}/json" if version else f"https://pypi.org/pypi/{name}/json"
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def resolve(requirements, constraints, platform="win_amd64"):
    """pip's resolver, dry run. Returns its install report, or raises with the
    name pip could find no wheel for."""
    with tempfile.TemporaryDirectory() as tmp:
        cons = Path(tmp) / "constraints.txt"
        cons.write_text("\n".join(constraints) + "\n", encoding="utf-8")
        report = Path(tmp) / "report.json"
        r = subprocess.run([sys.executable, "-m", "pip", "install", "--dry-run", "--quiet",
                            "--ignore-installed", "--report", str(report), *target(platform),
                            "--target", str(Path(tmp) / "t"), "-c", str(cons), *requirements],
                           capture_output=True, text=True)
        if r.returncode:
            m = re.search(r"No matching distribution found for (\S+)", r.stderr)
            raise LookupError(m.group(1) if m else r.stderr.strip())
        return json.loads(report.read_text(encoding="utf-8"))["install"]


def pure_sdist(name):
    """The latest sdist of `name`, checked pure Python. Returns (source, its
    dependencies)."""
    info = pypi(name)
    version = info["info"]["version"]
    sdist = next(f for f in pypi(name, version)["urls"] if f["packagetype"] == "sdist")
    with urllib.request.urlopen(sdist["url"], timeout=120) as r:
        blob = r.read()
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:*") as tf:
        members = tf.getmembers()
        bad = [m.name for m in members if m.name.endswith(COMPILED) or not (m.isfile() or m.isdir())]
        if bad:
            raise SystemExit(f"{name} {version}: not a pure-Python source package ({bad[:3]})")
        top_level = next(m for m in members if m.name.endswith(".egg-info/top_level.txt"))
        egg_info = top_level.name.rsplit("/", 1)[0]
        base = egg_info.rsplit("/", 1)[0]
        packages = tf.extractfile(top_level).read().decode().split()
    deps = [d for d in info["info"]["requires_dist"] or [] if "extra ==" not in d]
    return ({"type": "sdist", "url": sdist["url"], "sha256": sdist["digests"]["sha256"],
             "bytes": sdist["size"], "extract": [f"{base}/{p}" for p in packages] + [egg_info]}, deps)


def expand(requirements):
    """Replace each wheel-less package by its pure-Python sdist plus that
    package's own dependencies. Returns (wheel requirements, sdist sources)."""
    reqs, sdists, seen = list(requirements), {}, set()
    while True:
        try:
            resolve(reqs, BUNDLED)
            return reqs, list(sdists.values())
        except LookupError as e:
            name = req_name(str(e))
            if name in seen:
                raise SystemExit(f"cannot resolve {e}")
            seen.add(name)
            source, deps = pure_sdist(name)
            sdists[name] = source
            reqs = [r for r in reqs if req_name(r) != name] + deps


def wheel_source(item, platform):
    """A pinned wheel; tagged with `platform` unless it is pure Python."""
    url = item["download_info"]["url"]
    info = item["download_info"].get("archive_info") or {}
    sha = (info.get("hashes") or {}).get("sha256") or info.get("hash", "").split("=", 1)[-1]
    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as r:
        size = int(r.headers["Content-Length"])
    src = {"type": "wheel", "url": url, "sha256": sha, "bytes": size}
    if not url.rsplit("/", 1)[-1].endswith("-any.whl"):
        src["platform"] = platform
    return src


def pinned_versions(module):
    """name==version of every file a module already pins (wheel or sdist)."""
    out = []
    for s in module.get("sources") or []:
        name = s.get("url", "").rsplit("/", 1)[-1]
        if s.get("type") == "wheel" and name.endswith(".whl"):
            dist, version = name.split("-")[:2]
        elif s.get("type") == "sdist" and name.endswith((".tar.gz", ".zip")):
            dist, version = re.sub(r"\.(tar\.gz|zip)$", "", name).rsplit("-", 1)
        else:
            continue
        out.append(f"{norm(dist)}=={version}")
    return out


def main():
    global BUNDLED
    ap = argparse.ArgumentParser()
    build = Path(os.environ.get("MRLATTE_BUILD_DIR") or REPO.parent / "MRLatte-build")
    ap.add_argument("--site-packages", default=str(build / "MRLatte" / "python" / "site-packages"))
    args = ap.parse_args()
    if sys.version_info[:2] != (3, 11):
        raise SystemExit("run with Python 3.11 (py -3.11), the bundled interpreter's version")

    freeze = subprocess.run([sys.executable, "-m", "pip", "list", "--path", args.site_packages,
                             "--format", "freeze"], capture_output=True, text=True, check=True).stdout
    BUNDLED = [line for line in freeze.splitlines() if "==" in line]
    bundled = {req_name(line) for line in BUNDLED}
    if "numpy" not in bundled:
        raise SystemExit(f"no bundled numpy under {args.site_packages} — build first")

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    modules = []
    already = []
    for m in manifest["modules"]:
        pip_src = next((s for s in m.get("sources") or [] if s.get("type") == "pip"), None)
        if m.get("type") == "python-package" and pip_src:
            already += pinned_versions(m)
            reqs, sdists = expand(read_requirements(REPO / "backend" / pip_src["requirements"]))
            modules.append((m, reqs, sdists))
    # Versions already pinned stay pinned (a package two modules share is one
    # version, so duplicates collapse).
    already = sorted(set(already))

    joint = resolve([r for _, reqs, _ in modules for r in reqs], BUNDLED + already)
    picks = [f"{i['metadata']['name']}=={i['metadata']['version']}" for i in joint]

    for m, reqs, sdists in modules:
        wheels, seen, missing = [], set(), []
        for platform in PLATFORMS:
            try:
                items = resolve(reqs, BUNDLED + picks, platform)
            except LookupError as e:
                missing.append(f"{platform} (no wheel for {e})")
                continue
            for i in items:
                if norm(i["metadata"]["name"]) in bundled:
                    continue
                src = wheel_source(i, platform)
                key = (src["url"], src.get("platform"))
                if key not in seen:
                    seen.add(key)
                    wheels.append(src)
        pinned = wheels + sdists
        m["sources"] = pinned + [s for s in m["sources"] if s.get("type") not in ("wheel", "sdist")]
        # The Windows download, as before; the backend reports each
        # platform's own total (routers/modules.py module_snapshot).
        m["bytes"] = sum(s["bytes"] for s in pinned if s.get("platform") in (None, "win_amd64"))
        print(f"{m['id']}: {len(wheels)} wheels + {len(sdists)} source packages, "
              f"{m['bytes'] / 1e6:.1f} MB to download on Windows"
              + (f"; NOT available on {', '.join(missing)}" if missing else ""))

    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                        encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
