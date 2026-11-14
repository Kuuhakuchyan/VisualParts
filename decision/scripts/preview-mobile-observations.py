"""Isolated UI preview, never connects to production telemetry storage."""
import hashlib
import io
import os
from pathlib import Path
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
temporary = tempfile.TemporaryDirectory(prefix="mobile-ui-preview-")
os.environ.update(TELEMETRY_STATE_DB=str(Path(temporary.name)/"data.sqlite3"),
                  TELEMETRY_MEDIA_DIR=str(Path(temporary.name)/"images"),
                  MOBILE_TELEMETRY_ENABLED="1", MOBILE_TELEMETRY_PUBLIC_VIEW="1", COLLECTION_IOT_DISABLED="0")
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image
from backend import telemetry, telemetry_view
from backend.test_telemetry_view import sample

app = FastAPI()
app.include_router(telemetry_view.router)
output=io.BytesIO();Image.new("RGB",(320,180),(40,103,128)).save(output,"PNG")
raw=output.getvalue();digest=hashlib.sha256(raw).hexdigest()
telemetry.persist_media(raw,digest,"image/png")
for kind in ("UGV","UAV"):
    for i in range(3):
        body=sample(kind,age=40-i*10);body["seq"]=i
        body["device_name"]="本地验收 "+kind
        body["location"]["longitude"]+=i*0.0002
        body["measurements"]["temperature_c"]+=i
        body["visual_frames"]=[{"frame_id":f"frame-{i}","captured_at":body["sampled_at_ms"],
            "storage_uri":telemetry.MEDIA_PREFIX+digest,"sha256":digest,"mime_type":"image/png","size_bytes":len(raw)}]
        telemetry.store.save(telemetry.MobileTelemetry.model_validate(body))

@app.get('/sensors')
def sensors():return FileResponse(root.parent/'api/templates/sensors.html')

@app.get('/api/sensors/detail')
def fixed():return [{"device_id":"FIXED-QA","device_type":"ATOM_LITE","online":False,"fields":[]}]

@app.get('/console.css')
def styles():return FileResponse(root.parent/'api/static/console.css')

@app.get('/logo.png')
def logo():return FileResponse(root.parent/'api/logo.png')

app.mount('/home-assets',StaticFiles(directory=root.parent/'api/static/home'))
app.mount('/decision/ui-fonts',StaticFiles(directory=root/'public/ui-fonts'))

if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='127.0.0.1',port=8876)
