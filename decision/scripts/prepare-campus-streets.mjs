import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = process.argv[2] || path.join(root, 'output/campus-data');
const inventory = JSON.parse(fs.readFileSync(path.join(directory, 'inventory.json'), 'utf8'));
const source = fs.readFileSync(path.join(directory, 'local-layers.geojson.json'));
const layers = JSON.parse(source);
const names = ['\u8def1', '\u8def2'];
const metadata = names.map(name => inventory.layers.find(layer => layer.name === name));
if (metadata.some(layer => !layer || layer.type !== 'POLYLINE' || !layer.crs.includes('WGS_1984') || layer.invalid_geometries)) throw new Error('Road source needs explicit CRS/geometry review');
const features = names.flatMap((name, layerIndex) => {
  const layer = layers.find(layer => layer.name === name);
  if (layer?.features.length !== metadata[layerIndex].count) throw new Error('Road source count mismatch');
  return layer.features.map((feature, index) => ({ type: 'Feature', id: `local-road-${layerIndex + 1}-${index + 1}`,
    geometry: feature.geometry, properties: { source_type: 'user_supplied_digitized_road', survey_verified: false } }));
});
for (const feature of features) {
  const g = feature.geometry;
  if (!['LineString', 'MultiLineString'].includes(g.type)) throw new Error('Road is not a line');
  const lines = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
  if (lines.some(line => line.length < 2 || line.some(p => p.length !== 2 || !p.every(Number.isFinite) || p[0] < 113.4 || p[0] > 113.9 || p[1] < 34.6 || p[1] > 34.95))) throw new Error('Invalid WGS84 road coordinates');
}
const data = { type: 'FeatureCollection', bbox: inventory.boundary.bounds_wgs84,
  attribution: '用户提供数字化道路线（非测绘，日期与授权待核验）',
  source_metadata: { crs: 'EPSG:4326', source_type: 'user_supplied_digitized_road', capture_date: null,
    license: 'user_supplied_rights_unverified', survey_verified: false, inspected_at: inventory.inspected_at,
    prepared_at: new Date().toISOString(), input_sha256: createHash('sha256').update(source).digest('hex'),
    layers: metadata.map((layer, index) => ({ id: `local-road-${index + 1}`, count: layer.count, source_sha256: layer.sha256 })),
    note: 'Source geometry retained without names; not live road status, a new survey, or a complete campus inventory.' }, features };
fs.writeFileSync(path.join(root, 'public/data/campus-streets.geojson'), JSON.stringify(data));
console.log(JSON.stringify({ features: features.length, ...data.source_metadata }));
