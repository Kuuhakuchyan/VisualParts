"""Publish only the fixed mobile entries and quiet empty-state UI."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

release=Path(__file__).resolve().parent
api=Path('/root/weather/api')
files=('templates/sensors.html','templates/monitor.html','static/home/mobile-devices.js')
backup=release/'before'
backup.mkdir(mode=0o700)
previous=json.loads(Path('/root/weather-releases/mobile-observation-view-20261112/deployment.json').read_text())
for relative in files:
    target=api/relative
    assert hashlib.sha256(target.read_bytes()).hexdigest()==previous['files'][str(target)], 'Live files changed'
    shutil.copy2(target,backup/target.name)
try:
    for relative in files:
        target=api/relative
        shutil.copy2(release/target.name,target)
        subprocess.run(['docker','cp',str(target),'iot_api:/app/'+relative],check=True)
    hashes={}
    for relative in files:
        digest=hashlib.sha256((api/relative).read_bytes()).hexdigest()
        assert subprocess.check_output(['docker','exec','iot_api','sha256sum','/app/'+relative],text=True).split()[0]==digest
        hashes[relative]=digest
    (release/'deployment.json').write_text(json.dumps({'deployed':True,'files':hashes},indent=2))
    print(json.dumps({'deployed':True,'files':len(files)}))
except BaseException:
    for relative in files:
        target=api/relative
        shutil.copy2(backup/target.name,target)
        subprocess.run(['docker','cp',str(target),'iot_api:/app/'+relative],check=True)
    raise
