"""Deploy the project-only read projection, preserving unrelated deployed code."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request

release=Path(__file__).resolve().parent
app=Path('/root/microclimate-decision')
api=Path('/root/weather/api')
backup=release/'before'
backup.mkdir(mode=0o700)


def run(*args, **kwargs):return subprocess.run(args,check=True,**kwargs)


def replace_once(source,old,new):
    assert source.count(old)==1, 'Deployment anchor changed'
    return source.replace(old,new,1)


def request_status(url):
    try:
        with urllib.request.urlopen(url,timeout=20) as response:return response.status
    except urllib.error.HTTPError as error:return error.code


main=app/'backend/main.py'
main_text=main.read_text()
main_text=replace_once(main_text,'    app.include_router(telemetry_router)\n',
    '    app.include_router(telemetry_router)\n    from backend.telemetry_view import router as telemetry_view_router\n    app.include_router(telemetry_view_router)\n')
collection=app/'backend/collection.py'
collection_text=collection.read_text()
collection_text=replace_once(collection_text,
    '    return {"schema_version": VERSION, "devices": await read_devices(), "refresh_seconds": 30,',
    '''    rows = await read_devices()
    if os.getenv("MOBILE_TELEMETRY_PUBLIC_VIEW") == "1" and os.getenv("COLLECTION_IOT_DISABLED") != "1":
        from backend.telemetry_view import field_devices
        rows += await run_in_threadpool(field_devices)
    return {"schema_version": VERSION, "devices": rows, "refresh_seconds": 30,''')
api_app=api/'app.py'
api_text=replace_once(api_app.read_text(),'async def home_asset(asset_name: str):\n',
    '''async def home_asset(asset_name: str):
    if asset_name in {"mobile-devices.js", "mobile-devices.css"}:
        return FileResponse(BASE_DIR / "static" / "home" / asset_name, headers={"Cache-Control": "no-cache, must-revalidate"})
''')
aic=Path('/etc/nginx/sites-available/aic')
aic_text=replace_once(aic.read_text(),'    location ^~ /api/weather/telemetry/ { return 404; }\n',
    '    location ^~ /api/weather/telemetry/ { return 404; }\n    location = /api/weather/mobile-observations { return 404; }\n    location ^~ /api/weather/mobile-observations/ { return 404; }\n')
env=Path('/etc/microclimate-project-telemetry.env')
env_text=env.read_text()
assert 'MOBILE_TELEMETRY_PUBLIC_VIEW=' not in env_text
env_text=env_text.rstrip()+'\nMOBILE_TELEMETRY_PUBLIC_VIEW=1\n'
for path,code in [(main,main_text),(collection,collection_text),(api_app,api_text)]:compile(code,str(path),'exec')

# Verify a copied backend with isolated test databases before touching running services.
qa=release/'qa'
shutil.copytree(app/'backend',qa/'backend',ignore=shutil.ignore_patterns('__pycache__'))
for name in ('telemetry_view.py','test_telemetry_view.py'):
    shutil.copy2(release/name,qa/'backend'/name)
(qa/'backend/main.py').write_text(main_text)
(qa/'backend/collection.py').write_text(collection_text)
run(str(app/'.venv/bin/python'),'-m','unittest','backend.test_telemetry_view','-v',cwd=qa)

updates={main:main_text.encode(),collection:collection_text.encode(),api_app:api_text.encode(),aic:aic_text.encode(),env:env_text.encode(),
         app/'backend/telemetry_view.py':(release/'telemetry_view.py').read_bytes()}
for name in ('sensors.html','monitor.html'):updates[api/'templates'/name]=(release/name).read_bytes()
for name in ('mobile-devices.js','mobile-devices.css'):updates[api/'static/home'/name]=(release/name).read_bytes()
expected={'sensors.html':'7d228c6cece6b03ae6455b9b4777ed78af2a5a6a6825e803b4c004bd331c835c',
          'monitor.html':'71e1b06a319972f4d4a149a439d340d171d3cad034bda10330a5d685b518d8ee'}
for name,digest in expected.items():
    assert hashlib.sha256((api/'templates'/name).read_bytes()).hexdigest()==digest,'Template changed during work'
manifest=[]
for i,path in enumerate(updates):
    entry={'path':str(path),'backup':str(backup/str(i)),'existed':path.exists()}
    if path.exists():shutil.copy2(path,entry['backup'])
    manifest.append(entry)
(backup/'manifest.json').write_text(json.dumps(manifest,indent=2))
container_files=['app.py','templates/sensors.html','templates/monitor.html','static/home/mobile-devices.js','static/home/mobile-devices.css']
try:
    for path,content in updates.items():path.write_bytes(content)
    env.chmod(0o600)
    for name in container_files:run('docker','cp',str(api/name),'iot_api:/app/'+name)
    run('nginx','-t')
    run('systemctl','restart','microclimate-decision-api')
    run('docker','restart','iot_api')
    run('systemctl','reload','nginx')
    for attempt in range(20):
        try:
            if request_status('http://127.0.0.1:3100/api/weather/mobile-observations/devices')==200 and request_status('http://127.0.0.1:8080/sensors')==200:break
        except (OSError,TimeoutError):pass
        time.sleep(1)
    else:raise RuntimeError('Service readiness failed')
    assert request_status('https://weather.nogamenolife.cn/api/weather/mobile-observations/devices')==200
    assert request_status('https://aic.nogamenolife.cn/api/weather/mobile-observations/devices')==404
    assert request_status('https://weather.nogamenolife.cn/home-assets/mobile-devices.js')==200
    result={'deployed':True,'files':{str(path):hashlib.sha256(content).hexdigest() for path,content in updates.items() if path!=env},'backup':str(backup)}
    (release/'deployment.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'deployed':True,'public_view':200,'aic':404}))
except BaseException:
    for entry in manifest:
        path=Path(entry['path'])
        if entry['existed']:shutil.copy2(entry['backup'],path)
        elif path.exists():path.unlink()
    for name in container_files:
        if (api/name).exists():run('docker','cp',str(api/name),'iot_api:/app/'+name)
    run('systemctl','restart','microclimate-decision-api')
    run('docker','restart','iot_api')
    run('nginx','-t');run('systemctl','reload','nginx')
    raise
