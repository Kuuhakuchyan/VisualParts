import hashlib
import json
import sys
from pathlib import Path


release = Path(sys.argv[1])
manifest = json.loads((release / "manifest.json").read_text())
roots = {"decision": Path("/var/www/microclimate-decision"),
         "api": Path("/root/weather/api"), "blog": Path("/var/www/weather-author")}
failures = []
matched = 0
for relative, expected in manifest["hashes"].items():
    prefix, _, name = relative.partition("/")
    if prefix not in roots:
        continue
    path = roots[prefix] / name
    actual = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
    if actual != expected:
        failures.append(relative)
    else:
        matched += 1
config = Path("/etc/nginx/sites-available/aic")
patch = Path("/root/weather-releases/aic-routing-fixed.conf")
config_hash = hashlib.sha256(config.read_bytes()).hexdigest()
if config_hash != hashlib.sha256(patch.read_bytes()).hexdigest():
    failures.append("nginx/aic-routing-fixed.conf")
result = {"release": manifest["releaseId"], "matched_files": matched,
          "routing_config_sha256": config_hash, "failures": failures}
print(json.dumps(result))
raise SystemExit(bool(failures))
