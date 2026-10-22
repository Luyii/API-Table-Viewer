#!/usr/bin/env python3
"""Check the actual extension ZIP, using only the Python standard library."""
import json
from pathlib import Path
import runpy
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    packaging = runpy.run_path(str(ROOT / "scripts/package.py"))
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    archive_path = ROOT / "dist" / f"API-Table-Viewer-v{manifest['version']}.zip"
    expected = set(packaging["RUNTIME"]) | set(packaging["DOCS"]) | {
        file.relative_to(ROOT).as_posix() for file in (ROOT / "docs").glob("*.md")
    }
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or set(names) != expected:
            raise ValueError("ZIP entries differ from the packaging whitelist")
        if archive.testzip() is not None:
            raise ValueError("ZIP integrity check failed")
        for name in names:
            if archive.read(name) != (ROOT / name).read_bytes():
                raise ValueError(f"ZIP content differs from source: {name}")
        with tempfile.TemporaryDirectory(prefix="api-table-viewer-") as directory:
            unpacked = Path(directory)
            archive.extractall(unpacked)
            if not (unpacked / "manifest.json").is_file():
                raise ValueError("manifest.json must be at the ZIP root")
            # Run the existing resource/CSP/syntax checks against packaged files.
            # The checker is copied only into the temporary extraction directory.
            (unpacked / "tests").mkdir()
            checker = unpacked / "tests/package-check.cjs"
            shutil.copyfile(ROOT / "tests/package-check.cjs", checker)
            subprocess.run(["node", str(checker)], cwd=unpacked, check=True)
    print(f"PASS {archive_path.name}: whitelist, source bytes and extracted resources")


if __name__ == "__main__":
    main()
