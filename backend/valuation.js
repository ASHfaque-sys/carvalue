'use strict';
const { norm } = require('./source');
const cleanModel = value => String(value)
  .replace(/^Old Generation\s+/i, '')
  .replace(/^All New\s+/i, '')
  .replace(/\s*\d+(?:st|nd|rd|th)\s+Gen(?:eration)?/gi, '')
  .replace(/\s*\[[^\]]*\]/g, '')
  .replace(/\s+ZX$/i, '')
  .trim();
const transmission = value => /automatic|amt|cvt|dct|dsg|torque converter/i.test(value) ? 'automatic' : /manual/i.test(value) ? 'manual' : norm(value);
const getSpec = (variant, name) => variant.specs.find(s => s.name === name)?.value || '';
function trimTokens(value) {
  return cleanModel(value).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t && !['petrol','diesel','automatic','manual','amt','cvt','dct','cng','hybrid','electric','dual','tone'].includes(t));
}
function trimMatch(variant, row, make, model) {
  if (row.variantId && row.variantId === variant.id) return true;
  if (row.trimName) return norm(row.trimName) === norm(variant.trim);
  const text = row.title.toLowerCase().split('(second')[0].replace(make.toLowerCase(), '').replace(model.toLowerCase(), '');
  const target = trimTokens(variant.trim || variant.name);
  const actual = text.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/);
  // Require every trim token, and avoid treating ZXi Plus as ZXi.
  return target.length > 0 && target.every(t => actual.includes(t)) && (target.includes('plus') || !actual.includes('plus'));
}
function weightedQuantile(rows, q) {
  const sorted = [...rows].sort((a, b) => a.price - b.price), total = rows.reduce((n, r) => n + r.weight, 0);
  let sum = 0; for (const row of sorted) { sum += row.weight; if (sum >= total * q) return row.price; } return sorted.at(-1).price;
}
function priceVehicle(input, vehicle, variant, market) {
  const fuel = norm(getSpec(variant, 'Fuel Type')), gear = transmission(getSpec(variant, 'Transmission Type'));
  const excluded = { otherVehicle: 0, differentGeneration: 0, differentPowertrain: 0, tooFar: 0 };
  let candidates = market.data.filter(row => {
    if (norm(row.make) !== norm(input.make) || norm(cleanModel(row.model)) !== norm(cleanModel(input.model))) { excluded.otherVehicle++; return false; }
    // Exact generation label prevents mixing new and old platforms or facelifts when both have specific year brackets
    if (vehicle && vehicle.name && norm(row.model) !== norm(vehicle.name)) {
      const vBracket = String(vehicle.name).match(/\[(\d{4})(?:-(\d{4}))?\]/);
      const rBracket = String(row.model).match(/\[(\d{4})(?:-(\d{4}))?\]/);
      if (vBracket && rBracket && norm(vehicle.name) !== norm(row.model)) {
        excluded.differentGeneration++;
        return false;
      }
    }
    if (!fuel || !gear || norm(row.fuel) !== fuel || transmission(row.transmission) !== gear) { excluded.differentPowertrain++; return false; }
    if (Math.abs(row.year - input.year) > 2 || Math.abs(row.distanceKm - input.distanceKm) > Math.max(40000, input.distanceKm * 0.6)) { excluded.tooFar++; return false; }
    return true;
  }).map(row => {
    const sameTrim = trimMatch(variant, row, input.make, input.model);
    const distance = Math.abs(row.year - input.year) / 2 + Math.abs(row.distanceKm - input.distanceKm) / 40000 + (sameTrim ? 0 : 0.8) + (row.owners !== null && row.owners !== input.owners ? 0.25 : 0) + (input.city && norm(input.city) !== norm(row.city) ? 0.25 : 0);
    return { ...row, sameTrim, distance, weight: 1 / (1 + distance) };
  });
  const exactTrim = candidates.filter(r => r.sameTrim);
  const scope = exactTrim.length >= 3 ? 'same_variant' : 'same_generation_mixed_variants';
  if (scope === 'same_variant') candidates = exactTrim;
  const neighbours = candidates.sort((a, b) => a.distance - b.distance).slice(0, 12);
  const required = scope === 'same_variant' ? 3 : 5;
  const metadata = { method: 'Weighted comparable-listing median', priceType: 'Advertised asking price, not a confirmed sale price', scope, fetchedAt: market.fetchedAt, source: market.source, scanned: market.data.length, matched: candidates.length, used: neighbours.length, excluded, comparableRules: 'Up to four source pages. Same make, model, generation, fuel and transmission; within 2 years and the mileage window. Year, mileage, trim, owner count and city rank neighbours. No arbitrary brand base price or feature premiums.' };
  const evidence = neighbours.map(({ weight, distance, ...row }) => row);
  metadata.pagesFetched = market.pagesFetched;
  metadata.partial = market.partial || false;
  if (market.partial) metadata.comparableRules += ' Some continuation pages were unavailable; only successfully fetched listings were considered.';
  if (neighbours.length < required) return { status: 'insufficient_data', estimatedPrice: null, range: null, reason: `Only ${neighbours.length} suitable listings were found; at least ${required} are needed for this comparison. A specialist appraisal or more local listings is needed.`, evidence, ...metadata };
  const low = weightedQuantile(neighbours, .2), high = weightedQuantile(neighbours, .8);
  if (high / low > 1.8) return { status: 'insufficient_data', estimatedPrice: null, range: null, reason: 'Comparable asking prices vary too widely to support a useful estimate.', evidence, ...metadata };
  return { status: 'estimated', currency: 'INR', estimatedPrice: Math.round(weightedQuantile(neighbours, .5) / 1000) * 1000, range: { low, high, label: 'Middle 60% of weighted comparable asking prices; not a confidence interval' }, reason: scope === 'same_variant' ? 'Based on matching trim listings.' : 'Comparable listings include other trims; the exact equipment premium is not established.', evidence, ...metadata };
}
function featureProfile(variant, peers, source, fetchedAt) {
  const absent = value => /^(no|none|0|not available|not applicable|not tested|na|n\/a|-|--)?$/i.test(value.trim());
  const equipment = variant.equipment.filter(s => !absent(s.value)).map(s => {
    const differences = peers.filter(p => p.id !== variant.id).flatMap(p => { const other = p.equipment.find(o => o.name === s.name); return other && other.value !== s.value ? [{ variant: p.name, value: other.value }] : []; });
    const value = s.value === '1' && /alloy|keyless|start/i.test(s.name) ? 'Yes' : s.value;
    return { ...s, value, differentiates: differences.length > 0, comparedWith: differences.slice(0, 3) };
  });
  return { equipment, highlights: equipment.filter(s => s.differentiates).slice(0, 8), specifications: variant.specs, source, fetchedAt, coverage: 'Source-listed factory specification for this variant. Optional equipment, modifications and actual vehicle condition require inspection. Differences are versus other source-listed variants, not uniqueness across all cars. No separate rupee premium is assigned to a feature.' };
}
module.exports = { priceVehicle, featureProfile, weightedQuantile, trimMatch, getSpec };
