import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'output/neighborhood-source');
fs.mkdirSync(out, { recursive: true });
function download(url, filename) {
  const args = [...(process.platform === 'win32' ? ['--ssl-revoke-best-effort'] : []), '-f', '-sS', '--retry', '1', '--max-time', '35', url, '-o', filename];
  execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { stdio: 'inherit' });
}
download('https://tiles.openfreemap.org/planet', path.join(out, 'tilejson.json'));
const meta = JSON.parse(fs.readFileSync(path.join(out, 'tilejson.json'), 'utf8'));
const bbox = [113.596, 34.736, 113.624, 34.764], z = 14, size = 2**z;
const tileX = lon => Math.floor((lon+180)/360*size);
const tileY = lat => Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*size);
const features = [], tiles = [];
for (let x=tileX(bbox[0]); x<=tileX(bbox[2]); x++) for (let y=tileY(bbox[3]); y<=tileY(bbox[1]); y++) {
  const url = meta.tiles[0].replace('{z}',z).replace('{x}',x).replace('{y}',y);
  if (!url.startsWith('https://tiles.openfreemap.org/')) throw Error('Unexpected tile host');
  const filename = path.join(out, `${z}-${x}-${y}.pbf`);
  download(url, filename); tiles.push(url);
  const tile = new VectorTile(new PbfReader(fs.readFileSync(filename)));
  for (const name of ['building','transportation','landcover','landuse','water']) {
    const layer = tile.layers[name];
    for (let i=0; i<(layer?.length||0); i++) {
      const feature = layer.feature(i).toGeoJSON(x,y,z), p=feature.properties;
      const props={class:p.class,subclass:p.subclass,render_height:p.render_height,render_min_height:p.render_min_height,brunnel:p.brunnel,layer:p.layer};
      features.push({...feature, properties:{...props, source_layer:name, source_id:feature.id??null,tile:`${z}/${x}/${y}`}});
    }
  }
}
fs.writeFileSync(path.join(out,'decoded.json'), JSON.stringify({type:'FeatureCollection',bbox,source_metadata:{provider:'OpenFreeMap / OpenMapTiles / OpenStreetMap',tilejson:'https://tiles.openfreemap.org/planet',tiles,retrieved_at:new Date().toISOString(),coordinate_system:'WGS84',license:'ODbL-1.0',zoom:z,complete_survey:false,height_note:'Tile rendering heights may include defaults and are scenario parameters, not verified survey heights.'},features}));
console.log(JSON.stringify({tiles:tiles.length,features:features.length,output:path.join(out,'decoded.json')}));
