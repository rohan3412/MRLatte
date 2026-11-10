"use strict";
// electron-builder afterPack hook: ad-hoc sign the macOS app before the disk
// image is made. A no-op for every other platform.
//
// The macOS build is for the team, without an Apple Developer ID
// (package.json build.mac.identity is null, so electron-builder signs nothing).
// But Apple Silicon refuses to run code with a missing or broken signature, and
// packaging breaks the one Electron ships with (it rewrites Info.plist and
// renames the binary). An ad-hoc signature ("-") makes the app runnable; the
// first launch still needs System Settings > Privacy & Security > Open Anyway,
// or `xattr -dr com.apple.quarantine /Applications/MRLatte.app` (README).
//
// electron-builder 25 has no ad-hoc identity of its own, hence this hook.
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  console.log(`  • ad-hoc signing  ${app}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", app], { stdio: "inherit" });
};
