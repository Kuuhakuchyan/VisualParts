"""Run release checks in isolated storage and save a machine-readable ledger."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-dir", type=Path, default=ROOT / "output/release-check")
    parser.add_argument("--skip-build", action="store_true")
    parser.add_argument("--checks", nargs="+", help="Run only these named checks; omitted checks are not recorded as passed")
    args = parser.parse_args()
    reports = args.report_dir.resolve()
    reports.mkdir(parents=True, exist_ok=True)
    steps = [
        ("runtime-assets", [sys.executable, "-m", "backend.release_check", "--frontend", "--report", str(reports / "runtime-assets.json")]),
        ("backend", [sys.executable, "-m", "unittest", "discover", "-s", "backend", "-t", ".", "-q"]),
        ("iot-api", [sys.executable, "-m", "unittest", "discover", "-s", "../api", "-p", "test_safety.py", "-q"]),
        ("isolated-package", [sys.executable, "scripts/verify-runtime-package.py"]),
        ("submission-workflows", [sys.executable, "scripts/verify-submission-workflows.py", "--output", str(reports / "submission-workflows")]),
        ("state-recovery", [sys.executable, "scripts/verify-state-recovery.py", "--output", str(reports / "state-recovery")]),
        ("workspace", ["node", "--test", "scripts/test-workspace-core.mjs", "scripts/test-forecast-frames.mjs", "scripts/test-home-geometry.mjs"]),
        ("dev-assets", ["node", "scripts/test-dev-assets.mjs"]),
    ]
    if not args.skip_build:
        steps += [("build-home", ["node", "scripts/build-home-assets.mjs"]),
                  ("build-vite", ["node", "node_modules/vite/bin/vite.js", "build"]),
                  ("build-manifest", ["node", "scripts/verify-build-manifest.mjs"])]
    if args.checks:
        unknown = set(args.checks) - {name for name, _ in steps}
        if unknown:
            parser.error("Unavailable checks: " + ", ".join(sorted(unknown)))
        steps = [(name, command) for name, command in steps if name in args.checks]
    results = []
    with tempfile.TemporaryDirectory(prefix="wjtj-regression-") as directory:
        env = dict(os.environ)
        for key in list(env):
            if key.startswith(("AIC_", "TELEMETRY_", "DEEPSEEK_", "OPENAI_")) or key in {"APP_VERSION", "PYTHONPATH"}:
                env.pop(key)
        state = Path(directory)
        env.update(DECISION_STATE_DB=str(state / "decision.sqlite3"), WORKSPACE_STATE_DB=str(state / "workspace.sqlite3"),
                   AIC_STATE_DB=str(state / "aic.sqlite3"), TELEMETRY_STATE_DB=str(state / "telemetry.sqlite3"),
                   TELEMETRY_MEDIA_DIR=str(state / "media"), COLLECTION_IOT_DISABLED="0", MOBILE_TELEMETRY_ENABLED="1",
                   MOBILE_TELEMETRY_PUBLIC_VIEW="0", ALLOWED_HOSTS="localhost,127.0.0.1,testserver", PYTHONUTF8="1")
        for name, command in steps:
            started = time.monotonic()
            print("Running " + name, flush=True)
            log = reports / (name + ".log")
            try:
                with log.open("w", encoding="utf-8") as stream:
                    process = subprocess.run(command, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=900)
                exit_code = process.returncode
            except subprocess.TimeoutExpired:
                exit_code = 124
            results.append({"step": name, "exit_code": exit_code, "seconds": round(time.monotonic() - started, 2), "log": log.name})
            print(name + (": PASS" if exit_code == 0 else ": FAIL (see " + log.name + ")"), flush=True)
            if exit_code:
                break
    passed = len(results) == len(steps) and all(result["exit_code"] == 0 for result in results)
    summary = {"schema_version": "WJTJ-regression-ledger-1.0", "status": "PASS" if passed else "FAIL",
               "started_checks": len(results), "planned_checks": len(steps), "checks": results,
               "completed_at": datetime.now(timezone.utc).isoformat(), "production_mutated": False,
               "selected_checks_only": bool(args.checks),
               "docker_image_tested": False, "public_browser_regression": False}
    (reports / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
