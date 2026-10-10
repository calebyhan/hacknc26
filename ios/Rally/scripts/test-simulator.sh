#!/bin/bash
set -euo pipefail

# Fallback when Xcode's scheme destination picker rejects an installed runtime.
# Uses target-only compilation and xctestrun v2 with experimentally verified
# Xcode 26.6 runner metadata (see generator). It does not install runtimes or
# change the user's SDK-to-runtime matching policy.
if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <available-iOS-simulator-UDID>" >&2
    exit 64
fi

rally_simulator_id="$1"
rally_app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
rally_developer_dir="$(xcode-select -p)"

# Fail before building if the explicit destination is unavailable or not iOS.
xcrun simctl list devices available --json | python3 -c '
import json, sys
requested = sys.argv[1]
devices = json.load(sys.stdin)["devices"]
found = any(device["udid"] == requested
            for runtime, entries in devices.items() if ".iOS-" in runtime
            for device in entries)
if not found:
    sys.exit("Choose an available iOS simulator UDID from: xcrun simctl list devices available")
' "$rally_simulator_id"

mkdir -p "$rally_app_dir/TestResults"
rally_run_dir="$(mktemp -d "$rally_app_dir/TestResults/run-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
rally_build_dir="$rally_app_dir/DerivedData/TestBuild"

cd "$rally_app_dir"
xcodebuild build -project Rally.xcodeproj -target RallyTests -target RallyUITests \
    -sdk iphonesimulator -configuration Debug -hideShellScriptEnvironment \
    ARCHS=arm64 ONLY_ACTIVE_ARCH=YES CODE_SIGNING_ALLOWED=NO \
    "SYMROOT=$rally_build_dir/Products" "OBJROOT=$rally_build_dir/Objects" \
    2>&1 | tee "$rally_run_dir/build.log"

python3 "$rally_app_dir/scripts/make-xctestrun.py" \
    --products "$rally_build_dir/Products/Debug-iphonesimulator" \
    --developer-dir "$rally_developer_dir" \
    --output "$rally_run_dir/Rally.xctestrun"

echo "Running on $rally_simulator_id; evidence: $rally_run_dir"
xcodebuild test-without-building -xctestrun "$rally_run_dir/Rally.xctestrun" \
    -destination "platform=iOS Simulator,id=$rally_simulator_id" \
    -destination-timeout 30 -parallel-testing-enabled NO \
    -resultBundlePath "$rally_run_dir/Rally.xcresult" \
    2>&1 | tee "$rally_run_dir/tests.log"
