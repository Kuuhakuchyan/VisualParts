import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const old = JSON.parse(fs.readFileSync(path.join(root, 'public/data/zzu_osm_buildings.geojson'), 'utf8'));
const bbox = [113.519, 34.805, 113.541, 34.831];
const query = `[out:json][timeout:25];way[building](${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]});out geom;`;
const features = new Map(old.features.map(f => [String(f.id), { ...f, properties: { ...f.properties, height_m: null, height_source: 'legacy_estimate_unverified' } }]));
let provider = null, raw = null;
for (const endpoint of ['https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter']) {
  try {
    const response = await fetch(`${endpoint}?data=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(35000), headers: { 'User-Agent': 'MicroclimateResearch/1.0 (OpenStreetMap attribution retained)' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const value = await response.json();
    if (!Array.isArray(value.elements) || !value.elements.length || value.remark) throw new Error('Incomplete Overpass response');
    raw = value; provider = endpoint; break;
  } catch (error) { console.warn(`${endpoint}: ${error.message}`); }
}
if (!raw) { console.error('No complete upstream response; existing files left untouched.'); process.exitCode = 1; }
else {
  for (const item of raw.elements) {
    if (!item.geometry || item.geometry.length < 4) continue;
    const ring = item.geometry.map(p => [p.lon, p.lat]);
    if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1))) continue;
    const tags = item.tags || {}, numeric = s => /^[0-9]+([.][0-9]+)?(?:[ ]*m)?$/.test(String(s ?? '').trim()) ? parseFloat(s) : null;
    let height = numeric(tags.height), height_source = 'missing_assumed_18m';
    if (height && height <= 200) height_source = 'osm_height';
    else { const levels = numeric(tags['building:levels']); height = levels && levels <= 60 ? levels * 3 : null; if (height) height_source = 'osm_levels'; }
    if (!(height > 0 && height <= 200)) height = null;
    const id = `osm-way-${item.id}`;
    features.set(id, { type: 'Feature', id, properties: { id, osm_id: item.id, name: tags.name || '', building: tags.building, height_m: height, height_source, levels: numeric(tags['building:levels']), source: 'OpenStreetMap', license: 'ODbL-1.0' }, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
  const result = { type: 'FeatureCollection', name: 'campus-buildings', bbox, attribution: '© OpenStreetMap contributors · ODbL 1.0', source_metadata: { retrieved_at: new Date().toISOString(), provider, query, osm_base_timestamp: raw.osm3s?.timestamp_osm_base || null, original_features: old.features.length, upstream_features: raw.elements.length, merged_features: features.size, complete_survey: false, height_note: 'OSM heights are unverified source attributes. building:levels × 3m is a disclosed estimate; missing or legacy heights are null and rendered with an 18m scenario assumption. OSM ways only; no claim of complete building or multipolygon-relation coverage.' }, features: [...features.values()] };
  const output = path.join(root, 'public/data/campus-buildings.geojson');
  fs.writeFileSync(output, JSON.stringify(result));
  console.log(JSON.stringify({ output, features: features.size, upstream: raw.elements.length, heights: result.features.filter(f => f.properties.height_m != null).length, bbox }));
}
