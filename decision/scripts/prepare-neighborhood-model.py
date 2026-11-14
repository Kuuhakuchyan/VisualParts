"""Clip and join public vector-tile geometries into one consistent district model."""
import hashlib
import json
from pathlib import Path

from shapely import make_valid
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
raw = json.loads((ROOT / 'output/neighborhood-source/decoded.json').read_text(encoding='utf-8'))
extent = box(*raw['bbox'])
groups = {}
for feature in raw['features']:
    p = feature['properties']
    # Elevated building parts are not full ground footprints or complete solid buildings.
    if p['source_layer'] == 'building' and (p.get('render_min_height') or 0) > 0:
        continue
    geom = make_valid(shape(feature['geometry'])).intersection(extent)
    if geom.is_empty:
        continue
    source_id = p['source_id']
    key = (p['source_layer'], str(source_id) if source_id is not None else hashlib.sha256(geom.wkb).hexdigest())
    groups.setdefault(key, {'properties': p, 'parts': []})['parts'].append(geom)

result = {'buildings': [], 'streets': [], 'landcover': []}
for (layer, key), group in sorted(groups.items()):
    geom = make_valid(unary_union(group['parts']))
    p = group['properties']
    if layer == 'building':
        if geom.geom_type not in {'Polygon', 'MultiPolygon'}:
            continue
        kind = 'buildings'
        height = p.get('render_height')
        props = {'height_m': None, 'height_source': 'tile_rendering_assumption', 'tile_render_height': height, 'render_height_m': height if isinstance(height, (int, float)) and 6 < height <= 200 else 18}
    elif layer == 'transportation':
        if geom.geom_type not in {'LineString', 'MultiLineString'}:
            continue
        kind = 'streets'
        props = {'highway': p.get('subclass') or p.get('class'), 'brunnel': p.get('brunnel'), 'layer': p.get('layer')}
    else:
        if geom.geom_type not in {'Polygon', 'MultiPolygon'}:
            continue
        kind = 'landcover'
        props = {'kind': 'water' if layer == 'water' else 'green' if p.get('class') in {'grass', 'wood', 'park', 'forest', 'cemetery', 'garden'} else 'urban', 'landuse_class': p.get('class')}
    identity = f'district-{layer}-{key}'
    # OpenMapTiles merges equally styled buildings into MultiPolygons at z14.
    # Keep each disconnected footprint independently selectable and removable.
    parts = list(geom.geoms) if layer == 'building' and geom.geom_type == 'MultiPolygon' else [geom]
    for part in parts:
        part_id = identity + '-' + hashlib.sha256(part.normalize().wkb).hexdigest()[:12] if layer == 'building' else identity
        result[kind].append({'type': 'Feature', 'id': part_id, 'geometry': mapping(part), 'properties': {'id': part_id, 'source': 'OpenFreeMap / OpenStreetMap', **props}})

if not result['buildings'] or not result['streets']:
    raise ValueError('No district buildings or roads; previous model preserved')
unique = {}
for feature in result['buildings']:
    key = shape(feature['geometry']).normalize().wkb
    if key not in unique:
        unique[key] = feature
    else:
        previous = unique[key]['properties']
        previous['render_height_m'] = max(previous['render_height_m'], feature['properties']['render_height_m'])
duplicate_count = len(result['buildings'])-len(unique)
result['buildings'] = list(unique.values())

raw['source_metadata']['footprint_processing'] = {'method': 'clip_join_tiles_split_and_deduplicate_buildings', 'version': 'district-footprints-2', 'duplicate_footprints_removed': duplicate_count, 'note': 'Public vector footprint parts are individually selectable. Identical footprint duplicates are collapsed using the larger rendering-height scenario. Height attributes remain scenario parameters; tile default heights of 6m or below use an explicit 18m assumption.'}
for name, features in result.items():
    data = {'type': 'FeatureCollection', 'area_kind': 'neighborhood', 'bbox': raw['bbox'], 'source_metadata': raw['source_metadata'], 'attribution': '© OpenStreetMap contributors · ODbL 1.0 · OpenFreeMap / OpenMapTiles', 'features': features}
    (ROOT / f'public/data/neighborhood-{name}.geojson').write_text(json.dumps(data, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
print(json.dumps({name: len(features) for name, features in result.items()}))
