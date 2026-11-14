"""Software identity shared by source packages and the API; no device data."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IDENTITY = json.loads((ROOT / "release-version.json").read_text(encoding="utf-8"))
SOFTWARE_VERSION = IDENTITY["version"]
