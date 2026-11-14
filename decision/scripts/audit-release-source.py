"""Inventory a release candidate without adding files, publishing data or printing secrets."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
TEXT_SUFFIXES = {".py", ".js", ".mjs", ".ts", ".json", ".html", ".css", ".yml", ".yaml", ".md", ".txt", ".conf", ".sh"}
PATTERNS = {
    "provider_key": re.compile(r"\bsk-[A-Za-z0-9_-]{24,}"),
    "aws_access_key": re.compile(r"\bAKIA[A-Z0-9]{16}\b"),
    "private_key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "github_token": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})"),
}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT).decode("utf-8", errors="strict").strip()


def category(name):
    if name.startswith(("decision/dist", "decision/output/", "output/", ".playwright-cli/")):
        return "generated_or_internal"
    if name.startswith("decision/docs/manual_"):
        return "legacy_copyright_material"
    if name.startswith(("decision/docs/", "docs/")) or name.endswith(".md"):
        return "documentation"
    if "/test" in name or name.startswith("decision/scripts/verify-"):
        return "test_or_verification"
    if name.startswith(("decision/models/", "decision/public/", "api/static/")):
        return "runtime_or_public_asset"
    if name.startswith(("decision/backend/", "decision/frontend/", "decision/src/", "decision/js/", "api/")):
        return "application_source"
    return "configuration_or_review_needed"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    tracked = set(filter(None, git("ls-files", "-z").split("\0")))
    untracked = set(filter(None, git("ls-files", "--others", "--exclude-standard", "-z").split("\0")))
    files, findings, skipped = [], [], []
    for name in sorted(tracked | untracked):
        target = ROOT / name
        if not target.is_file() or target.is_symlink():
            continue
        group = category(name)
        size = target.stat().st_size
        files.append({"path": name, "git": "tracked" if name in tracked else "untracked", "category": group,
                      "bytes": size, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
        if group == "generated_or_internal":
            continue
        if target.suffix.lower() in TEXT_SUFFIXES or target.name in {"Dockerfile", ".env.example"}:
            if size > 4 * 1024 * 1024:
                skipped.append(name)
                continue
            for line_number, line in enumerate(target.read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                for rule, pattern in PATTERNS.items():
                    if pattern.search(line):
                        findings.append({"path": name, "line": line_number, "rule": rule})
    manifest = json.loads((ROOT / "decision/runtime-assets.json").read_text(encoding="utf-8"))
    runtime_untracked = ["decision/" + entry["path"] for entry in manifest["files"] if "decision/" + entry["path"] not in tracked]
    result = {"schema_version": "WJTJ-source-inventory-1.0", "generated_at": datetime.now(timezone.utc).isoformat(),
              "branch": git("branch", "--show-current"), "revision": git("rev-parse", "HEAD"),
              "tracked": len(tracked), "untracked": len(untracked), "counts": dict(Counter(row["category"] for row in files)),
              "runtime_not_tracked": runtime_untracked, "credential_pattern_findings": findings,
              "text_scan_skipped_over_4mb": skipped, "files": files,
              "note": "Pattern scan is not proof of secret absence or data-use rights. No raw device records or secrets are included in this report."}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Source inventory: {len(tracked)} tracked, {len(untracked)} untracked")
    print(f"Required runtime files not tracked: {len(runtime_untracked)}; credential pattern findings: {len(findings)}")
    for finding in findings:
        print(f"{finding['path']}:{finding['line']} ({finding['rule']}, value redacted)")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
