#!/usr/bin/env bash
set -euo pipefail
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath artifacts/ios-sim CODE_SIGNING_ALLOWED=NO IPHONEOS_DEPLOYMENT_TARGET=16.0 build > artifacts/ios-simulator-build.log 2>&1 || { tail -100 artifacts/ios-simulator-build.log; exit 1; }
device=$(xcrun simctl list devices available -j | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const d=Object.values(JSON.parse(s).devices).flat().find(d=>d.name.startsWith("iPhone"));if(!d)process.exit(1);console.log(d.udid)})')
defaults write com.apple.iphonesimulator ConnectHardwareKeyboard -bool false
xcrun simctl boot "$device"
xcrun simctl bootstatus "$device" -b
xcrun simctl install "$device" artifacts/ios-sim/Build/Products/Release-iphonesimulator/App.app
xcrun simctl launch "$device" com.pocketmingw.ide --pocket-self-test
container=$(xcrun simctl get_app_container "$device" com.pocketmingw.ide data)
for attempt in $(seq 1 240); do
  if [ -f "$container/Documents/PocketMinGW/simulator-result.json" ]; then
    cp "$container/Documents/PocketMinGW/simulator-result.json" artifacts/ios-simulator-result.json
    xcrun simctl io "$device" screenshot artifacts/ios-screen.png
    node -e 'const r=require("./artifacts/ios-simulator-result.json");console.log(r);if(r.error||r.exitCode!==0||r.files?.["BAI.OUT"]!=="42\n")process.exit(1)'
    break
  fi
  sleep 1
done
test -f artifacts/ios-simulator-result.json || { echo 'Simulator compiler test did not complete'; exit 1; }
xcrun simctl terminate "$device" com.pocketmingw.ide
xcrun simctl launch "$device" com.pocketmingw.ide --pocket-keyboard-test
for attempt in $(seq 1 60); do
  if [ -f "$container/Documents/PocketMinGW/keyboard-open.json" ] && [ ! -f artifacts/ios-keyboard-open.json ]; then
    cp "$container/Documents/PocketMinGW/keyboard-open.json" artifacts/ios-keyboard-open.json
    xcrun simctl io "$device" screenshot artifacts/ios-keyboard.png
  fi
  if [ -f "$container/Documents/PocketMinGW/keyboard-closed.json" ]; then
    cp "$container/Documents/PocketMinGW/keyboard-closed.json" artifacts/ios-keyboard-closed.json
    node scripts/check-keyboard-result.mjs
    exit 0
  fi
  sleep 1
done
echo 'Simulator keyboard test did not complete'; exit 1
