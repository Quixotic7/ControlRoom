#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP="dist/ControlRoomCapture.app/Contents"
mkdir -p "$APP/MacOS" "$APP/Resources" .runtime/swift-cache
SIGNING_IDENTITY="${CONTROLROOM_SIGNING_IDENTITY:--}"
# Do not change an ad-hoc identity just because the build command ran again.
# Explicit certificates give macOS a stable designated requirement across edits.
BUILD_KEY="$( { shasum -a 256 native/Capture.swift scripts/build-native.sh; xcrun swiftc --version; uname -m; printf '%s\n' "$SIGNING_IDENTITY"; } | shasum -a 256 | cut -d ' ' -f 1)"
if [ -f .runtime/capture-build-key ] && [ "$(cat .runtime/capture-build-key)" = "$BUILD_KEY" ] && codesign --verify --deep --strict dist/ControlRoomCapture.app 2>/dev/null; then
  echo "Capture companion unchanged; preserving its existing signing identity."
  exit 0
fi
xcrun swiftc -module-cache-path "$PWD/.runtime/swift-cache" -O native/Capture.swift -o "$APP/MacOS/ControlRoomCapture" -framework AppKit -framework Carbon
cat > "$APP/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.workboard.capture</string>
<key>CFBundleName</key><string>ControlRoom Capture</string>
<key>CFBundleExecutable</key><string>ControlRoomCapture</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSScreenCaptureUsageDescription</key><string>Capture a region you select and attach it to your local project.</string>
</dict></plist>
PLIST
SIGNING_MODE="certificate"
if [ "$SIGNING_IDENTITY" = "-" ]; then SIGNING_MODE="ad-hoc"; fi
/usr/libexec/PlistBuddy -c "Add :ControlRoomSigningMode string $SIGNING_MODE" "$APP/Info.plist"
codesign --force --sign "$SIGNING_IDENTITY" dist/ControlRoomCapture.app
printf '%s\n' "$BUILD_KEY" > .runtime/capture-build-key
