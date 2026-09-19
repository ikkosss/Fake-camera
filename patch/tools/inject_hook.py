#!/usr/bin/env python3
"""Wire the FakeCamera hooks into Via's obfuscated smali.

Three call sites are patched:

* Lc8/s6;->X(ValueCallback, FileChooserParams)  -- WebChromeClient.onShowFileChooser, the file
  upload path. The hook opens the gallery for capture requests and makes X return early.
* Lp4/j;->onPageStarted(WebView, String, Bitmap) -- injects the getUserMedia shim as the new
  document starts loading.
* Lp4/c;->onProgressChanged(WebView, int) -- second chance to inject the shim, in case the
  page-start injection landed too early. The script itself is idempotent.

Usage: inject_hook.py <decoded-apk-root>
"""
import os
import sys

MARKER = "Lmark/via/fakecam/FakeCamera;"

FILE_CHOOSER_HOOK = """
    invoke-static {p0, p2}, Lmark/via/fakecam/FakeCamera;->interceptCapture(Landroidx/fragment/app/Fragment;Landroid/webkit/WebChromeClient$FileChooserParams;)Z

    move-result v0

    if-eqz v0, :fakecam_default

    const/4 p1, 0x1

    return p1

    :fakecam_default
"""

PAGE_STARTED_HOOK = """
    invoke-static {p1}, Lmark/via/fakecam/FakeCamera;->injectCameraShim(Landroid/webkit/WebView;)V
"""

PROGRESS_HOOK = """
    invoke-static {p1, p2}, Lmark/via/fakecam/FakeCamera;->injectCameraShim(Landroid/webkit/WebView;I)V
"""


def insert_after_anchor(text, method, anchor, hook):
    """Insert hook right after the first occurrence of anchor inside method."""
    start = text.find(method)
    if start < 0:
        raise SystemExit(f"method not found: {method}")

    end = text.find(".end method", start)
    position = text.find(anchor, start)
    if position < 0 or position > end:
        raise SystemExit(f"anchor not found inside {method}: {anchor.strip()}")

    cut = position + len(anchor)
    return text[:cut] + hook + text[cut:]


def patch_file(root, relative_path, apply_hook):
    path = os.path.join(root, relative_path)
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if MARKER in text:
        raise SystemExit(f"hook already present in {relative_path}")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(apply_hook(text))
    print(f"patched {relative_path}")


def main():
    root = sys.argv[1]

    patch_file(root, "smali/c8/s6.smali", lambda text: insert_after_anchor(
        text,
        ".method public X(Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient$FileChooserParams;)Z",
        "    iput-object p1, p0, Lc8/s6;->F0:Landroid/webkit/ValueCallback;",
        FILE_CHOOSER_HOOK,
    ))

    patch_file(root, "smali/p4/j.smali", lambda text: insert_after_anchor(
        text,
        ".method public onPageStarted(Landroid/webkit/WebView;Ljava/lang/String;Landroid/graphics/Bitmap;)V",
        "    .locals 1",
        PAGE_STARTED_HOOK,
    ))

    patch_file(root, "smali/p4/c.smali", lambda text: insert_after_anchor(
        text,
        ".method public onProgressChanged(Landroid/webkit/WebView;I)V",
        "    .locals 1",
        PROGRESS_HOOK,
    ))


if __name__ == "__main__":
    main()
