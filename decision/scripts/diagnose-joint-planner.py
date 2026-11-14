"""Server-side acceptance diagnosis; never prints credentials or upstream bodies."""
import asyncio
import json
import os
from pathlib import Path
import subprocess

pid=subprocess.check_output(['systemctl','show','microclimate-decision-api.service','--property=MainPID','--value'],text=True).strip()
for item in Path('/proc/'+pid+'/environ').read_bytes().split(b'\0'):
    key,sep,value=item.partition(b'=')
    if sep and key.startswith(b'AIC_DEEPSEEK_'):
        os.environ[key.decode()]=value.decode()

import httpx
from backend import hybrid, sandbox
from backend.test_sandbox import body, boundary

original=httpx.AsyncClient.post


async def diagnose(self,url,**kwargs):
    try:
        response=await original(self,url,**kwargs)
        choice=response.json().get('choices',[{}])[0]
        diagnostics={'status':response.status_code,'finish_reason':choice.get('finish_reason'),'calls':[]}
        for call in choice.get('message',{}).get('tool_calls',[]):
            function=call.get('function',{})
            try:
                arguments=json.loads(function.get('arguments','{}'))
                row={'name':function.get('name'),'keys':list(arguments),
                     'candidates':[{'height_factor':c.get('height_factor'),
                                    'rationale_length':len(c.get('rationale','')),
                                    'evidence_ids':c.get('evidence_ids')} for c in arguments.get('candidates',[])]}
            except (ValueError,TypeError,AttributeError):
                row={'name':function.get('name'),'arguments_parse_failed':True}
            diagnostics['calls'].append(row)
        print(json.dumps(diagnostics,ensure_ascii=False))
        return response
    except Exception as error:
        print(json.dumps({'exception_class':type(error).__name__}))
        raise


async def main():
    request=body(scene={'additions':[{'id':'new-diagnostic','longitude':113.528143,'latitude':34.813813,
        'width_m':20,'depth_m':20,'height_m':60}]},resolution_m=100)
    result=sandbox.simulate(request,boundary())
    async def calculate():return result
    async def compare(candidates):return {'alternatives':[]}
    httpx.AsyncClient.post=diagnose
    _,trace,_=await hybrid.run_tools(request.model_dump(mode='json'),calculate,compare=compare)
    print(json.dumps({'planner':trace['planner'],'stages':trace['stages']}))


asyncio.run(main())
