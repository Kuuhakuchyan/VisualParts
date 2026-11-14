const weatherLayers = ['risk', 'weather', 'heatindex', 'anomaly'];
const scenarioLayers = ['utci', 'mrt', 'shade'];

export const temperatureColors = ['interpolate', ['linear'], ['get', 'value'],
  -15, '#417da5', 10, '#76a8c3', 25, '#d8e4e7', 30, '#e5c095', 35, '#df995a', 40, '#c75450', 50, '#923d48'];
export const differenceColors = ['interpolate', ['linear'], ['get', 'value'],
  -5, '#278dba', -2, '#89c8d4', -0.1, '#e2e5e2', 0.1, '#e2e5e2', 2, '#efb077', 5, '#c75450'];
export const differenceTicks = [[-5, '≤−5'], [-2, '−2'], [0, '0'], [2, '+2'], [5, '≥+5']];
export const anomalyColors = ['interpolate', ['linear'], ['get', 'value'],
  -2, '#357fa9', -0.5, '#8cbdce', 0, '#eceeeb', 0.5, '#e4af79', 2, '#c75450'];

export function thermalResultView(layer, mode, result, {forecast=false}={}) {
  // Calculation must not silently replace an air-temperature/LCZ field with
  // a different physical quantity or its signed before/after difference.
  return {layer, mode};
}

export function thermalPresentation(requestedLayer, mode, result, weatherLayer = 'weather') {
  const unavailable = scenarioLayers.includes(requestedLayer) && !result;
  const unsupportedDifference = mode === 'delta' && requestedLayer === 'utci' &&
    ['night_no_shortwave', 'no_edits', 'no_comparable_cells'].includes(result?.effect_status);
  return {
    layer: unavailable || unsupportedDifference ? (weatherLayers.includes(weatherLayer) ? weatherLayer : 'weather') : requestedLayer,
    fallback: unavailable ? 'pending' : unsupportedDifference ? result.effect_status : null,
  };
}

export function shouldPresentThermalResult(result) {
  return result?.effect_status === 'changed' || result?.effect_status === 'no_resolved_change';
}

export function weatherOnlyEstimate(result) {
  return Number.isFinite(result?.solar?.altitude_deg) && result.solar.altitude_deg < 2 &&
    Number.isFinite(result?.summary?.proposed_utci_c) && result.summary.comparable_cells > 0;
}
