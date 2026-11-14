from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess

release = Path(__file__).resolve().parent
manifest = json.loads((release / 'manifest.json').read_text())
for name, expected in manifest['hashes'].items():
    assert hashlib.sha256((release / name).read_bytes()).hexdigest() == expected, name
backup = Path('/root/weather_backups') / release.name
backup.mkdir(exist_ok=False)
api = Path('/root/weather/api')
aic = Path('/var/www/microclimate-aic')
project = Path('/var/www/microclimate-decision')
changes = {}
for name in ['scene.js', 'campus-scene.webp', 'd-context.webp', 'd-intervention.webp']:
    changes[api / 'static/home' / name] = (release / 'api' / name).read_bytes()
for name in ['scene.js', 'homepage-scene.png', 'd-context.png', 'd-intervention.png']:
    changes[aic / 'aic/assets' / name] = (release / 'aic' / name).read_bytes()
for site in [project, aic]:
    for name in ['d-context.png', 'd-intervention.png']:
        changes[site / 'assets/workspace-media' / name] = (release / 'aic' / name).read_bytes()
for template in [api / 'templates/home.html', aic / 'aic/home.html', aic / 'aic/journal.html']:
    text = template.read_text()
    text = re.sub(r'(scene\.js\?v=)[^"\s]+', r'\g<1>20261028-surfaces', text)
    changes[template] = text.encode()
container_files = [p for p in changes if p.is_relative_to(api)]
for target in changes:
    relative = target.relative_to('/')
    saved = backup / relative
    saved.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(target, saved)
for target in container_files:
    saved = backup / 'container' / target.relative_to(api)
    saved.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['docker', 'cp', 'iot_api:/app/' + target.relative_to(api).as_posix(), str(saved)], check=True)
try:
    for target, content in changes.items():
        temporary = target.with_name(target.name + '.surfaces-next')
        temporary.write_bytes(content)
        temporary.chmod(0o644)
        temporary.replace(target)
    for target in container_files:
        subprocess.run(['docker', 'cp', str(target), 'iot_api:/app/' + target.relative_to(api).as_posix()], check=True)
    for url, target in [
        ('https://weather.nogamenolife.cn/home-assets/scene.js?v=20261028-surfaces', api / 'static/home/scene.js'),
        ('https://aic.nogamenolife.cn/aic/assets/scene.js?v=20261028-surfaces', aic / 'aic/assets/scene.js'),
    ]:
        response = subprocess.check_output(['curl', '--fail', '--silent', '--show-error', '--max-time', '25', url])
        assert response == changes[target], url
    for url in ['https://weather.nogamenolife.cn/decision/aic/', 'https://aic.nogamenolife.cn/author/']:
        assert subprocess.check_output(['curl', '--silent', '--output', '/dev/null', '--write-out', '%{http_code}', '--max-time', '25', url]) == b'404', url
except BaseException:
    for target in changes:
        shutil.copy2(backup / target.relative_to('/'), target)
    for target in container_files:
        subprocess.run(['docker', 'cp', str(backup / 'container' / target.relative_to(api)), 'iot_api:/app/' + target.relative_to(api).as_posix()], check=True)
    raise
print(json.dumps({'backup': str(backup), 'files': len(changes), 'public_scene_hashes_verified': True, 'isolation_verified': True}, indent=2))
