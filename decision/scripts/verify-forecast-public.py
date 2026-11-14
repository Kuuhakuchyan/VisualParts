"""Public forecast and construction computation acceptance; saves no shared scenes."""
import json
import time
from pathlib import Path
from datetime import datetime
import httpx
from backend.aic.store import digest

origin='https://aic.nogamenolife.cn'
checks,frames=[],[]
def check(value,label):
    assert value,label
    checks.append(label)

payload=dict(scene=dict(name='QA transient forecast',additions=[],removed_ids=[]),resolution_m=100,
    regional=dict(bounds=dict(west=113.526,east=113.530,south=34.812,north=34.816),area_kind='campus',
                  mode='current',data_mode='lcz_simulation',grid_resolution_m=100,groups=['students','athletes','workers'],
                  use_ai=False))
with httpx.Client(base_url=origin,timeout=100,trust_env=False) as client:
    timeline=client.get('/api/weather/aic/timeline?site=campus').raise_for_status().json()
    points=[p for p in timeline['points'] if p['period']=='forecast']
    check(len(points)>=23,'available hourly forecast horizon')
    for i,point in enumerate(points):
        start=time.monotonic()
        r=client.post('/api/weather/sandbox/simulate',json={**payload,'valid_time':point['time']}).raise_for_status().json()
        check(datetime.fromisoformat(r['valid_time'])==datetime.fromisoformat(point['time']),f'hour {i} selected time')
        check(r['is_forecast'] and r['weather_boundary']['source_type']=='open_meteo_forecast',f'hour {i} forecast provenance')
        check(r['solar']['time']==r['weather_boundary']['observed_at']==r['regional_report']['layout_exposure']['valid_time'],f'hour {i} solar/report same hour')
        check(r['report_sha256']==digest({k:v for k,v in r.items() if k!='report_sha256'}),f'hour {i} digest')
        check(r['summary']['delta_utci_c'] in {None,0},f'hour {i} unedited zero comparison')
        check(len(r['cells']['features'])>1,f'hour {i} spatial field')
        frames.append(dict(time=r['valid_time'],seconds=round(time.monotonic()-start,3),weather=r['weather_boundary'],
                           solar=r['solar'],summary=r['summary'],grid_sha256=digest(r['cells']),report_sha256=r['report_sha256']))
        if i in {0,len(points)-1}:
            Path(f'output/playwright/forecast-public-hour-{i}.json').write_text(json.dumps(r,ensure_ascii=False),encoding='utf-8')
        print(json.dumps(dict(frame=i,time=r['valid_time'],seconds=frames[-1]['seconds'],utci=r['summary']['proposed_utci_c'],altitude=r['solar']['altitude_deg'])),flush=True)
    check(len({f['grid_sha256'] for f in frames})>2,'forecast hours produce different computed grids')
    day=max(frames,key=lambda f:f['solar']['altitude_deg'])
    construction={**payload,'valid_time':day['time'],'scene':dict(name='QA transient build',removed_ids=[],additions=[
        dict(id='new-qa-forecast',longitude=113.528143,latitude=34.813813,width_m=20,depth_m=20,height_m=60,rotation_deg=0)])}
    built=client.post('/api/weather/sandbox/simulate',json=construction).raise_for_status().json()
    check(built['summary']['changed_cells']>0,'construction alters daytime thermal field')
    check(built['summary']['local_delta_min_c']<0,'constructed shade lowers local radiant heat exposure')
    check(built['regional_report']['layout_exposure']['scene_sha256']==built['scene_sha256'],'building/report scene match')
    check(built['weather_boundary']['temperature_c']==day['weather']['temperature_c'],'same weather boundary for layout comparison')
    Path('output/playwright/forecast-public-built.json').write_text(json.dumps(built,ensure_ascii=False),encoding='utf-8')
    for stamp in ['2024-01-01T00:00:00+08:00',points[0]['time'].split('+')[0],points[0]['time'].replace(':00:00',':30:00')]:
        check(client.post('/api/weather/sandbox/simulate',json={**payload,'valid_time':stamp}).status_code==422,'invalid time rejected '+stamp)

Path('output/playwright/forecast-public-checks.json').write_text(json.dumps(dict(checks=checks,frames=frames,construction=built['summary']),ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(dict(passed=len(checks),frames=len(frames),construction=built['summary']),ensure_ascii=False))
