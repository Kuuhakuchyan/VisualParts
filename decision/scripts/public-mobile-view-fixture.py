"""Temporary labelled public UI acceptance records, with exact-ID cleanup."""
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from uuid import uuid4
import urllib.request

from PIL import Image

release=Path(__file__).resolve().parent
manifest=release/'ui-fixtures.json'
config=dict(line.split('=',1) for line in Path('/etc/microclimate-project-telemetry.env').read_text().splitlines() if '=' in line)
origin='https://weather.nogamenolife.cn'


def call(path,body=None,mime='application/json'):
    data=body if isinstance(body,bytes) else json.dumps(body).encode() if body is not None else None
    request=urllib.request.Request(origin+path,data=data,headers={'X-Telemetry-Token':config['TELEMETRY_INGEST_TOKEN'],'Content-Type':mime},method='PUT' if isinstance(body,bytes) else 'POST' if body is not None else 'GET')
    with urllib.request.urlopen(request,timeout=25) as response:return json.load(response)


if sys.argv[1]=='seed':
    assert not manifest.exists(), 'Fixture already exists; clean up before repeating'
    tag=uuid4().hex[:10]
    devices=[{'id':f'UI-QA-{kind}-{tag}','type':kind} for kind in ('UGV','UAV')]
    output=io.BytesIO();Image.new('RGB',(128,80),(int(tag[:2],16),100,180)).save(output,'PNG')
    raw=output.getvalue();digest=hashlib.sha256(raw).hexdigest()
    state={'devices':devices,'media':digest,'before_count':len(call('/api/weather/telemetry/devices')['devices'])}
    manifest.write_text(json.dumps(state,indent=2))
    media=call('/api/weather/telemetry/media/'+digest,raw,'image/png')
    for device in devices:
        for seq in range(3):
            stamp=(datetime.now(timezone.utc)-timedelta(seconds=(3-seq)*10)).isoformat(timespec='milliseconds')
            payload={'uuid':str(uuid4()),'device_type':device['type'],'device_id':device['id'],
                'device_name':device['type'],'task_id':'PUBLIC-UI-ACCEPTANCE-ONLY','seq':seq,'sampled_at_ms':stamp,
                'status':{'state':'dwell','mode':'dwell','is_synced':True},
                'location':{'latitude':34.813483+seq*0.0001,'longitude':113.53853+seq*0.0001,'altitude_m':30 if device['type']=='UAV' else 1.5,'altitude_reference':'agl'},
                'measurements':{'temperature_c':25.6+seq,'humidity_pct':62.4},
                'power':{'soc_pct':82,'voltage_v':24.6},'quality_flag':2147483648,
                'visual_frames':[{**{k:v for k,v in media.items() if k!='stored'},'frame_id':f'qa-{seq}','captured_at':stamp}]}
            result=call('/api/weather/telemetry/'+device['type'].lower(),payload)
            assert result['accepted']==1
    print(json.dumps({'seeded':devices,'records':6,'before_device_count':state['before_count']}))
elif sys.argv[1]=='cleanup':
    state=json.loads(manifest.read_text())
    ids=[d['id'] for d in state['devices']]
    assert all(device.startswith('UI-QA-') for device in ids)
    with sqlite3.connect(config['TELEMETRY_STATE_DB']) as db:
        for device in ids:
            foreign=db.execute("SELECT COUNT(*) FROM mobile_telemetry WHERE device_id=? AND task_id!='PUBLIC-UI-ACCEPTANCE-ONLY'",(device,)).fetchone()[0]
            assert foreign==0, 'Device ID collision: refusing cleanup'
            for table in ('mobile_telemetry','mobile_device_current','mobile_aux_records','mobile_aux_current'):
                db.execute(f'DELETE FROM {table} WHERE device_id=?',(device,))
        referenced=db.execute("SELECT COUNT(*) FROM mobile_telemetry t, json_each(t.payload,'$.visual_frames') f WHERE json_extract(f.value,'$.sha256')=?",(state['media'],)).fetchone()[0]
        if not referenced:
            db.execute('DELETE FROM mobile_media WHERE sha256=?',(state['media'],))
            (Path(config['TELEMETRY_MEDIA_DIR'])/state['media']).unlink(missing_ok=True)
    remaining=call('/api/weather/telemetry/devices')['devices']
    assert not any(d['device_id'] in ids for d in remaining)
    state.update(cleaned=True,remaining_device_count=len(remaining))
    manifest.write_text(json.dumps(state,indent=2))
    print(json.dumps({'cleaned':True,'remaining_device_count':len(remaining)}))
