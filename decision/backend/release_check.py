"""Validate a release's declared runtime files without network access or secrets."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

ROOT = Path(__file__).resolve().parents[1]


def read_json(path):
    def invalid_constant(value):
        raise ValueError("nonfinite JSON value")
    return json.loads(path.read_text(encoding="utf-8"), parse_constant=invalid_constant)


def check_release(root=ROOT, frontend=False):
    root = Path(root).resolve()
    errors, files = [], []
    identity = {}
    try:
        identity = read_json(root / "release-version.json")
        if not isinstance(identity, dict) or not re.fullmatch(r"\d+\.\d+\.\d+", str(identity.get("version", ""))):
            raise ValueError("invalid software version")
        if not identity.get("software_name"):
            raise ValueError("missing software name")
    except (OSError, ValueError, TypeError):
        identity = {}
        errors.append("release-version.json: invalid or missing identity")
    try:
        manifest = read_json(root / "runtime-assets.json")
        entries = manifest["files"]
        if manifest.get("schema_version") != "WJTJ-runtime-assets-1.0" or not isinstance(entries, list) or not entries:
            raise ValueError("invalid runtime manifest")
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {"status": "FAIL", "errors": errors + ["runtime-assets.json: invalid or missing manifest"], "files": []}
    seen = set()
    for entry in entries:
        name = entry.get("path", "") if isinstance(entry, dict) else ""
        if not isinstance(name, str) or not name:
            errors.append("runtime-assets.json: missing path")
            continue
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name or name in seen:
            errors.append("runtime-assets.json: unsafe or duplicate path")
            continue
        seen.add(name)
        target = (root / name).resolve()
        if not target.is_relative_to(root):
            errors.append("runtime-assets.json: path escapes package")
            continue
        try:
            payload = target.read_bytes()
            value = read_json(target)
            if not isinstance(value, dict) or not value:
                raise ValueError("empty object")
            if entry.get("kind") == "spatial":
                if value.get("type") not in {"Feature", "FeatureCollection"}:
                    raise ValueError("invalid GeoJSON")
                if value.get("type") == "FeatureCollection" and not value.get("features"):
                    raise ValueError("empty GeoJSON")
            files.append({"path": name, "bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()})
        except (OSError, ValueError, TypeError):
            errors.append(name + ": missing, empty or invalid JSON asset")
    if frontend:
        try:
            package = read_json(root / "package.json")
            lock = read_json(root / "package-lock.json")
            versions = [package["version"], lock["version"], lock["packages"][""]["version"]]
            if any(version != identity.get("version") for version in versions):
                errors.append("frontend/backend software versions differ")
        except (OSError, ValueError, KeyError, TypeError):
            errors.append("frontend package metadata is invalid or missing")
    return {"schema_version": "WJTJ-release-check-1.0", "status": "FAIL" if errors else "PASS",
            "software": identity, "files": files, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--frontend", action="store_true")
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    result = check_release(args.root, args.frontend)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Release assets: {result['status']} ({len(result['files'])} files)")
    for error in result["errors"]:
        print(error)
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
