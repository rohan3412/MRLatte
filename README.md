# MRLatte

Neuroimaging visualization + clinical analysis dashboard. React + NiiVue + Electron on the
frontend, FastAPI on the backend.

## Quickstart (web, dev)

Two terminals — the backend serves the API and the atlas files; the frontend dev server proxies
to it.

```bash
# terminal 1 — backend
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8001

# terminal 2 — frontend (first run only: `yarn setup` instead of `yarn install`)
cd frontend
yarn setup
yarn start
```

Open http://localhost:3000. `yarn setup` runs `yarn install` and then downloads the **core**
data modules (MNI template + atlases) into `data/modules/` — without it the viewer has nothing
to render. Subsequent runs just need `yarn start`.

**Desktop instead of browser:** `cd frontend && yarn electron:start`.

**DICOM import** additionally needs the `dcm2niix` binary on `PATH`.

## Layout

```
backend/         FastAPI backend (server.py + worker scripts)
frontend/        React + Electron app
data/modules/    module root for this checkout — manifest.json (the catalogue), atlases
                 (git-tracked), tracts/ + lnm/ slots (you supply)
data/assets/     project images, design reference
tools/           build scripts, launcher, CLI utilities, LNM prep docs
deploy/          Dockerfile, docker-compose*.yml, Caddyfile
```

`data/modules/` is where large assets live for a checkout — the manifest that catalogues them
sits inside it too, alongside the payload it describes. In an installed copy the equivalent is
`%LOCALAPPDATA%\MRLatte\modules` (macOS: `~/Library/Application Support/MRLatte/modules`); either
can be overridden with `MRLATTE_MODULE_ROOT`.

## Data: what ships vs. what you provide

**Ships in the repo** — atlas packs (MNI152, AAL, Harvard-Oxford, Destrieux, Juelich, Benson-Wang
retinotopy, HCP/IIT/JHU tract atlases). Viewing, DICOM import, ROI work, and retinotopy work with
nothing extra.

**You provide** — two HCP-derived assets that the WU-Minn Data Use Terms bar us from
redistributing. Drop your own in; no install step, just restart the app:

| Feature | Drop the file into | What it needs to be |
|---|---|---|
| Tract dissection | `data/modules/tracts/` | Any whole-brain tractogram, `.trk`, registered to MNI (not `.tck` — no reference grid) |
| Lesion network mapping | `data/modules/lnm/` | Any DA-LNM connectome bundle, `.npz` (a GSP1000 rebuild works too) |

Filenames don't matter — each folder is scanned and the first structurally valid file wins.

**Managing modules from the CLI:**

```bash
node tools/scripts/modules.mjs list          # what's installed, what's missing
node tools/scripts/modules.mjs add --core    # just the essentials (what `yarn setup` runs)
node tools/scripts/modules.mjs add --all     # every downloadable module (not the two slots above)
node tools/scripts/modules.mjs verify        # sha256-check everything installed
node tools/scripts/modules.mjs remove <id>   # only removes what this tool itself installed
```

Nothing is ever downloaded automatically outside of `add`/`setup`. The in-app Module Store
(Settings → Modules) does the same thing with a UI.

**Atlas modules.** The template, each atlas, the retinotopy maps and the validation surfaces are
data modules of their own (those with a `group` in `data/modules/manifest.json`), installed and
removed one at a time in the app's Atlas Manager. The installer ships the template and the seven core
atlases (`"bundled": true`) and seeds each into the module root once; the rest download from the
GitHub release tagged `modules-v1` (the manifest's `releaseBase`; `MRLATTE_MODULE_RELEASE_BASE`
overrides it). After changing an atlas file and its pin in the manifest, rebuild the release assets
and upload them to that release:

```bash
python tools/scripts/pack_data_modules.py    # one <id>.zip per data module, in ../MRLatte-build/module-assets
```

## Building a Windows installer

Build machine needs internet, a full Python 3.11 (`py -3.11`), Node + yarn, and **`git` on PATH**
(`backend/requirements-frozen.txt` pins `lqtpy` via a `git+https` URL, which pip fetches by
shelling out to git).

Build output lands **outside the repo**, at `../MRLatte-build/` by default (override with
`MRLATTE_BUILD_DIR` if you want it elsewhere).

```bash
tools/build/assemble-bundle.ps1          # core bundle: app + backend + embedded Python + atlases
tools/build/assemble-bundle.ps1 -Full    # also stages the two optional Python stacks (below)

cd frontend
yarn dist:win         # NSIS installer — core payload (app, backend, embedded Python, dcm2niix, atlases)
yarn dist:win:full    # NSIS installer with both optional stacks bundled (needs -Full above first)
```

The choice between core and full is made at **build time** — an in-installer component picker was
attempted (NSIS custom page toggling Report figures / Validation) but electron-builder's NSIS
template includes the same `installer.nsh` at two different points in the script, one of them before
its own page flow is finalized, which made a custom page unreliable in practice. Rather than ship
something half-working, that idea was dropped: `dist:win` is core-only, `dist:win:full` bundles
everything, and there is no in-between at install time.

| Component | Size | In `dist:win` | In `dist:win:full` |
|---|---|---|---|
| Atlas packs | 18 MB | yes | yes |
| Report figures (nilearn, matplotlib, pandas) | 165 MB | no | yes |
| Validation toolchain (neuropythy) | 33 MB | no | yes |

Installed the core build but want Report figures or Validation later? Add them from the in-app
Module Store, or via `pip install -r backend/requirements-reports.txt` /
`requirements-validation.txt` — no reinstall needed.

**Install location:** the NSIS installer defaults to a **per-user** install
(`%LOCALAPPDATA%\Programs\MRLatte`, not Program Files — `perMachine: false` in
`frontend/package.json`'s `nsis` config), and the setup wizard has a page to pick
a different folder (`allowToChangeInstallationDirectory: true`). Program Files
needs admin rights and locks module installs down with UAC prompts, so a
user-writable default avoids friction when adding modules after install.

`yarn dist:win` / `dist:win:full` (electron-builder + NSIS) are the only supported ways to produce
a Windows installer — an earlier 7-Zip self-extracting build was dropped once the NSIS path proved
out: it launched a console window opening a browser tab rather than a real desktop window, needed
an extra manual 7-Zip install on the build machine, and had no uninstaller.

## Building for macOS

macOS disk images (Apple Silicon and Intel) are built by GitHub Actions, in
`.github/workflows/mac-build.yml`, on every push to the `macos` branch or by hand from the
Actions tab ("Run workflow"). Each run builds both architectures, smoke-tests them and attaches
`MRLatte-<version>-mac-arm64.dmg` and `-mac-x64.dmg` to the run (kept 14 days). The smoke tests
check that:

- the bundled backend starts, seeds the template and finds dcm2niix;
- the Module Store installs a module from its macOS wheels;
- the packaged app launches its own backend and leaves nothing running after it quits;
- on screen (`tools/build/ui-smoke.mjs`, the same on every platform): the brain is drawn in 2D
  and 3D, a mask opened like a double-click arrives in its own window, a drawing saves as a
  lesion, and a report for it places it in the right hemisphere. Screenshots of each step are
  attached to the run (`ui-shots-mac-<arch>`).

What they can't judge is how it looks on a real Mac's GPU.

On a Mac you can build locally instead (Node + yarn, internet):

```bash
./build-mac.sh                 # this Mac's architecture; --arch arm64|x64 to choose
```

That runs `tools/build/assemble-bundle.sh` and then `yarn dist:mac:<arch>`, writing to
`../MRLatte-build/electron/`. The bundle uses a pinned standalone CPython 3.11
(python-build-standalone) instead of the Windows embeddable Python. Wheels are taken for macOS 12
and newer, which is also the app's declared minimum.

**Unsigned.** The app is ad-hoc signed (`tools/build/mac-adhoc-sign.js`), not signed with an Apple
Developer ID, so macOS blocks it the first time it opens. After dragging MRLatte to Applications,
either run this once:

```bash
xattr -dr com.apple.quarantine /Applications/MRLatte.app
```

or open it, then go to System Settings → Privacy & Security and click **Open Anyway**. The
`xattr` route also clears the bundled Python and dcm2niix, which macOS may otherwise question
separately.

**Try on a real Mac before a release.** The on-screen test runs on a CI runner's software
graphics, so check these by hand:

- the MNI152 viewer in 2D and 3D, with a tract overlay;
- DICOM import;
- double-clicking a `.nii` and a `.mrlatte` file in Finder;
- a `mrlatte://` link;
- closing every window and clicking the Dock icon (a working window comes back);
- after Quit, nothing MRLatte left in Activity Monitor.

The module root on macOS is `~/Library/Application Support/MRLatte/modules`. The one-click Python
modules pin macOS wheels next to the Windows ones (`tools/scripts/pin_python_modules.py` tags each
compiled wheel with its platform), so the Module Store works the same way there.

## Building for Linux

A Linux AppImage (x64) is built by GitHub Actions in `.github/workflows/linux-build.yml`, on the
same pushes as the Windows build or by hand. It uses the macOS bundle script
(`tools/build/assemble-bundle.sh --arch x64` runs on Linux too) and `yarn dist:linux`, then
`tools/build/linux-smoke-test.sh` (the bundle and app checks above) and the on-screen test, on a
virtual display. The run attaches `MRLatte-<version>-linux-x64.AppImage` and the screenshots.

The bundle and the one-click modules use manylinux wheels for glibc 2.28 and older, so the
AppImage runs on Ubuntu 20.04 / Debian 10 / RHEL 8 and newer. To run it: `chmod +x` the file and
open it. The app's data, modules included, lives in `~/.config/MRLatte`. On Linux the AppImage
starts without Chromium's sandbox (`electron.js`): an AppImage can't carry the sandbox's setuid
helper, and Ubuntu 24.04 blocks the other way it works, so it would not start at all there.
Not done yet: double-click file associations (an AppImage registers none by itself).

## Docker

`deploy/` has the Dockerfile and compose files for a containerized deployment (build context is
the repo root: `docker compose -f deploy/docker-compose.yml --project-directory . up -d --build`).

---

Active work is on the `modular` branch.
