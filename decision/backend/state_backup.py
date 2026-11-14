"""Offline SQLite/media snapshots; restore only into a new directory."""
import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import tempfile

SCHEMA = "WJTJ-state-backup-1.0"
NAMES = {"decision", "workspace", "evidence", "telemetry"}


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def database_facts(path):
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("SQLite integrity check failed")
        tables = [row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        return {table: db.execute('SELECT COUNT(*) FROM "' + table.replace('"', '""') + '"').fetchone()[0]
                for table in sorted(tables)}


def checked_path(root, relative):
    parts = PurePosixPath(relative)
    if not relative or "\\" in relative or parts.is_absolute() or any(p in {"..", "."} or ":" in p for p in relative.split("/")):
        raise ValueError("Unsafe backup path")
    target = root.joinpath(*parts.parts)
    if not target.resolve().is_relative_to(root.resolve()) or any(p.is_symlink() for p in [target, *target.parents] if p != root.parent):
        raise ValueError("Backup path escapes root or uses a symbolic link")
    return target


def verify(root):
    root = Path(root).resolve()
    if any(p.is_symlink() for p in root.rglob("*")):
        raise ValueError("Backup symbolic links are not supported")
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema_version") != SCHEMA or not manifest.get("files"):
        raise ValueError("Invalid backup manifest")
    names = [row["path"] for row in manifest["files"]]
    if len(set(names)) != len(names):
        raise ValueError("Duplicate backup path")
    actual = {p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()}
    if actual != set(names) | {"manifest.json"}:
        raise ValueError("Unexpected or missing backup files")
    for row in manifest["files"]:
        path = checked_path(root, row["path"])
        if not path.is_file() or path.stat().st_size != row["bytes"] or sha256(path) != row["sha256"]:
            raise ValueError("Backup file checksum mismatch: " + row["path"])
        if row["path"].startswith("databases/") and database_facts(path) != row["tables"]:
            raise ValueError("Database table counts differ")
    return manifest


def backup(databases, media, destination, *, writers_stopped=False):
    if not writers_stopped:
        raise ValueError("Stop all database/media writers first; cross-store snapshots require quiescence")
    destination = Path(destination).absolute()
    if destination.exists() or not databases or set(databases) - NAMES:
        raise ValueError("Use a new backup directory and known database names")
    media = Path(media).absolute()
    if not media.is_dir() or media.is_symlink():
        raise ValueError("Media directory must exist and must not be a symlink")
    sources = [Path(p).absolute() for p in databases.values()]
    if destination.resolve().is_relative_to(media.resolve()) or any(destination.resolve() == p.resolve() for p in sources):
        raise ValueError("Backup destination overlaps its source")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".wjtj-backup-", dir=destination.parent) as tmp:
        staged = Path(tmp) / "snapshot"
        (staged / "databases").mkdir(parents=True)
        (staged / "media").mkdir()
        rows = []
        for name, source in sorted(databases.items()):
            source = Path(source).absolute()
            if not source.is_file() or source.is_symlink():
                raise ValueError("Database is missing or a symbolic link")
            target = staged / "databases" / (name + ".sqlite3")
            with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as db, closing(sqlite3.connect(target)) as copy:
                db.backup(copy)
                copy.execute("PRAGMA journal_mode=DELETE")
            rows.append({"path": target.relative_to(staged).as_posix(), "bytes": target.stat().st_size,
                         "sha256": sha256(target), "tables": database_facts(target)})
        for source in sorted(media.rglob("*")):
            if source.is_symlink():
                raise ValueError("Media symbolic links are not supported")
            if not source.is_file():
                continue
            target = staged / "media" / source.relative_to(media)
            before = sha256(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            if before != sha256(source) or before != sha256(target):
                raise ValueError("Media changed during backup")
            rows.append({"path": target.relative_to(staged).as_posix(), "bytes": target.stat().st_size, "sha256": before})
        manifest = {"schema_version": SCHEMA, "created_at": datetime.now(timezone.utc).isoformat(),
                    "consistency": "writers_stopped_by_operator", "files": rows,
                    "environment_files_included": False, "note": "Database contents may be private. Store backups with restricted permissions."}
        (staged / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        verify(staged)
        if destination.exists():
            raise ValueError("Backup destination appeared during snapshot")
        staged.rename(destination)
    return manifest


def restore(source, destination):
    source, destination = Path(source).resolve(), Path(destination).absolute()
    if destination.exists():
        raise ValueError("Restore destination must not exist; never overwrite a live directory")
    verify(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".wjtj-restore-", dir=destination.parent) as tmp:
        staged = Path(tmp) / "restored"
        shutil.copytree(source, staged, symlinks=True)
        manifest = verify(staged)
        if destination.exists():
            raise ValueError("Restore destination appeared during copy")
        staged.rename(destination)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    create = sub.add_parser("backup")
    create.add_argument("--database", action="append", required=True, help="decision|workspace|evidence|telemetry=path")
    create.add_argument("--media", type=Path, required=True)
    create.add_argument("--output", type=Path, required=True)
    create.add_argument("--writers-stopped", action="store_true")
    read = sub.add_parser("verify")
    read.add_argument("source", type=Path)
    recover = sub.add_parser("restore")
    recover.add_argument("source", type=Path)
    recover.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.action == "backup":
        databases = dict(item.split("=", 1) for item in args.database)
        if len(databases) != len(args.database):
            parser.error("Duplicate database name")
        result = backup(databases, args.media, args.output, writers_stopped=args.writers_stopped)
    elif args.action == "restore":
        result = restore(args.source, args.output)
    else:
        result = verify(args.source)
    print(json.dumps({"status": "PASS", "files": len(result["files"])}))


if __name__ == "__main__":
    main()
