#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP="dist/WorkboardCapture.app/Contents"
mkdir -p "$APP/MacOS" "$APP/Resources" .runtime/swift-cache
xcrun swiftc -module-cache-path "$PWD/.runtime/swift-cache" -O native/Capture.swift -o "$APP/MacOS/WorkboardCapture" -framework AppKit -framework Carbon
cat > "$APP/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.workboard.capture</string>
<key>CFBundleName</key><string>Workboard Capture</string>
<key>CFBundleExecutable</key><string>WorkboardCapture</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>NSScreenCaptureUsageDescription</key><string>Capture a region you select and attach it to your local project.</string>
</dict></plist>
PLIST
codesign --force --sign - dist/WorkboardCapture.app
