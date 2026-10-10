#!/usr/bin/env python3
"""Create an xctestrun v2 manifest from target-only simulator build products.

Common manifest keys follow the locally installed `man xcodebuild.xctestrun`
schema. IsUITestBundle/IsAppHostedTestBundle are version-sensitive Xcode runner
metadata, experimentally verified with Xcode 26.6. Omitting IsUITestBundle made
the UI runner fail before its first action, so revalidate after Xcode upgrades.
All paths and bundle identifiers come from the supplied build and Xcode tree.
This only describes local test artifacts; it does not run tests or sign apps.
"""

import argparse
import plistlib
from pathlib import Path


def read_info(bundle: Path) -> dict:
    with (bundle / "Info.plist").open("rb") as source:
        info = plistlib.load(source)
    for key in ("CFBundleIdentifier", "CFBundleExecutable"):
        if not isinstance(info.get(key), str) or not info[key]:
            raise ValueError(f"{bundle} is missing {key}")
    if not (bundle / info["CFBundleExecutable"]).is_file():
        raise ValueError(f"{bundle} does not contain its executable")
    return info


def manifest(products: Path, developer_dir: Path) -> dict:
    platform = developer_dir / "Platforms/iPhoneSimulator.platform"
    app = products / "Rally.app"
    unit_bundle = app / "PlugIns/RallyTests.xctest"
    ui_host = products / "RallyUITests-Runner.app"
    ui_bundle = ui_host / "PlugIns/RallyUITests.xctest"
    app_info = read_info(app)
    read_info(unit_bundle)
    ui_info = read_info(ui_host)
    read_info(ui_bundle)

    injection = platform / "Developer/usr/lib/libXCTestBundleInject.dylib"
    if not injection.is_file():
        raise ValueError(f"Missing XCTest bundle injection library: {injection}")
    environment = {
        "DYLD_FRAMEWORK_PATH": ":".join(map(str, [
            products,
            platform / "Developer/Library/Frameworks",
            platform / "Developer/Library/PrivateFrameworks",
        ])),
        "DYLD_LIBRARY_PATH": f"{products}:{platform / 'Developer/usr/lib'}",
    }
    shared = {
        "ParallelizationEnabled": False,
        "SystemAttachmentLifetime": "deleteOnSuccess",
        "UserAttachmentLifetime": "keepAlways",
    }
    unit = shared | {
        "BlueprintName": "RallyTests",
        "ProductModuleName": "RallyTests",
        "TestBundlePath": str(unit_bundle),
        "TestHostPath": str(app),
        "TestHostBundleIdentifier": app_info["CFBundleIdentifier"],
        "IsAppHostedTestBundle": True,
        "IsUITestBundle": False,
        "TestingEnvironmentVariables": environment | {
            "DYLD_INSERT_LIBRARIES": str(injection),
            "XCInjectBundleInto": str(app / app_info["CFBundleExecutable"]),
        },
        "DependentProductPaths": [str(app), str(unit_bundle)],
    }
    ui = shared | {
        "BlueprintName": "RallyUITests",
        "ProductModuleName": "RallyUITests",
        "TestBundlePath": str(ui_bundle),
        "TestHostPath": str(ui_host),
        "TestHostBundleIdentifier": ui_info["CFBundleIdentifier"],
        "UITargetAppPath": str(app),
        "UITargetAppBundleIdentifier": app_info["CFBundleIdentifier"],
        "IsUITestBundle": True,
        "TestingEnvironmentVariables": environment,
        "DependentProductPaths": [str(app), str(ui_host), str(ui_bundle)],
    }
    return {
        "__xctestrun_metadata__": {"FormatVersion": 2},
        "TestPlan": {"Name": "Rally simulator fallback", "IsDefault": True},
        "TestConfigurations": [{"Name": "Debug", "IsEnabled": True, "TestTargets": [unit, ui]}],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--products", required=True, type=Path)
    parser.add_argument("--developer-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = manifest(args.products.resolve(), args.developer_dir.resolve())
    except (FileNotFoundError, ValueError) as error:
        parser.error(f"{error}; build both RallyTests and RallyUITests first")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("wb") as output:
        plistlib.dump(result, output)
    print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
