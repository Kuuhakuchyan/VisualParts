"""Read projection regression tests against temporary storage only."""
import hashlib
import io
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from backend import telemetry, telemetry_view as view


def sample(kind="UGV", age=10):
    return {"uuid": str(uuid4()), "device_type": kind, "device_id": kind+"-UI-QA", "device_name": "观测设备 <测试>",
            "task_id": "ui-test", "seq": 1,
            "sampled_at_ms": (datetime.now(timezone.utc)-timedelta(seconds=age)).isoformat(timespec="milliseconds"),
            "status": {"state": "dwell", "is_synced": True},
            "location": {"latitude":34.813,"longitude":113.532,"altitude_m":30,"altitude_reference":"agl"},
            "measurements": {"temperature_c":25.6,"humidity_pct":62.4}, "quality_flag":0,
            "attributes":{"private_note":"not public"}}


class ViewTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        env=patch.dict(os.environ,{"MOBILE_TELEMETRY_ENABLED":"1","MOBILE_TELEMETRY_PUBLIC_VIEW":"1",
                                   "COLLECTION_IOT_DISABLED":"0","TELEMETRY_INGEST_TOKEN":"test-only",
                                   "TELEMETRY_MEDIA_DIR":str(Path(self.tmp.name)/"media")})
        env.start();self.addCleanup(env.stop)
        replacement=patch.object(telemetry,"store",telemetry.TelemetryStore(str(Path(self.tmp.name)/"data.sqlite3")))
        replacement.start();self.addCleanup(replacement.stop)
        app=FastAPI();app.include_router(telemetry.router);app.include_router(view.router)
        self.client=TestClient(app);self.addCleanup(self.client.close)

    def upload(self, body):
        result=self.client.post('/api/weather/telemetry/'+body['device_type'].lower(),json=body,headers={'X-Telemetry-Token':'test-only'})
        self.assertEqual(result.status_code,200,result.text)

    def test_empty_and_ingestion_still_private(self):
        self.assertEqual(self.client.get(view.PREFIX+'/devices').json()['devices'],[])
        self.assertEqual(self.client.get('/api/weather/telemetry/devices').status_code,401)
        self.assertEqual(self.client.post(view.PREFIX+'/devices',json=sample()).status_code,405)

    def test_both_types_visible_without_internal_metadata(self):
        for kind in ('UGV','UAV'):self.upload(sample(kind))
        response=self.client.get(view.PREFIX+'/devices')
        self.assertEqual(response.headers['cache-control'],'no-store')
        rows=response.json()['devices'];self.assertEqual(len(rows),2)
        self.assertNotIn('private_note',response.text)
        for row in rows:
            self.assertTrue(row['online']);self.assertFalse(row['thermal_assimilated'])
            data=self.client.get(view.PREFIX+'/devices/'+row['device_id']).json()
            self.assertEqual(data['stats']['total'],1)
            self.assertEqual(data['observations'][0]['measurements']['temperature_c'],25.6)
            self.assertEqual(len(data['track']['features']),1)

    def test_aic_and_disabled_view_blocked(self):
        for suffix in ('/devices','/devices/UGV-UI-QA','/images/'+'a'*64):
            self.assertEqual(self.client.get(view.PREFIX+suffix,headers={'Host':'aic.nogamenolife.cn'}).status_code,404)
            with patch.dict(os.environ,{'COLLECTION_IOT_DISABLED':'1'}):
                self.assertEqual(self.client.get(view.PREFIX+suffix).status_code,404)
            with patch.dict(os.environ,{'MOBILE_TELEMETRY_PUBLIC_VIEW':'0'}):
                self.assertEqual(self.client.get(view.PREFIX+suffix).status_code,404)

    def test_old_sample_new_heartbeat_does_not_become_live_temperature(self):
        body=sample(age=600);self.upload(body)
        beat={k:body[k] for k in ('device_id','device_name','device_type','status')}
        beat.update(uuid=str(uuid4()),sampled_at_ms=datetime.now(timezone.utc).isoformat(timespec='milliseconds'))
        response=self.client.post('/api/weather/telemetry/status',json=beat,headers={'X-Telemetry-Token':'test-only'})
        self.assertEqual(response.status_code,200,response.text)
        row=view.public_devices()[0];self.assertTrue(row['online'])
        self.assertNotEqual(row['component_times']['status'],row['component_times']['measurements'])
        field=view.field_devices()[0];self.assertEqual(field['status'],'awaiting_sample');self.assertIsNone(field['temperature_c'])

    def test_heartbeat_only_is_visible_with_empty_history(self):
        body=sample()
        beat={k:body[k] for k in ('device_id','device_name','device_type','status','uuid','sampled_at_ms')}
        self.assertEqual(self.client.post('/api/weather/telemetry/status',json=beat,headers={'X-Telemetry-Token':'test-only'}).status_code,200)
        data=self.client.get(view.PREFIX+'/devices/'+body['device_id']).json()
        self.assertEqual(data['stats']['total'],0);self.assertEqual(data['observations'],[])

    def test_quality_flags_and_invalid_fix_not_promoted(self):
        body=sample();body['quality_flag']=1;body['location']['fix_type']='none';self.upload(body)
        self.assertEqual(view.field_devices()[0]['status'],'awaiting_sample')
        self.assertEqual(self.client.get(view.PREFIX+'/devices/'+body['device_id']).json()['track']['features'],[])

    def test_bounds_and_unknown_device(self):
        self.upload(sample())
        for limit in (0,201,-1):self.assertEqual(self.client.get(view.PREFIX+f'/devices/UGV-UI-QA?limit={limit}').status_code,422)
        self.assertEqual(self.client.get(view.PREFIX+'/devices/unknown').status_code,404)
        self.assertEqual(self.client.get(view.PREFIX+'/images/not-a-hash').status_code,422)

    def test_backfill_does_not_replace_latest(self):
        self.upload(sample())
        old=sample(age=3600);old['seq']=0;old['measurements']['temperature_c']=12;self.upload(old)
        data=self.client.get(view.PREFIX+'/devices/UGV-UI-QA').json()
        self.assertEqual(data['stats']['total'],2)
        self.assertEqual(data['device']['measurements']['temperature_c'],25.6)
        self.assertEqual(data['observations'][-1]['measurements']['temperature_c'],12)

    def test_image_preview_requires_observation_reference_and_strips_exif(self):
        output=io.BytesIO();image=Image.new('RGB',(20,20),'red');exif=Image.Exif();exif[315]='private-author';image.save(output,'JPEG',exif=exif)
        raw=output.getvalue();digest=hashlib.sha256(raw).hexdigest()
        response=self.client.put(telemetry.MEDIA_PREFIX+digest,content=raw,headers={'X-Telemetry-Token':'test-only','Content-Type':'image/jpeg'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.client.get(view.PREFIX+'/images/'+digest).status_code,404)
        body=sample();body['visual_frames']=[{'frame_id':'frame-01','captured_at':body['sampled_at_ms'],
            'storage_uri':telemetry.MEDIA_PREFIX+digest,'sha256':digest,'mime_type':'image/jpeg','size_bytes':len(raw)}]
        self.upload(body)
        response=self.client.get(view.PREFIX+'/images/'+digest)
        self.assertEqual(response.status_code,200)
        with Image.open(io.BytesIO(response.content)) as preview:self.assertFalse(preview.getexif())
        self.assertEqual(self.client.get(telemetry.MEDIA_PREFIX+digest).status_code,401)

    def test_remote_image_urls_not_exposed_or_fetched(self):
        body=sample();body['visual_frames']=[{'frame_id':'external','captured_at':body['sampled_at_ms'],
            'storage_uri':'https://example.com/private.jpg?token=secret','sha256':'a'*64,'mime_type':'image/jpeg','size_bytes':100}]
        self.upload(body)
        response=self.client.get(view.PREFIX+'/devices/UGV-UI-QA')
        self.assertNotIn('secret',response.text);self.assertNotIn('example.com',response.text)
        self.assertIsNone(response.json()['device']['visual_frames'][0]['preview_url'])


if __name__=='__main__':unittest.main()
