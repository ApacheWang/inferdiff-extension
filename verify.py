"""Validate the unpacked extension and run the localhost Node test suite."""

import json
import re
import shutil
import struct
import subprocess
import zlib
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
TEST = Path("tests/test_extension.mjs")
ICON_PATHS = {str(size): f"icons/icon{size}.png" for size in (16, 48, 128)}
HOST_PERMISSIONS = ["https://*/*", "http://127.0.0.1/*", "http://localhost/*"]
RUNTIME_SUFFIXES = {".html", ".css", ".js", ".mjs"}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
ABSOLUTE_WEB_URL = re.compile(
    r"https?:[\\/]{2}|[\"'\x60(]//(?=[^\s\\/\"'\x60)])", re.IGNORECASE
)
VERSION = re.compile(r"(0|[1-9][0-9]{0,4})(\.(0|[1-9][0-9]{0,4})){0,3}")
CSS_REFERENCE = re.compile(
    r"""url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]+))\s*\)|@import\s+["']([^"']+)["']""",
    re.IGNORECASE,
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def manifest_version_is_valid(version):
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        return False
    parts = [int(part) for part in version.split(".")]
    return any(parts) and all(part <= 65535 for part in parts)


def validate_manifest():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    require(isinstance(manifest, dict), "manifest.json must contain an object")
    require(type(manifest.get("manifest_version")) is int and manifest["manifest_version"] == 3,
            "Expected Manifest V3 (integer 3)")
    require(manifest.get("name") == "inferdiff Relay Radar", "Unexpected extension name")
    version = manifest.get("version")
    require(manifest_version_is_valid(version) and version == "0.1.0", "Expected version 0.1.0")
    description = manifest.get("description")
    require(isinstance(description, str) and 0 < len(description.strip()) <= 132,
            "Manifest description must be 1–132 characters")
    require(manifest.get("permissions") == ["storage"], "Expected only the storage permission")
    require(manifest.get("optional_host_permissions") == HOST_PERMISSIONS,
            "Optional host permissions differ from the expected HTTPS and loopback patterns")
    for field in ("host_permissions", "optional_permissions", "background",
                  "content_scripts", "externally_connectable", "web_accessible_resources"):
        require(field not in manifest, f"Unexpected manifest field {field}")
    require(manifest.get("icons") == ICON_PATHS, "Manifest icons must use the expected local PNGs")
    action = manifest.get("action")
    require(isinstance(action, dict) and action.get("default_popup") == "popup.html",
            "Manifest action must open popup.html")
    require(action.get("default_icon") == ICON_PATHS, "Toolbar action icons must match manifest icons")
    require((ROOT / action["default_popup"]).is_file(), "Missing popup.html")
    csp = manifest.get("content_security_policy")
    require(isinstance(csp, dict) and csp.get("extension_pages") ==
            "script-src 'self'; object-src 'none'; base-uri 'none'",
            "Extension pages must use the local-script Content Security Policy")
    print("MV3 manifest and permission footprint OK", flush=True)


def png_chunks(path):
    data = path.read_bytes()
    require(data.startswith(PNG_SIGNATURE), f"{path.name} has an invalid PNG signature")
    offset = len(PNG_SIGNATURE)
    while offset < len(data):
        require(offset + 12 <= len(data), f"{path.name} contains a truncated PNG chunk")
        size, kind = struct.unpack_from("!I4s", data, offset)
        start = offset + 8
        end = start + size
        require(end + 4 <= len(data), f"{path.name} contains a truncated PNG payload")
        payload = data[start:end]
        checksum, = struct.unpack_from("!I", data, end)
        require(checksum == zlib.crc32(kind + payload), f"{path.name} has an invalid PNG CRC")
        yield kind, payload
        offset = end + 4


def validate_icons():
    for size_text, filename in ICON_PATHS.items():
        size = int(size_text)
        path = ROOT / filename
        chunks = list(png_chunks(path))
        require(len(chunks) >= 3 and chunks[0][0] == b"IHDR" and chunks[-1] == (b"IEND", b""),
                f"{path.name} must begin with IHDR and end with IEND")
        require(len(chunks[0][1]) == 13, f"{path.name} has an invalid PNG header length")
        header = struct.unpack("!IIBBBBB", chunks[0][1])
        require(header == (size, size, 8, 6, 0, 0, 0),
                f"{path.name} must be a {size}x{size} RGBA PNG")
        pixels = zlib.decompress(b"".join(payload for kind, payload in chunks if kind == b"IDAT"))
        stride = 1 + size * 4
        require(len(pixels) == size * stride and all(value <= 4 for value in pixels[::stride]),
                f"{path.name} contains invalid PNG scanlines")
    print("PNG signatures, dimensions, and pixel data OK (16, 48, 128)", flush=True)


def validate_local_reference(path, value):
    value = value.strip()
    if not value or value.startswith("#"):
        return
    url = urlsplit(value)
    require(not (url.scheme or url.netloc or value.startswith("//")),
            f"{path.relative_to(ROOT)} references a non-local URL: {value}")
    if url.path:
        decoded = unquote(url.path)
        directory = ROOT if decoded.startswith("/") else path.parent
        local_target = (directory / decoded.lstrip("/")).resolve()
        require(local_target.is_relative_to(ROOT) and local_target.is_file(),
                f"{path.relative_to(ROOT)} references a missing local file: {value}")


class LocalHTML(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.path = path

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        for name in ("src", "href", "poster", "action", "formaction"):
            if attributes.get(name):
                validate_local_reference(self.path, attributes[name])
        for part in (attributes.get("srcset") or "").split(","):
            if part.strip():
                validate_local_reference(self.path, part.split()[0])
        require(not (tag == "script" and not attributes.get("src")), "Use a local script file in popup HTML")
        require(not any(name.startswith("on") for name in attributes), "Avoid inline HTML event handlers")


def validate_runtime_sources():
    paths = sorted(
        path for path in ROOT.rglob("*")
        if path.is_file() and path.suffix in RUNTIME_SUFFIXES
        and not any(part.startswith(".") or part == "tests" for part in path.relative_to(ROOT).parts)
    )
    expected = {"popup.html", "popup.css", "popup.js", "src/probes.js", "src/config.js"}
    require(expected.issubset(path.relative_to(ROOT).as_posix() for path in paths),
            "One or more runtime HTML, CSS, or JS files are missing")
    for path in paths:
        source = path.read_text(encoding="utf-8")
        match = ABSOLUTE_WEB_URL.search(source)
        require(match is None, f"{path.relative_to(ROOT)} contains a literal web URL")
        if path.suffix == ".html":
            parser = LocalHTML(path)
            parser.feed(source)
            parser.close()
        if path.suffix == ".css":
            for groups in CSS_REFERENCE.findall(source):
                reference = next((value for value in groups if value), "")
                validate_local_reference(path, reference)
    print(f"Runtime assets are local in {len(paths)} HTML, CSS, and JavaScript files", flush=True)
    return [path for path in paths if path.suffix in {".js", ".mjs"}]


def main():
    validate_manifest()
    validate_icons()
    js_paths = validate_runtime_sources()
    node = shutil.which("node")
    require(node is not None, "Node.js 22.7+ is required on PATH")
    for path in [*js_paths, ROOT / TEST]:
        subprocess.run([node, "--check", str(path.relative_to(ROOT))], cwd=ROOT, check=True)
    print(f"JavaScript syntax OK ({len(js_paths) + 1} files)", flush=True)
    subprocess.run([node, "--test", str(TEST)], cwd=ROOT, check=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError, struct.error, zlib.error) as error:
        raise SystemExit(f"Verification failed: {error}") from error
