#!/usr/bin/env python3
"""Create a loadable extension ZIP using only Python's standard library."""
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = (
    "manifest.json", "devtools.html", "devtools.js", "panel.html", "panel.js",
    "style.css", "json-codec.js", "worker.js", "viewer.js", "viewer-expanded.js",
    "developer.js", "table-ui.js", "layout.js", "shortcuts.js", "response-editor.js",
    "mock-page.js", "response-mock.js",
    "field-patch-core.js", "field-mock.js", "field-mock-page.js", "field-mock-bridge.js", "field-mock-background.js",
)
DOCS = ("README.md", "CHANGELOG.md", "CHECK_REPORT.md", "CONTRIBUTING.md")


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    if manifest.get("manifest_version") != 3 or not re.fullmatch(r"[0-9]+(?:\.[0-9]+){0,3}", version):
        raise ValueError("Invalid extension manifest/version")
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    if package["version"] != version:
        raise ValueError("package.json and manifest.json versions differ")
    names = list(RUNTIME) + list(DOCS) + sorted(
        str(p.relative_to(ROOT)).replace("\\", "/") for p in (ROOT / "docs").glob("*.md")
    )
    for name in names:
        if not (ROOT / name).is_file():
            raise FileNotFoundError(name)
    if manifest["devtools_page"] not in RUNTIME:
        raise ValueError("DevTools page is missing from runtime whitelist")
    output = ROOT / "dist" / f"API-Table-Viewer-v{version}.zip"
    output.parent.mkdir(exist_ok=True)
    # Stable timestamps and ordering make repeated packages reproducible.
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in names:
            info = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (ROOT / name).read_bytes())
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None or "manifest.json" not in archive.namelist():
            raise ValueError("ZIP validation failed")
    print(output)


if __name__ == "__main__":
    main()
