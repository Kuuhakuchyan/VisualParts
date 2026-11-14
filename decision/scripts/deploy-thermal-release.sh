#!/usr/bin/env bash
set -euo pipefail
release=$(cd -- "$(dirname -- "$0")/.." && pwd)
target=/root/microclimate-decision
site=/var/www/microclimate-decision
backup="/root/weather_backups/$(basename "$release")"
python="$target/.venv/bin/python"
mapfile -t runtime < <("$python" -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["runtime"]))' "$release/manifest.json")
mapfile -t datafiles < <("$python" -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1])).get("dataFiles",[])),end="")' "$release/manifest.json")
mapfile -t extrastatic < <("$python" -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1])).get("extraStatic",[])),end="")' "$release/manifest.json")
if [[ "${runtime[*]}" == "" ]]; then runtime=(); fi
[[ ! -e "$backup" ]]
(cd "$release" && sha256sum -c release.sha256 > /dev/null)
changed=0
for file in "${runtime[@]}"; do if ! cmp -s "$release/backend/$file" "$target/backend/$file"; then changed=1; fi; done
for file in "${datafiles[@]}"; do if ! cmp -s "$release/public/$file" "$target/public/$file"; then changed=1; fi; done
stage=unchanged-runtime
if [[ "$changed" == 1 ]]; then
  mapfile -t testmodules < <("$python" -c 'import json,sys; print("\n".join(json.load(open(sys.argv[1]))["testModules"]))' "$release/manifest.json")
  stage=$(mktemp -d /tmp/thermal-evidence-test.XXXXXX)
  cp -a "$target/backend" "$target/public" "$target/models" "$stage/"
  rsync -a --exclude=__pycache__ "$release/backend/" "$stage/backend/"
  if [[ -d "$release/public" ]]; then rsync -a "$release/public/" "$stage/public/"; fi
  (cd "$stage" && AIC_STATE_DB="$stage/evidence.sqlite3" WORKSPACE_STATE_DB="$stage/plans.sqlite3" AIC_DEEPSEEK_API_KEY='' "$python" -W ignore::DeprecationWarning -m unittest "${testmodules[@]}" -q)
fi
mkdir -p "$backup/backend/aic" "$backup/dist/aic"
for file in "${runtime[@]}"; do cp -a "$target/backend/$file" "$backup/backend/$file"; done
for file in "${datafiles[@]}"; do
  mkdir -p "$backup/public/$(dirname "$file")" "$backup/dist/$(dirname "$file")"
  if [[ -f "$target/public/$file" ]]; then cp -a "$target/public/$file" "$backup/public/$file"; fi
  if [[ -f "$site/$file" ]]; then cp -a "$site/$file" "$backup/dist/$file"; fi
done
for file in "${extrastatic[@]}"; do mkdir -p "$backup/dist/$(dirname "$file")"; if [[ -f "$site/$file" ]]; then cp -a "$site/$file" "$backup/dist/$file"; fi; done
cp -a "$site/index.html" "$backup/dist/index.html"
cp -a "$site/aic/index.html" "$backup/dist/aic/index.html"
rollback(){
  trap - ERR
  for file in "${runtime[@]}"; do cp -a "$backup/backend/$file" "$target/backend/$file"; done
  for file in "${datafiles[@]}"; do
    if [[ -f "$backup/public/$file" ]]; then cp -a "$backup/public/$file" "$target/public/$file"; else rm -f "$target/public/$file"; fi
    if [[ -f "$backup/dist/$file" ]]; then cp -a "$backup/dist/$file" "$site/$file"; else rm -f "$site/$file"; fi
  done
  for file in "${extrastatic[@]}"; do if [[ -f "$backup/dist/$file" ]]; then cp -a "$backup/dist/$file" "$site/$file"; else rm -f "$site/$file"; fi; done
  cp -a "$backup/dist/index.html" "$site/index.html"
  cp -a "$backup/dist/aic/index.html" "$site/aic/index.html"
  if [[ "$changed" == 1 ]]; then systemctl restart microclimate-decision-api.service; fi
  printf 'Rolled back to %s\n' "$backup" >&2
}
trap 'result=$?; rollback; exit "$result"' ERR
for file in "${runtime[@]}"; do install -m 644 "$release/backend/$file" "$target/backend/$file"; done
for file in "${datafiles[@]}"; do install -Dm 644 "$release/public/$file" "$target/public/$file"; install -Dm 644 "$release/dist/$file" "$site/$file"; done
for file in "${extrastatic[@]}"; do install -Dm 644 "$release/dist/$file" "$site/$file"; done
rsync -a "$release/dist/assets/" "$site/assets/"
if [[ "$changed" == 1 ]]; then systemctl restart microclimate-decision-api.service; fi
ready=0
for attempt in $(seq 1 25); do
  if curl -fsS http://127.0.0.1:3100/api/weather/aic/status -o "$backup/status.json"; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]]
"$python" -c 'import json,sys; d=json.load(open(sys.argv[1])); assert "knowledge_audit" in d; assert d["knowledge_provenance"]["vector_rag"] is False' "$backup/status.json"
if [[ "$("$python" -c 'import json,sys; print(int(json.load(open(sys.argv[1])).get("lczWorkflow",False)))' "$release/manifest.json")" == 1 ]]; then
  curl -fsS http://127.0.0.1:3100/api/weather/sandbox/lcz-metadata -o "$backup/lcz-status.json"
  "$python" -c 'import json,sys; d=json.load(open(sys.argv[1])); m=json.load(open(sys.argv[2])); assert d["model_version"]=="lcz-constrained-midpoint-scenario-2.1"; assert d["classification_sha256"]==m["metadata"]["classification_sha256"]; assert set([5,9,15,17]).issubset(d["available_class_codes"]); assert d["reference_station"]["label"]=="基准站"' "$backup/lcz-status.json" "$release/public/data/campus-lcz-simulation.geojson"
fi
for file in index.html aic/index.html; do install -m 644 "$release/dist/$file" "$site/$file.next"; mv "$site/$file.next" "$site/$file"; done
systemctl is-active microclimate-decision-api.service
"$python" -c 'import json,sys; d=json.load(open(sys.argv[1]))["knowledge_audit"]; json.dump(d,open(sys.argv[2],"w"),ensure_ascii=False,indent=2); print(json.dumps(d,ensure_ascii=False))' "$backup/status.json" "$backup/knowledge-audit.json"
sha256sum "$target/backend/sandbox.py" "$site/index.html" "$site/aic/index.html"
trap - ERR
printf 'Thermal evidence release deployed. Backup: %s\nTest staging: %s\n' "$backup" "$stage"
