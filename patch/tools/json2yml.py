#!/usr/bin/env python3
"""Convert APKTool M's apktool.json into the apktool.yml that upstream Apktool expects.

APKTool M (the Android app used to decompile the APK) stores build metadata as JSON, while
Apktool 2.x reads apktool.yml. Keys that upstream Apktool no longer supports are dropped.

Usage: json2yml.py <apktool.json> <apktool.yml> <apktool-version>
"""
import json
import sys


def quote(value):
    return "null" if value is None else f"'{value}'"


def convert(meta, tool_version):
    pkg = meta.get("PackageInfo") or {}
    sdk = meta.get("sdkInfo") or {}
    ver = meta.get("VersionInfo") or {}
    framework = meta.get("UsesFramework") or {}

    lines = [
        "!!brut.androlib.meta.ApkInfo",
        f"apkFileName: {meta.get('apkFileName')}",
        f"compactEntries: {str(bool(meta.get('compactEntries'))).lower()}",
        "doNotCompress:",
    ]
    lines += [f"- {entry}" for entry in meta.get("doNotCompress", [])]

    lines.append("packageInfo:")
    lines.append(f"  forcedPackageId: {quote(pkg.get('forcedPackageId'))}")
    lines.append(f"  renameManifestPackage: {quote(pkg.get('renameManifestPackage'))}")

    lines.append("sdkInfo:")
    for key in ("minSdkVersion", "targetSdkVersion", "maxSdkVersion"):
        if sdk.get(key):
            lines.append(f"  {key}: {quote(sdk[key])}")

    lines.append(f"sparseResources: {str(bool(meta.get('sparseResources'))).lower()}")

    lines.append("usesFramework:")
    lines.append("  ids:")
    lines += [f"  - {framework_id}" for framework_id in framework.get("ids", [1])]
    lines.append(f"  tag: {quote(framework.get('tag'))}")

    lines.append(f"version: {tool_version}")
    lines.append("versionInfo:")
    lines.append(f"  versionCode: {quote(ver.get('versionCode'))}")
    lines.append(f"  versionName: {ver.get('versionName')}")

    return "\n".join(lines) + "\n"


def main():
    src, dst, tool_version = sys.argv[1], sys.argv[2], sys.argv[3]
    with open(src, encoding="utf-8") as fh:
        meta = json.load(fh)
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write(convert(meta, tool_version))
    print(f"wrote {dst}")


if __name__ == "__main__":
    main()
