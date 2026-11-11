# Changelog

What changed in each MRLatte release, newest first. Each release's notes are written here first;
the text of the GitHub release is copied from its section.
Releases: https://github.com/cogneuro-rgb/MRLatte/releases

## [0.6.0] — unreleased

MRLatte for macOS, one Report section for lesion reports, and fixes from the inbox.

### A new look (first stage)
- **MRLatte has its own title bar** in the desktop app: the COPHE mark, an MRLatte menu button
  (Windows and Linux), the scan's name with the preset in use, and a search box in the middle that
  opens the command palette (Ctrl K). The window buttons stay, so Windows 11 snap layouts still work.
- **The bottom status bar is gone.** The crosshair's coordinates, values and region names now sit in
  a frosted chip in the viewer's bottom-left corner, in fixed columns so names don't jump as the
  numbers change. Preferences > Viewer > Readout can put it beside the crosshair instead. The layer
  count is on the sidebar heading.
- **Task toolbar** (Preferences > Sidebar > Panels, off by default): a button at the left of the
  toolbar swaps the viewing tools for the tools of the task at hand: tracing while you draw, and
  analysing (quality check, atlas overlap, clusters, report) when a lesion or activation layer is
  selected. Every button does what its sidebar twin does.
- **Movable panels** (same place, off by default): drag the layer settings, the toolbar or the
  readout by their grip. Drop on a highlighted edge of the viewer to dock there, anywhere else to
  float it. Each preset remembers its own layout; Esc cancels a drag.
- **Draw mask in a narrow sidebar** now keeps the brush radius in view, on one compact row.
- Everything new is off or still when Performance mode or Reduce Motion is on.

### macOS
- **MRLatte now runs on Macs**, on Apple Silicon and Intel, macOS 12 or newer: a disk image for
  each, with the same offline, self-contained app as on Windows. That includes the analysis
  engine, DICOM import, the atlases and one-click modules from the module store.
- Double-click a `.nii` or `.mrlatte` file in Finder (or use Open With for `.nii.gz`) to open it in
  MRLatte. `mrlatte://` links work too.
- Closing the last window keeps MRLatte in the Dock, as Mac apps do; clicking the icon opens a new
  window. Quitting stops everything it started.
- **Fixed on Mac: reports with tract disconnection or network mapping** stopped with a numpy
  import error. The analysis steps run as separate Python processes, and on the Mac those could
  not find the app's Python packages. The build now checks this, and runs a real report job.
- **Fixed on Mac: a right-drag on the image no longer opens the right-click menu.** macOS asks for
  the menu as soon as the button goes down, so the menu opened at the start of every right-drag
  (zoom, window, pan) and broke it. The menu now waits for the release and opens only if the
  pointer stayed put, as on Windows.
- **If the Intel version is installed on an Apple Silicon Mac**, MRLatte says so once and names the
  Apple Silicon disk image to install instead: through Rosetta everything is much slower.
- The Mac app is not yet signed by Apple. The first time, open it via System Settings → Privacy &
  Security → **Open Anyway**, or run
  `xattr -dr com.apple.quarantine /Applications/MRLatte.app` once.

### Linux
- **A Linux version**: an AppImage for x64 (Ubuntu 20.04 and newer, and other distributions of
  that age), built and tested in CI like the Windows and Mac versions, with the same offline app,
  analysis engine, DICOM import, atlases and module store (Linux wheels pinned for every module).

### Tested on screen in CI
- Each Windows, Mac and Linux build now opens the packaged app on the build machine and checks
  what it draws: the brain in 2D and 3D, a scan opened like a double-click, a drawing saved as a
  lesion, and a report. Screenshots of each step are attached to the build.

### One place for a lesion's report
- **A new Report section** (under Analysis) replaces the two tools that overlapped: the one-click
  lesion report and LQTpy analysis. Pick the lesion and tick what to include: atlas overlap, visual
  field, tract disconnection, network mapping. Overlap and visual field alone are ready in seconds;
  tract disconnection and network mapping run in the background, with progress and Cancel at the
  bottom left. The report opens when it's ready and can also be saved as PDF or text.
- Each lesion has a **Report…** button that opens the section with that lesion chosen.
- Operations whose module isn't installed are greyed out, with an **Install…** link that opens the
  module store at it.
- Tract dissection and lesion network mapping keep their own reports for their own runs.

### Smaller: SciPy and LQTpy are modules, and a viewer-only installer
- **SciPy (37 MB) and LQTpy are no longer part of the standard install.** They install from the
  module store when you first need them: the quality check (Check drawing, Check on a lesion mask,
  Fix), the lesion measures in the report and LQTpy Analysis offer **Install LQTpy…** in place of
  the check. The report job itself (atlas overlap, visual field) still works without them.
- **Modules can need other modules.** LQTpy needs SciPy, SciPy needs NumPy, tract dissection and
  network mapping need SciPy. Installing one asks to **install both** (or all of them) in the right
  order; a module another one needs can't be removed from under it, and the store says which.
- **A viewer-only installer** (`build-viewer.bat`, `build-mac.sh --viewer`): opens NIfTI files and
  shows their headers, with no NumPy, SciPy, LQTpy, template or atlases. Everything else installs
  from the module store, back to the whole of MRLatte. Something that needs a module it doesn't
  have yet says which one.

### Preferences
- **A Preferences window** (More ▸ Preferences, or Ctrl+, in the desktop app). Choose System, Light
  or Dark for the look, and **hide the sections that need a module** you have not installed, so the
  sidebar and its icon rail show only what works. Install the module and its section comes back.
- **How the viewer opens**, also in Preferences: radiological (R L) or neurological (L R), the
  layout, a black or white background, and the crosshair (on or off, its colour and thickness).
  The toolbar still changes each for the session; a workspace that saved its own view opens as saved.
- **The drawing's background quality check** can be switched off, or wait longer or shorter than
  the 30 s it waited before.

### Fixed and improved
- **Longitudinal comparison always aligns the follow-up to the baseline**, also when both scans
  share a voxel grid (the head may have moved between sessions). It moves and turns the scan
  (rigid registration) and never stretches it, so real change such as lesion growth stays visible.
- **Fixed: a force-quit MRLatte left its analysis engine running.** After Task Manager's End task,
  Activity Monitor's Force Quit or a crash, the backend kept running in the background (holding
  memory and port 8001; the next start ran a second one). It now notices that the app is gone and
  stops by itself, analysis workers included. The build checks this on all three platforms.
- **Computers without graphics acceleration** (a virtual machine, a remote-desktop session, Linux
  without GPU drivers): MRLatte notices, says so once, keeps the animations off and draws the 3D
  view with fewer samples. Drawing in software, each 3D frame took seconds, and an animation queued
  dozens of them, so the window stopped answering. On such an Intel Mac, Apple's own software
  renderer froze the window even so; there MRLatte restarts once at its first start, about a second,
  to use Chromium's faster one, and starts that way from then on.
- **Fixed: a report could name the wrong hemisphere.** For a mask stored left-to-right flipped
  (as FSL writes MNI masks) on a grid other than the template's, the report made without LQTpy put
  the lesion in the other hemisphere, gave its voxel position as its MNI centre, and listed the
  wrong regions; the overlap table, the measurements and the visual-field findings read such masks
  wrongly too. All of them now read each scan in its own voxel grid.
- **A report shows streamline disconnection only when Tract disconnection was ticked.** Before, a
  "Streamline disconnection: not available" line appeared in every report.
- **The "beside the crosshair" readout stays inside its own view** instead of running into the next one.
- **One highlighted button among the presets:** Everything's "Use" (the recommended start).
- **The View menu says "Multiplanar + 3D"**, the same as the command palette.
- **Quit always finishes.** On an Intel Mac, Quit could leave the app open with its backend already
  stopped. MRLatte now closes its windows at once on Quit, and a backstop outside the app ends it if
  it is still running 6 s later (macOS and Linux).
- **A plain right-click on the image no longer shows the window-drag readout** behind its menu. The
  readout appears once the pointer actually moves.
- **The desktop app repaints after resizing and after the Ctrl key hints hide.** With the see-through
  window on Windows, stale strips of the sidebar stayed on screen, and the "D" key badge stayed until
  the mouse crossed the sidebar.
- **The sidebar's top row is a slim row of buttons, and which ones is a preference** (Preferences ▸
  Sidebar ▸ Header buttons): the module store, collapse all, collapse sidebar by default, plus light /
  dark mode, search, screenshot, focus mode, shortcuts and Preferences. The desktop app's title bar
  already names MRLatte, so the logo, name and version left the sidebar (the title bar logo's tooltip
  gives the version), and the preset chip left the title bar.
- **Movable panels, redone** (Preferences ▸ Sidebar ▸ Panels):
  - Four dock areas, one on each side of the viewer. Panels docked on one side stack and share it,
    with a divider between each pair; the area's inner edge sets its size; the viewer keeps at least
    240 px, and the areas give way first in a small window.
  - Floating cards resize from their edges and corners, snap to the window, the viewer, the dock
    areas and each other (a guide line shows what they caught), and slide into place on release.
  - Every sidebar section can dock beside the viewer too, not only float.
  - The toolbar docked left or right is a strip of icons with an expand button that shows the names;
    its menus open beside it.
  - The readout, docked or floating, is only the numbers: no header, the grip and the put-back button
    show on hover.
- **Level and Width sliders on the base volume.** The base card now has Level and Width sliders (with values you can type) under the Window range, so you can set from the sidebar what a right-drag sets. All three stay in step, and they move live while you right-drag in the viewer.
- **Window is the first right-drag mode, and the default.** The toolbar order is now Window, Zoom, Pan, and a new session starts in Window (a saved workspace still restores its own mode).
- **The window drag readout shows its limits.** The small grid now draws the reachable area as a red dotted line, so you can see the edge the dot stops at.
- **Layer names no longer start with "Lesion · ".** A loaded mask, ROI, atlas or tract file is shown by its own name; where a list mixes kinds (for example the measurement mask picker) lesions end with "(lesion)".
- **Smoother 3D while you move it.** Turning or zooming the 3D view now stays fluid on slower computers: if frames start to lag, MRLatte draws the 3D view more coarsely and shows fewer tract lines until you stop, then sharpens it again (a small "Preview" label shows while it does). Slices, measurements, screenshots and reports are always full quality. Switch it on under Preferences, Faster 3D while moving.
- **A better window drag.** With Right-drag set to Window, dragging up and down moves the level
  and left and right the width, at a speed that follows the scan's own value range, so a 0–1 map
  and a CT feel the same (it used to step one raw unit per mouse move: crawling on CT, jumping on
  small-valued maps). Hold Shift for fine control. While you drag, a readout next to where the
  drag began (it stays put) shows the level, the width and the values shown, on a small grid of
  width against level with where the drag started; the base card takes the new window when you
  let go.
- **The base volume can be moved, turned and resized again** (its Position block, as on overlays),
  to line a scan up under the template, atlases and overlays, which stay where they are. A drawing
  made on the moved base is saved at the moved position. The scan's file isn't changed; a
  workspace stores the adjustment with the base (such workspaces need 0.6.0 or newer).
- **A clearer progress bar for DICOM import.** Four steps (upload, convert, download, open), each
  with its own segment: the upload and the download fill with real megabytes and a percentage,
  and the conversion and opening count the seconds, so a long import no longer sits at "Uploading
  100 %" while dcm2niix works.
- **MRtrix images open: .mif and .mif.gz**, from the file buttons, by dropping them on the viewer,
  with Open with or a double-click. MRLatte turns each into a NIfTI as it opens (same voxels and
  position), so every analysis can read it too.
- **Pseudotubes, lines and points now look different.** At the default thickness, tubes and points
  were drawn about one pixel wide at whole-brain zoom, so all three looked like lines; they now
  keep at least 3 px. Fixed: lighting lit them from behind, so turning it on darkened them instead
  of shading them. Lighting is now on by default.
- **Sidebar tool buttons switch to icons when the sidebar is narrow** (pen, brush, interpolate,
  measurements) instead of cutting their labels off; "Interpolate all" steps down to "All (Axial)",
  then "All".
- **Fixed: "Failed to load panel (network error)" could never be retried.** Try again now
  downloads the panel again; before, only a reload helped.
- **The collapsed sidebar always shows the COPHE cup at the top**, never a clipped "MR".
- **A Clusters… button on each activation map** opens Cluster analysis with that map chosen.
- **Fixed: cluster peaks were in the wrong place.** The MNI column and Go to peak ignored the
  map's origin, so Go to landed outside the brain, and a map stored left-right flipped (as FSL's
  MNI maps are) would have shown the other side. The atlas label at each peak now also works when
  the map and the atlas are on different grids.
- **The sidebar header's buttons close up in a narrow sidebar** instead of crowding the MRLatte
  name; the name and version give way to the logo only below 270 px.
- **The app stays responsive during a DICOM import.** The conversion used to hold up every other
  request until it finished; it now runs in the background, uploads are copied to disk instead of
  being held in memory, and the log records how long each step took.
- **Atlas overlap for several atlases at once.** Tick the atlases you want; the table gets an Atlas
  column, and so does its CSV.
- **Undo and Redo say what they will do.** Hover over either button: "Undo: Pen stroke",
  "Redo: Dilate".
- **Editing a mask turns the crosshair off**, as entering draw mode any other way does, and turns
  it back on when you stop drawing.
- **Chosen items are easier to see in the dark theme.** Selected atlases and active draw mode now
  use the accent tint, and pressed buttons are a step brighter.
- **MRLatte fits in a much narrower window**: 560 px wide with the sidebar open (was 880) and 320 px
  with it closed (was 480). The sidebar can be dragged down to 220 px (was 260).
- **You can see when a module is installing.** While a module or atlas downloads and installs, the
  module store icon (sidebar header and collapsed rail) has a turning ring and says how many are
  installing, even with the store and the Atlas Manager closed.
- **An edited lesion mask keeps its look.** Editing a mask in Draw mask and saving it used to give
  the saved mask the next colour in the palette (a red mask came back blue) and default ranges. It
  now keeps the colour map, opacity, visibility range and colour range it had.
- **One scrollbar style everywhere.** Every scrolling list now uses the slim themed scrollbar;
  several still showed the thick system one.
- **The installer has its own icon**: the MRLatte icon with a download badge, so the setup file is
  easy to tell apart from the app.

## [0.5.0] — 2026-10-29

Much faster and a third smaller, small workspaces that link to your scans (or hold everything) and
open with a double-click, a clearer module store, an Atlas Manager where each atlas installs and is
removed on its own (your own too), turn pivots, an optional white background and a dozen smaller
improvements.

### Faster
- **Startup: about 3.6 s instead of 19–24 s** to the brain on screen. Checking the tractography and
  network-mapping files (often linked from a network drive) used to read the whole connectome and
  hold up everything else for ~15 s. It now reads only what it needs, remembers the answer until the
  file changes, and never blocks the rest of the app. The quality-check warm-up also runs in the
  background now.
- **Drawing:** a stroke now finishes in about 16 ms instead of about 40 ms plus a quarter-second of
  follow-on work; undo takes 6–10 ms instead of 23 ms.
- **No more long freeze right after you start drawing.** The visual-field legend used to load four
  hidden full-size maps into the viewer as soon as a lesion existed (stalls of up to 27 s were seen).
  They are now kept off the graphics card; a map is shown only when you turn it on.
- **Layer changes no longer freeze:** dragging an opacity, colour or position control used to stall
  for up to 5–6 seconds at a time. Each change now takes a steady ~47 ms.

### Smaller
- **Installer 133 MB (was 258 MB); installed size about 407 MB (was 917 MB).** The app no longer
  carries copies of packages that were already built into its interface (227 MB), ships only the
  English language pack, leaves out the parts below and the atlases that only some people need
  (each a one-click install), and drops a duplicate copy of the DICOM converter and files only
  needed to compile code.
- **Optional features install and remove with one click** from the module store. A module counts as
  in use only while a job that needs it is running: opening its panel doesn't count, and once the
  result is back (say, the difference map is in the viewer) it can be removed at once. While a job
  runs, the store asks you to remove it once that finishes. Longitudinal comparison and atlas
  validation now run in their own process, like dissection and network mapping already did.
- **Longitudinal comparison is now a one-click module** in the standard installer. Until SimpleITK
  is installed, the panel opens the module store at it (a 19 MB download from PyPI, checked against
  a pinned hash); after that it works as before, also after restarting. The full installer still
  includes it.
- **Tract dissection's engine (dipy) is a one-click module** (a 15 MB download, 35 MB installed).
  Dissection also needs the whole-brain tractogram, so only people who add one need it; the
  Tract Dissection section lists both, each with its install button.
- **The network-map figures and the retinotopy validation toolkit are one-click modules too** (they
  used to say "not installable from the app"). Network-map figures (nilearn, matplotlib, pandas) is a
  51 MB download; the validation toolkit (neuropythy) 41 MB. Every file comes from PyPI and is
  checked against a pinned hash. The full installer still includes all of these. LQTpy Analysis and
  the reports need none of them.

### Atlases
- **The Atlas Manager is one window for everything to do with atlases:** the template, every atlas,
  the tract and retinotopy atlases, the catalog of further atlases and your own. Open it from the
  Atlases section or the module store, which now lists all of these as one row.
- **Each atlas installs and is removed on its own**, the MNI152 template too; removing one says what
  stops working without it. The template and the seven core atlases still come with the installer
  and reinstall from MRLatte's own copy, without a download. The tract atlases (HCP1065, HCP842,
  IIT, JHU), the retinotopy maps (Benson 2014, Wang 2015) and the atlas-validation surfaces download
  when you install them, from the project's GitHub release, each file checked against a pinned hash.
- **Add your own atlas** with the button, or drop a `.nii`/`.nii.gz` (and its label file) onto the
  window. Besides label volumes, 4-D probability atlases (one map per region, like the tract
  atlases) now import: MRLatte builds the label map at a cut-off you choose and keeps the per-region
  maps, so reports break a lesion down by them as they do for HCP1065.
- **Removing the template takes effect at once:** the viewer goes empty with your overlays kept, and
  a notice (which you can minimise) says how to get a base back. Reinstalling the template loads it.
- **Removing an atlas also removes the left/right copies split from it;** the confirmation names
  them.
- **Every removal can be undone for 5 seconds** from its notification. Messages like "Uninstall
  complete" now clear themselves after a few seconds; errors stay until you dismiss them.
- The catalog of further atlases no longer offers second copies of the atlases MRLatte ships.
- Confirm and Cancel sit on the right, under the button you pressed. The module store and the Atlas
  Manager open with a short animation, and opening one from a section's install prompt brings you
  to that module and highlights it.
- **Fixed:** the Atlases section was greyed out even with atlases installed; an atlas removed in the
  installed app came back the next time MRLatte started; and the catalog of further atlases was
  empty there.

### Workspaces
- **Saved as `.mrlatte` and opened by double-click** in Explorer. Workspaces saved by earlier versions
  (`.nvws.json`) still open from the Open button.
- **A workspace now holds everything:** a custom base volume, the unsaved drawing, layer notes, the
  mosaic settings and saved MNI coordinates, alongside the layers, view and crosshair it already
  kept.
- **Small by default:** Save asks how. **Link to the files** (the highlighted choice) saves where each
  scan is on disk plus every setting and adjustment, so the file is a few kilobytes and opens wherever
  those files are (this computer or a shared drive). **Embed everything** puts a copy of every scan
  inside, so it opens on any computer. The unsaved drawing, and any layer made in the app, is always
  embedded.
- **A DICOM base is converted again** when a linked workspace opens, from its original folder or zip,
  with a message saying why it takes a moment.
- **If a linked file has moved**, the rest of the workspace still opens and MRLatte lists the files it
  couldn't find. Files on another computer (a network share) are read only after you say yes.
- **Fixed: opening a workspace always showed the MNI template** instead of the base it was made on.
  It now loads its own base, or switches back to the template if that is what it was made on. A
  workspace saved by an earlier version with a custom base can't bring that base back, and says so.
- A workspace with a custom base or linked files can't be opened by MRLatte 0.4.x.

### New
- **Turn about:** the position block's turns (and resizes) can pivot on the centre of the visible
  voxels (the default), their centre of mass, or the crosshair. Changing the pivot never moves the
  layer. An **update** button turns yellow when the pivot is out of date (the visibility window
  changed, or the crosshair moved in crosshair mode). Layers adjusted in earlier versions keep their
  position.
- **Optional white viewer background** for figures and screenshots: the square button next to
  Radiological. The viewer stays black by default, which is better for reading scans.
- **Invert colormap on the base volume**, in the slices and the 3D render.
- **Lock the colour range to the visibility values:** a lock beside a layer's colour range makes the
  colours span exactly the values that are shown, and follow them as you change the visibility.
- **Direction letters on the move bars** (L–R, P–A, I–S) and a **reset button for each bar**.
- **MNI coordinates menu:** the coordinate box (and any saved coordinate) turns green when the
  crosshair is on it, and clicking in the viewer no longer closes the menu.
- **Loading screen** shows what is happening: starting the analysis engine (with seconds), loading
  the interface, the brain template, the module check. The logo stays put; the steps list below it.
- **Sections whose module isn't installed are greyed out** (they still open, to offer the install).
- **The version number links to its release page** on GitHub.

### Changed
- **Reports are redesigned, with real figures.**
  - Both the lesion report and the LQTpy Analysis report open with a few short sentences — size,
    side and centre, the main regions, and the visual field, tracts and network when those ran —
    then a figure of the lesion on the scan: three views through its centre and axial slices across
    it, labelled left/right. It is drawn from the volumes themselves, so it needs no extra module
    and still shows when a saved report is opened later. The PDF export includes it too, with the
    same short lead and each atlas's top five regions.
  - The LQTpy Analysis report adds still figures of the affected tracts and of the positive and
    negative network. The report is the run's one figure output: the interactive viewer pages it
    used to make (which showed blank in a saved report) are gone, and Download offers the run's data
    — the maps and the overlap table.
  - More concise: tables show their top five rows (with a bar for each region's share), the rest
    folded under "N more"; the long-form detailed measures are folded at the end; each analysis
    has its own heading instead of three "Key Statistics"; visual-field maps appear only when a
    retinotopy map found something; "not available" notes are one line; and how the report was made
    (engine, atlases, inputs) is a short Method list at the end. Prints cleanly on A4.
- **The module store is redesigned:** one line per module (status, name, size and the one action that
  matters), grouped as Needs attention, Installed and Available. Licence, file choices, Verify and
  Remove sit under each module; file lists and hashes under Technical details.
- **Saved MNI coordinates last for the session** (and travel in workspaces) instead of reappearing in
  every later session.
- **The base volume no longer has move and turn controls.** Overlays and the drawing keep theirs.
- **The colour bar in the viewer spans the visibility window** (the values actually shown), coloured
  as those values are drawn, instead of the colour range.
- **Switching to Asymmetric from Axial, Coronal or Sagittal** keeps that view as the large one.
- **Quality check uses [LQTpy 0.7.0](https://github.com/rohan3412/LQTpy/releases/tag/v0.7.0).** It
  also flags comb-like and blocky drawings and slices drawn only partly (each with Go to), and
  several smaller findings together now make a mask "fix before use". It is faster; everything else
  it reports is unchanged. The quality check and the LQTpy analysis setup name the lqtpy version
  they run on, with a link to its release.
- **Undo notifications show how long they stay:** a bar along the bottom drains until the Undo is
  gone, and holds while the pointer is over it.
- **Asymmetric from Multiplanar + 3D** makes the highlighted view (the one last clicked or scrolled
  in) the large one.

### Fixed
- **The visual-field maps in reports** showed whatever the Retinotopy panel happened to show —
  often an empty disc, once even "select a lesion". They are now drawn for the report's own lesion
  (and in the LQTpy Analysis report too), so they agree with the findings table beside them.
- **Deleting a lesion left it in the 3D render** (also after loading a new base). It now goes from
  every view.
- **Auto colour range and auto visibility gave the wrong values** for scans stored as whole numbers
  with a scale factor (the MNI152 template is one): the window came out in the stored numbers, not
  the values shown.
- A retinotopy layer that had been loaded for the legend turned on at 0 % opacity.
- Updates now refresh the module list, so new or changed modules reach existing installs.

### Install
Download `MRLatte-Setup-0.5.0-mini-x64.exe` and run it. It installs over any earlier version.

## [0.4.1] — 2026-10-22

One-click fixes for stray marks, interpolation for erasing, moving the drawing itself, a new
hold-to-move control, an optional white viewer background, and LQTpy 0.6.1.

### New
- **Fix button in the quality check.** Findings MRLatte can safely clean up (stray specks and
  strokes, marks along the edge of the scan, parts outside the brain) now have a **Fix** button next
  to **Go to**. It removes just those voxels and nothing else. The message says how many were
  removed, and its **Undo** puts them back (so does the usual Undo). Findings that would need voxels
  *added* (gaps, holes, outlines) still have only Go to.
- **Interpolate erasing.** Erase the same shape on two slices of one view (right-drag with the Pen,
  or the 2D Brush) and press **Interpolate**: the shape is carved out of every slice in between.
  **Interpolate all** now fills between drawn slices and carves between erased slices in one go.
- **Move, turn and resize the drawing.** The Draw panel has the same **position** block as layers:
  move (mm), turn (degrees) and size (%). It moves the drawn voxels themselves, keeps each pen
  colour, and each adjustment is one Undo. The numbers show the adjustment since your last other
  edit and go back to zero when you draw, erase or undo.
- **Hold-to-move bars instead of sliders** in every position block (layers, base, drawing). The
  middle is still. Press and hold either side to move, and release to stop. Speed rises steeply
  towards the ends: slow and fine over most of the bar, and up to 100 mm/s, 180°/s and 200 %/s at
  the very end. Hovering shows the speed it would move at. The arrow keys still step, and the number
  boxes are unchanged.
- **Turning has no limit.** Holding a turn bar keeps turning round and round. Angles are shown
  between −180° and 180°, so 190° reads as −170°, which is the same turn.
- **Sagittal flip.** A small ⇄ button on the Sagittal view button makes the nose point left or right
  in every sagittal view, mosaic included. It is a turn of the view, not a mirror, so the A/P letters
  swap with it. It is remembered with your other view settings.
- **Optional white viewer background**, for figures and screenshots: the square button next to
  Radiological. The viewer and the empty space round the head in the 2D slices turn white, while
  dark tissue (ventricles, CSF) stays black. It works in either theme and is saved with the
  workspace. The viewer stays black by default, which is better for reading scans.

### Changed
- **Quality check uses LQTpy 0.6.1.** It now catches a slice forgotten in the middle of a large
  lesion, and grades far-off stray specks at least "Check".
- **The version number** now sits next to the MRLatte name at the top of the sidebar.

### Fixed
- **Dropping a NIfTI file on the viewer** swapped what was shown but left the dashboard showing the
  previous file's name and layers. A dropped file is now opened the same way as a double-click in
  Explorer: a scan becomes the base; a lesion or activation map is added as an overlay, with a "Use
  as base instead" option.
- **"Open with" showed "Electron"** instead of MRLatte on PCs that ever had version 0.3.x installed.

## [0.4.0] — 2026-10-09

The first release since 0.3.0. It has a quality check for drawn lesions, manual repositioning of
overlays, a placeholder app icon, and a fix for updates that seemed not to take.

### New
- **App icon (placeholder).** MRLatte no longer shows Electron's default icon. The icon in this
  release is a stand-in, to be replaced by a final design in a later release.
- **Quality check for drawn lesions.** When you Save or Download a drawing, MRLatte checks it with
  LQTpy 0.6.0 and tells you if something looks wrong: drawn on some slices only, left as an outline,
  drawn on a single slice, stray marks, parts outside the brain.
  - Each finding is graded (minor, moderate, major) and the drawing gets an overall verdict.
  - **Go to** jumps the viewer to where the problem is; **Interpolate all** is offered when slices
    were skipped.
  - Small notes never interrupt you, and you're never asked twice about the same drawing.
  - While you draw, an orange box appears on the viewer if the drawing looks wrong after 30 seconds
    without drawing.
  - The check can never stop you saving: if it can't run, saving goes ahead as normal.
- **Move, rotate and resize by hand.** Every lesion mask, activation map and the base volume has a
  **position** block in its layer card: move (mm), turn (degrees) and size (%), plus reset.
  Analyses, downloads and saved workspaces use the adjusted position; the file's voxels are never
  changed. A workspace containing an adjusted layer can't be opened by MRLatte 0.3.x.
- **View NIfTI headers** from a button on every layer card, with "Show all fields" for every raw
  header field.
- **Right-click menu in Explorer:** **MRLatte › Open** and **MRLatte › View NIfTI header** on `.nii`
  and `.nii.gz` files (an install option, on by default).
- **`mrlatte://` links can open a base scan plus overlays**, e.g.
  `mrlatte://open?base=C:\scans\t1.nii.gz&overlay=C:\scans\lesion.nii.gz`. Up to 8 local files;
  overlay types are detected automatically or forced with `&overlaytype=`.
- **Smaller window with the sidebar closed** (down to 480 px wide).
- **Version shown** in the status bar.

### Fixed
- **After updating, MRLatte could keep showing the previous version's screen** for hours or days.
  It now always checks for the current interface and clears its cache the first time a new version
  starts.
- **Opening a scan as the base from Explorer or a `mrlatte://` link** failed with "Cannot read
  properties of undefined (reading 'toUpperCase')".
- **Interpolate All now works with the Brush** (2D and 3D), not only the Pen.
- **"Current drawing (unsaved)"** is no longer offered when nothing is drawn.

### Changed
- **Interpolate All orientation menu** follows the view you last drew in, outlines the selected view
  and greys out views without two drawn slices.
- **One-Click Summary is now "LQTpy Analysis".**

## Earlier releases

- **0.3.0** — see https://github.com/cogneuro-rgb/MRLatte/releases/tag/v0.3.0
- Releases before 0.3.0 had no published notes.
