// Viewer-only installer (yarn dist:win:viewer, dist:mac:<arch>:viewer): the
// standard build config from frontend/package.json under another name. It
// packages whatever assemble-bundle -Viewer (or assemble-bundle.sh --viewer)
// staged: a Python with just the server and its module store, no bundled data
// modules. build-viewer.bat / build-mac.sh --viewer run both steps.
//
// A JS file, not a JSON overlay: electron-builder uses a `-c` file INSTEAD of
// package.json's "build" (it does not merge them, and a JSON one can't hold a
// comment either), so a flavour has to start from that config itself.
const base = require("../../frontend/package.json").build;

module.exports = {
  ...base,
  win: { ...base.win, artifactName: "MRLatte-Setup-${version}-viewer-${arch}.${ext}" },
  mac: { ...base.mac, artifactName: "MRLatte-${version}-mac-viewer-${arch}.${ext}" },
};
