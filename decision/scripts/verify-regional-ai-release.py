"""Public read/compute acceptance only; creates no saved scenes or device commands."""
import argparse
import json
from pathlib import Path

import httpx
from shapely.geometry import box, shape

parser=argparse.ArgumentParser()
parser.add_argument('--origin',required=True)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
regional=dict(area_kind='campus', mode='history', data_mode='lcz_simulation', grid_resolution_m=30,
              bounds=dict(west=113.528,south=34.816,east=113.533,north=34.821),
              groups=['students','workers'],activity='walk',exposure_minutes=30,exposure='unknown',use_ai=False)
with httpx.Client(base_url=args.origin,timeout=120,trust_env=False) as client:
    buildings=client.get('/api/weather/sandbox/buildings').raise_for_status().json()
    region=box(113.528,34.816,113.533,34.821)
    building=next(f for f in buildings['features'] if region.covers(shape(f['geometry'])))
    records=[]
    for name,removed,ai in [('baseline',[],False),('demolished',[building['id']],False),('ai_interpretation',[building['id']],True)]:
        scene=dict(name='QA transient '+name,additions=[],removed_ids=removed)
        data=client.post('/api/weather/sandbox/simulate',json=dict(scene=scene,regional={**regional,'use_ai':ai},resolution_m=50)).raise_for_status().json()
        assert data['regional_report']['layout_exposure']['scene_sha256']==data['scene_sha256']
        assert data['summary']['total_cells']>1
        records.append(data)
    assert records[0]['scene_sha256']!=records[1]['scene_sha256']
    assert records[0]['summary']['delta_utci_c']==0
    changed=sum(a['properties']['proposed_shade']!=b['properties']['proposed_shade'] or a['properties']['proposed_occupied']!=b['properties']['proposed_occupied'] or a['properties']['proposed_utci_c']!=b['properties']['proposed_utci_c'] for a,b in zip(records[0]['cells']['features'],records[1]['cells']['features']))
    assert changed>0,'Demolition must change actual computed cells, not only mesh rendering'
    report=dict(checks=['same_scene_digest','multiple_cells','baseline_zero_delta','demolition_changes_computed_cells'],
                changed_cells=changed,removed_building_id=building['id'],
                summaries=[r['summary'] for r in records],
                generation=records[-1]['regional_report']['generation'],
                report_sha256=records[-1]['report_sha256'],scene_sha256=records[-1]['scene_sha256'])
    args.output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))
