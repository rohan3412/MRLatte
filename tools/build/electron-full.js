// Full installer (yarn dist:win:full): the standard build config from
// frontend/package.json plus the optional Python stacks, so the installer can
// offer them. Run tools/build/assemble-bundle.ps1 -Full FIRST so each
// MRLatte-build/MRLatte/python-* folder below exists; electron-builder errors
// on a missing `from` path.
//
// A JS file, not a JSON overlay: electron-builder uses a `-c` file INSTEAD of
// package.json's "build" (it does not merge them), and the old JSON overlay
// lost the app id, protocols, NSIS settings, afterPack and output folder.
const base = require("../../frontend/package.json").build;

const stacks = ["python-reports", "python-validation", "python-longitudinal",
  "python-dissection", "python-scipy", "python-lqtpy"];

module.exports = {
  ...base,
  extraResources: [
    ...base.extraResources,
    ...stacks.map((d) => ({ from: `../../MRLatte-build/MRLatte/${d}`, to: d })),
  ],
  win: { ...base.win, artifactName: "MRLatte-Setup-${version}-full-${arch}.${ext}" },
};
