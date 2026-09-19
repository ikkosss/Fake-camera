#!/usr/bin/env python3
"""Insert the FakeCamera hook at the head of Via's onShowFileChooser implementation.

The browser fragment (obfuscated to Lc8/s6;) receives every file-upload request in
X(ValueCallback, FileChooserParams). The hook runs first: when it opens the gallery it returns
true and X returns immediately, otherwise the untouched original code runs.

Usage: inject_hook.py <path-to-c8/s6.smali>
"""
import sys

METHOD = ".method public X(Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient$FileChooserParams;)Z"
ANCHOR = "    iput-object p1, p0, Lc8/s6;->F0:Landroid/webkit/ValueCallback;"
MARKER = "Lmark/via/fakecam/FakeCamera;"

HOOK = """
    invoke-static {p0, p2}, Lmark/via/fakecam/FakeCamera;->interceptCapture(Landroidx/fragment/app/Fragment;Landroid/webkit/WebChromeClient$FileChooserParams;)Z

    move-result v0

    if-eqz v0, :fakecam_default

    const/4 p1, 0x1

    return p1

    :fakecam_default
"""


def patch(text):
    if MARKER in text:
        raise SystemExit("hook already present")

    start = text.find(METHOD)
    if start < 0:
        raise SystemExit(f"method not found: {METHOD}")

    anchor = text.find(ANCHOR, start)
    if anchor < 0:
        raise SystemExit(f"anchor not found inside method: {ANCHOR}")

    end_of_method = text.find(".end method", start)
    if not start < anchor < end_of_method:
        raise SystemExit("anchor lies outside the target method")

    cut = anchor + len(ANCHOR)
    return text[:cut] + HOOK + text[cut:]


def main():
    path = sys.argv[1]
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(patch(text))
    print(f"patched {path}")


if __name__ == "__main__":
    main()
