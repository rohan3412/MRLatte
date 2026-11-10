#!/usr/bin/env bash
# Builds the macOS disk image (core build) for this Mac's architecture, or the
# one given with --arch arm64|x64. The macOS counterpart of build-minimal.bat:
# assemble the offline bundle, then package it. Needs internet, Node + yarn
# the first time; re-runs reuse tools/build/downloads/.
#
# Output: ../MRLatte-build/electron/MRLatte-<version>-<arch>.dmg (unsigned,
# ad-hoc signed; see README "Building for macOS").
set -euo pipefail
cd "$(dirname "$0")"

ARCH=""; VIEWER=""
if [ "${1:-}" = "--arch" ]; then ARCH="${2:-}"; fi
# --viewer (anywhere): the viewer-only disk image, see assemble-bundle.sh --viewer.
for a in "$@"; do [ "$a" = "--viewer" ] && VIEWER=1; done
if [ -z "$ARCH" ]; then
  case "$(uname -m)" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
fi

echo "=== 1/2: Assembling the offline bundle ($ARCH) ==="
bash tools/build/assemble-bundle.sh --arch "$ARCH" ${VIEWER:+--viewer}

echo
echo "=== 2/2: Building the frontend and packaging the disk image ==="
(cd frontend && yarn "dist:mac:$ARCH${VIEWER:+:viewer}")

echo
echo "Done. The disk image is in ../MRLatte-build/electron/"
