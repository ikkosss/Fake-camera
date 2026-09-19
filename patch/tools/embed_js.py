#!/usr/bin/env python3
"""Generate a Java class that carries camera_shim.js as a string constant.

Usage: embed_js.py <camera_shim.js> <output-dir>
"""
import os
import sys

TEMPLATE = """package mark.via.fakecam;

/** Generated from camera_shim.js by patch/tools/embed_js.py. Do not edit by hand. */
final class CameraShim {{

    static final String SOURCE = {literal};

    private CameraShim() {{
    }}
}}
"""

ESCAPES = {
    "\\": "\\\\",
    '"': '\\"',
    "\n": "\\n",
    "\r": "",
    "\t": "\\t",
}


def java_literal(text):
    chunks = []
    for line in text.splitlines(keepends=True):
        escaped = "".join(ESCAPES.get(ch, ch) for ch in line)
        chunks.append(f'"{escaped}"')
    return "\n            + ".join(chunks)


def main():
    source, out_dir = sys.argv[1], sys.argv[2]
    with open(source, encoding="utf-8") as fh:
        script = fh.read()

    package_dir = os.path.join(out_dir, "mark", "via", "fakecam")
    os.makedirs(package_dir, exist_ok=True)
    target = os.path.join(package_dir, "CameraShim.java")
    with open(target, "w", encoding="utf-8") as fh:
        fh.write(TEMPLATE.format(literal=java_literal(script)))
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
