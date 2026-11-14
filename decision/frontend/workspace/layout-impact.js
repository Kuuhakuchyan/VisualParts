const weatherLayers = ['risk', 'weather', 'heatindex', 'anomaly'];
const empty = Object.freeze({ type: 'FeatureCollection', features: [] });

// A layout difference is an annotation on the original field, not a new
// air-temperature value. Refuse overlays from a different boundary snapshot.
export function layoutImpact(result, heat, layer, mode) {
  if (!result || !weatherLayers.includes(layer) || ['baseline', 'delta'].includes(mode) ||
      ['no_edits', 'night_no_shortwave', 'no_comparable_cells'].includes(result.effect_status)) return empty;
  if (result.data_mode !== heat?.data_mode) return empty;
  if (result.data_mode === 'lcz_simulation') {
    if (!result.lcz_snapshot_sha256 || result.lcz_snapshot_sha256 !== heat.snapshot_sha256) return empty;
  } else {
    const observation = heat?.samples?.find(sample => sample.observation)?.observation;
    if (!observation || Date.parse(observation.observed_at) !== Date.parse(result.valid_time)) return empty;
  }
  return { type: 'FeatureCollection', features: (result.cells?.features || []).filter(feature => {
    const p = feature.properties;
    return p.comparable_area_m2 > 0.01 && Number.isFinite(p.delta_utci_c) && Math.abs(p.delta_utci_c) >= 0.001;
  }).map((feature, index) => ({ ...feature, id: index, properties: { ...feature.properties,
    value: feature.properties.delta_utci_c, time: result.valid_time, report_sha256: result.report_sha256 } })) };
}

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function impactAt(features, point) {
  if (!point) return null;
  return features.find(feature => {
    const polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [feature.geometry.coordinates];
    return polygons.some(rings => inRing(rings[0], point.longitude, point.latitude) &&
      !rings.slice(1).some(hole => inRing(hole, point.longitude, point.latitude)));
  })?.properties || null;
}
