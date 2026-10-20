import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type), length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const check = Buffer.alloc(4); check.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, name, data, check]);
}
function preview(features, bbox) {
  const width = 960, height = 640, pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (width * 3 + 1) + 1 + x * 3;
    const color = (x % 60 === 0 || y % 60 === 0) ? [39, 62, 60] : [26, 43, 42];
    pixels.set(color, offset);
  }
  const [w, s, e, n] = bbox;
  const project = ([lon, lat]) => [35 + (lon - w) / (e - w) * (width - 70), 30 + (n - lat) / (n - s) * (height - 60)];
  // Even-odd scanlines preserve holes instead of inventing a new campus illustration.
  for (const feature of features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const polygon of polygons) {
      const rings = polygon.map(ring => ring.map(project));
      for (let y = 0; y < height; y++) {
        const intersections = [];
        for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[j], b = ring[i];
          if ((a[1] > y) !== (b[1] > y)) intersections.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        intersections.sort((a, b) => a - b);
        for (let k = 0; k + 1 < intersections.length; k += 2) for (let x = Math.max(0, Math.ceil(intersections[k])); x <= Math.min(width - 1, intersections[k + 1]); x++) {
          pixels.set([123, 177, 163], y * (width * 3 + 1) + 1 + x * 3);
        }
      }
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export function competitionAssets() {
  const original = JSON.parse(fs.readFileSync(path.join(root, 'public/data/zzu_osm_buildings.geojson'), 'utf8'));
  const features = original.features.map((f, index) => ({ type: 'Feature', id: index, geometry: f.geometry, properties: {
    height_m: typeof f.properties?.height_m === 'number' ? f.properties.height_m : null, name: `某校园建筑 ${String(index + 1).padStart(3, '0')}`,
  } }));
  const data = { type: 'FeatureCollection', name: 'anonymous-campus-buildings', attribution: '© OpenStreetMap contributors · ODbL 1.0',
    anonymization: 'Institution names and OSM object identifiers omitted for anonymous presentation; geographic coordinates and source geometry retained. Not a synthetic campus or independent survey.',
    bbox: original.bbox, features };
  return { 'campus-buildings.geojson': Buffer.from(JSON.stringify(data)), 'campus-preview.png': preview(features, original.bbox) };
}
export function writeCompetitionAssets(output) {
  const directory = path.join(output, 'aic/assets'); fs.mkdirSync(directory, { recursive: true });
  for (const [filename, data] of Object.entries(competitionAssets())) fs.writeFileSync(path.join(directory, filename), data);
}
