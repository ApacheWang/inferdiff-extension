"""Build and verify the unpacked extension and its distribution ZIP."""

import argparse
import shutil
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

from verify import ROOT, require, runtime_files, validate_extension


def pack(output):
    files = runtime_files(ROOT)
    unpacked = output / "unpacked"
    archive_path = output / "inferdiff-relay-radar.zip"
    require(not unpacked.is_relative_to(ROOT / "src"), "Choose an output directory outside src/")
    require(unpacked.resolve() == unpacked and not archive_path.is_symlink(),
            "Package outputs must not be symbolic links")
    directories = {parent for name in files for parent in name.parents}
    for path in unpacked.rglob("*"):
        require(not path.is_symlink() and path.resolve().is_relative_to(unpacked),
                "Package output contains a symbolic link")
        allowed = directories if path.is_dir() else files
        require(path.relative_to(unpacked) in allowed, "Choose a clean unpacked output directory")

    for name in files:
        target = unpacked / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    validate_extension(unpacked)

    with ZipFile(archive_path, "w", compression=ZIP_DEFLATED) as archive:
        for name in files:
            archive.write(unpacked / name, name.as_posix())
    with ZipFile(archive_path) as archive:
        require(archive.testzip() is None, "ZIP integrity check failed")
        require(sorted(archive.namelist()) == sorted(name.as_posix() for name in files),
                "ZIP entries differ from the unpacked file list")
        for name in files:
            require(archive.read(name.as_posix()) == (unpacked / name).read_bytes(),
                    f"ZIP entry differs from the unpacked file at {name.as_posix()}")
    print(f"Unpacked extension and ZIP verified ({len(files)} files)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="build in a temporary directory")
    mode.add_argument("--output", type=Path, help="output directory (default: dist)")
    args = parser.parse_args()
    if args.check:
        with tempfile.TemporaryDirectory(prefix="relay-radar-") as temporary:
            pack(Path(temporary).resolve())
    else:
        pack((args.output or ROOT / "dist").resolve())


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, BadZipFile, subprocess.CalledProcessError, struct.error, zlib.error) as error:
        raise SystemExit(f"Packaging failed: {error}") from error
