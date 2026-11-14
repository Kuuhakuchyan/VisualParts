"""Public contract checks with explicit historic and current weather, no AI budget."""
import asyncio
import copy
import hashlib
import json
from pathlib import Path

import httpx

BASE="https://weather.nogamenolife.cn"


def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False).encode()).hexdigest()


async def main():
    checks=[]
    def check(value,name):
        if not value:raise AssertionError(name)
        checks.append(name)
    async with httpx.AsyncClient(base_url=BASE,timeout=100) as client:
        response=await client.get('/api/weather/aic/status');response.raise_for_status();status=response.json()
        check('knowledge_audit' in status,'public knowledge audit available')
        check(status['knowledge_provenance']['vector_rag'] is False,'retrieval accurately identified')
        body={'scene':{'name':'QA thermal no persistence','additions':[{'id':'new-qa-coarse','longitude':113.528143,'latitude':34.813813,'width_m':10,'depth_m':10,'height_m':18}]},
              'regional':{'area_kind':'campus','mode':'history','data_mode':'lcz_simulation','grid_resolution_m':100,
                          'bounds':{'west':113.526,'east':113.530,'south':34.812,'north':34.816},'use_ai':False},'resolution_m':100}
        reports=[]
        for name in ['small','tall','restored','night']:
            request=copy.deepcopy(body)
            if name=='tall':request['scene']['additions'][0]['height_m']=60
            if name=='restored':request['scene']['additions']=[]
            if name=='night':request['regional']['mode']='current'
            response=await client.post('/api/weather/sandbox/simulate',json=request);response.raise_for_status();r=response.json()
            check(r['schema_version']=='solar-layout-screening-1.2',name+' server calculation revision')
            check(r['report_sha256']==digest({k:v for k,v in r.items() if k!='report_sha256'}),name+' result integrity')
            linked=r['regional_report'];check(linked['report_sha256']==digest({k:v for k,v in linked.items() if k!='report_sha256'}),name+' report integrity')
            check(linked['layout_exposure']['summary']==r['summary'],name+' linked summary matches')
            check('LAYOUT-LOCAL-CHANGE' in linked['interpretation']['fact_ids'],name+' local changes cannot be suppressed')
            check('knowledge_provenance' in linked,name+' knowledge revision retained')
            check(all(not c['medical_advice'] for c in linked['cohorts']),name+' simulation cannot output medical treatment')
            if name in ['small','tall']:
                check(r['summary']['changed_cells']>0,name+' coarse grid resolves small footprint')
                check(r['summary']['local_delta_min_c']<0,name+' UTCI genuinely changes')
            elif name=='restored':check(r['summary']['delta_utci_c']==0 and r['summary']['changed_cells']==0,'removal restores empty-scene field')
            elif r['solar']['altitude_deg']<2:
                check(r['effect_status']=='night_no_shortwave' and r['summary']['delta_utci_c']==0,'night zero explicitly identified')
            reports.append({'name':name,'request':request,'response':r})
        for key,value in [('height_m',-1),('width_m',10000)]:
            bad=copy.deepcopy(body);bad['scene']['additions'][0][key]=value
            check((await client.post('/api/weather/sandbox/simulate',json=bad)).status_code==422,key+' invalid bound rejected')
    output=Path('output/playwright/thermal-public-api.json');output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps({'checks':checks,'status':status,'reports':reports},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'checks':len(checks),'knowledge_audit':status['knowledge_audit'],
                      'cases':[{'name':r['name'],'summary':r['response']['summary'],'effect_status':r['response']['effect_status']} for r in reports]},ensure_ascii=False))


if __name__=='__main__':asyncio.run(main())
