"""Configure independent runtime without emitting credentials."""
import os
import re
import sys
from pathlib import Path

release=Path(sys.argv[1])
env={}
source=Path('/etc/microclimate-aic.env')
if source.exists():
    for line in source.read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key,value=line.split('=',1)
            if key in {'AIC_DEEPSEEK_API_KEY','AIC_DEEPSEEK_MODEL','AIC_DEEPSEEK_BASE_URL','AIC_MODEL_TIMEOUT_SECONDS'}:
                env[key]=value
env.update({
    'APP_VERSION':release.name,'ALLOWED_HOSTS':'aic.nogamenolife.cn,127.0.0.1,localhost',
    'ALLOWED_ORIGINS':'https://aic.nogamenolife.cn','COLLECTION_IOT_DISABLED':'1',
    'MOBILE_TELEMETRY_ENABLED':'0',
    'AIC_STATE_DB':'/root/microclimate-aic/state/evidence.sqlite3',
    'WORKSPACE_STATE_DB':'/root/microclimate-aic/state/plans.sqlite3',
    'AIC_SOURCE_MANIFEST':'/root/microclimate-aic/state/sources/sources.json',
    'AIC_REVIEW_FILE':'/root/microclimate-aic/state/review-private/reviews.json',
    'DECISION_ENABLE_LEGACY_MOCK':'0','USE_MOCK_AGI':'1',
})
target=Path('/etc/microclimate-aic-independent.env')
target.write_text(''.join(f'{k}={v}\n' for k,v in env.items()))
target.chmod(0o600)
Path('/etc/systemd/system/microclimate-aic-api.service').write_text('''[Unit]
Description=Independent anonymous AIC decision API
After=network.target
[Service]
WorkingDirectory=/root/microclimate-aic
EnvironmentFile=/etc/microclimate-aic-independent.env
ExecStart=/root/microclimate-aic/.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 3102
Restart=on-failure
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
''')
p=Path('/etc/nginx/sites-available/weather')
text=p.read_text()
text=re.sub(r'\s*location = /decision/aic/(?:home|journal)\.html \{[^}]*\}', '', text)
if 'location ^~ /decision/aic/' not in text:
    anchor='    location /decision/assets/ {'
    assert anchor in text
    text=text.replace(anchor,'''    location ^~ /decision/aic/ { return 404; }
    location = /decision/aic { return 404; }
    location ^~ /aic/ { return 404; }
    location = /aic { return 404; }

'''+anchor)
p.write_text(text)
print('Independent environment configured; credentials not logged.')
