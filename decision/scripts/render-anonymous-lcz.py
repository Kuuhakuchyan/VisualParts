"""Raster preview of supplied LCZ polygons, with no institution/place labels."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
data = json.loads((root/"public/data/campus-lcz-simulation.geojson").read_text(encoding="utf-8"))
colors = {2:"#be7469",5:"#cf9475",8:"#d7aa75",9:"#d6b897",11:"#327769",12:"#6d9a75",13:"#93ad80",14:"#bdc997",15:"#a7adb0",17:"#5c9eaf"}
names = {2:"Compact midrise*",5:"Open midrise*",9:"Sparse buildings*",11:"Dense trees",12:"Scattered trees",13:"Bush / scrub",14:"Low plants",15:"Paved surface",17:"Water"}
all_rings = [ring for f in data["features"] for poly in ([f["geometry"]["coordinates"]] if f["geometry"]["type"]=="Polygon" else f["geometry"]["coordinates"]) for ring in poly]
xs = [p[0] for r in all_rings for p in r];ys = [p[1] for r in all_rings for p in r]
w,e,s,n = min(xs),max(xs),min(ys),max(ys)
image = Image.new("RGB",(1200,850),"#eaf0ec");draw=ImageDraw.Draw(image)
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",22)
small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",16)
draw.text((40,30),"Local climate zones / constrained surface mosaic",font=font,fill="#214c48")
scale = min(730/((e-w)*.82),680/(n-s))
def point(p):
    return (100+(p[0]-w)*.82*scale,110+(n-p[1])*scale)
for feature in data["features"]:
    code = int(feature["properties"]["lcz"])
    polygons = [feature["geometry"]["coordinates"]] if feature["geometry"]["type"]=="Polygon" else feature["geometry"]["coordinates"]
    for polygon in polygons:
        mask=Image.new("L",image.size,0);d=ImageDraw.Draw(mask);d.polygon([point(p) for p in polygon[0]],fill=255)
        for ring in polygon[1:]: d.polygon([point(p) for p in ring],fill=0)
        image.paste(colors.get(code,"#c6cecc"),mask=mask)
for i,(code,name) in enumerate(names.items()):
    y=145+i*65;draw.rectangle((810,y,835,y+25),fill=colors[code]);draw.text((850,y),f"{code}  {name}",font=small,fill="#214c48")
draw.text((40,810),"* Provisional built types / assumed heights / uncalibrated simulation",font=small,fill="#486c65")
image.save(root/"public/aic/assets/landcover.png")
