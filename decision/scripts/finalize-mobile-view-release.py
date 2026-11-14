"""Verify final follow-up assets and record the completed release hashes."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

release=Path(__file__).resolve().parent
manifest=release/'deployment.json'
data=json.loads(manifest.read_text())
initial=release/'deployment-initial.json'
if not initial.exists():shutil.copy2(manifest,initial)
for relative in ('templates/monitor.html','static/home/mobile-devices.js'):
    target=Path('/root/weather/api')/relative
    expected=hashlib.sha256((release/target.name).read_bytes()).hexdigest()
    assert hashlib.sha256(target.read_bytes()).hexdigest()==expected
    live=subprocess.check_output(['docker','exec','iot_api','sha256sum','/app/'+relative],text=True).split()[0]
    assert live==expected
    data['files'][str(target)]=expected
data['final_assets_verified']=True
data['test_fixture_cleanup']=json.loads((release/'ui-fixtures.json').read_text())['cleaned']
manifest.write_text(json.dumps(data,indent=2))
print(json.dumps({'final_assets_verified':True,'test_fixture_cleanup':data['test_fixture_cleanup']}))
