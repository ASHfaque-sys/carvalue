'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { priceVehicle, featureProfile } = require('../valuation');
const { validateInput, createReport, createServer } = require('../server');
const { parseState, parseListings, inYear } = require('../source');
// Synthetic records for deterministic logic tests only; never served as market data.
const input = { make: 'Maruti Suzuki', model: 'Swift', year: 2020, distanceKm: 45000, owners: 1, variantId: '123' };
const model = { name: 'Swift [2018-2021]', makeSlug: 'maruti-suzuki', rootSlug: 'swift' };
const variant = { id: '123', name: 'VXi', trim: 'VXi', specs: [{ name: 'Fuel Type', value: 'Petrol' }, { name: 'Transmission Type', value: 'Manual' }], equipment: [{ name: 'Sunroof', value: 'No' }, { name: 'Parking Sensors', value: 'Rear' }] };
const rows = [500000, 550000, 600000].map((price, i) => ({ make: input.make, model: model.name, year: 2020, distanceKm: 45000, fuel: 'Petrol', transmission: 'Manual', owners: 1, price, title: '2020 Maruti Suzuki Swift VXi', variantId: '123', trimName: 'VXi', city: 'Pune', url: `https://www.carwale.com/used/test/${i}/` }));
const market = data => ({ data, fetchedAt: '2026-09-09T12:00:00Z', source: 'https://www.carwale.com/used/maruti-suzuki-swift/' });
test('matching vehicle and trim derives its estimate from comparable prices', () => { const r = priceVehicle(input, model, variant, market(rows)); assert.equal(r.status, 'estimated'); assert.equal(r.estimatedPrice, 550000); assert.equal(r.scope, 'same_variant'); });
test('Bentley cannot inherit Swift prices', () => { const r = priceVehicle({ ...input, make: 'Bentley', model: 'Azure' }, { name: 'Azure' }, variant, market(rows)); assert.equal(r.estimatedPrice, null); assert.equal(r.used, 0); });
test('mismatched generations and fuel never enter comparison', () => { const r = priceVehicle(input, model, variant, market([...rows.map(r => ({ ...r, model: 'Swift [2021-2024]' })), ...rows.map(r => ({ ...r, fuel: 'Diesel' }))])); assert.equal(r.used, 0); });
test('thin evidence and excessive dispersion withhold a numeric price', () => { assert.equal(priceVehicle(input, model, variant, market(rows.slice(0, 2))).estimatedPrice, null); assert.equal(priceVehicle(input, model, variant, market(rows.map((r, i) => ({ ...r, price: [100000, 550000, 1900000][i] })))).estimatedPrice, null); });
test('feature absence stays absent and highlights have comparison evidence', () => { const other = { id: '124', name: 'LXi', equipment: [{ name: 'Parking Sensors', value: 'No' }] }; const r = featureProfile(variant, [variant, other], 'https://www.carwale.com/', '2026-09-09'); assert.equal(r.equipment.length, 1); assert.equal(r.highlights[0].name, 'Parking Sensors'); assert.equal(r.highlights[0].comparedWith[0].value, 'No'); });
test('source state parser never executes script and handles braces in strings', () => { assert.deepEqual(parseState('<script>window.__INITIAL_STATE__ = {"a":"}","b":{}};evil()</script>'), { a: '}', b: {} }); assert.throws(() => parseState('<html>no state</html>')); });
test('generation windows include boundary years without assigning future data', () => { const row = { launchedOn: '02/08/2018 00:00:00', discontinuedOn: '02/24/2021 00:00:00' }; assert(inYear(row, 2020)); assert(inYear(row, 2021)); assert(!inYear(row, 2017)); assert(!inYear(row, 2022)); });
test('validation rejects malformed JSON shapes, negative mileage, future years and client features', () => { for (const value of [null, [], { ...input, distanceKm: -1 }, { ...input, year: 3000 }, { ...input, equipment: ['Sunroof'] }]) assert.throws(() => validateInput(value)); assert.equal(validateInput({ ...input, distanceKm: 0 }).distanceKm, 0); });
test('report refuses a variant belonging to another selection', async () => { const resolver = async () => ({ make: input.make, model: input.model, choices: [{ variant, model, peers: [variant] }] }); await assert.rejects(createReport({ ...input, variantId: '999' }, { resolveVehicle: resolver }), /exact variant/); });
test('missing specifications produces no made-up price or features', async () => { const r = await createReport(input, { resolveVehicle: async () => ({ make: input.make, model: input.model, choices: [], reason: 'No coverage' }) }).catch(e => e); assert.equal(r.code, 'INVALID_VARIANT'); const v = await createReport({ ...input, variantId: undefined }, { resolveVehicle: async () => ({ make: 'Bentley', model: 'Azure', choices: [], reason: 'No coverage' }) }); assert.equal(v.valuation.estimatedPrice, null); assert.equal(v.features.equipment.length, 0); });
test('HTTP API handles health, invalid inputs, CORS and oversized bodies', async () => {
 const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
 try {
  assert.equal((await (await fetch(base + '/api/health')).json()).trainedModel, false);
  for (const [body, expected] of [['null', 400], ['{', 400], [JSON.stringify({ ...input, equipment: [] }), 422], [JSON.stringify({ padding: 'x'.repeat(20000) }), 413]]) { const r = await fetch(base + '/api/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }); assert.equal(r.status, expected); }
  assert.equal((await fetch(base + '/api/health', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/valuations/missing')).status, 404);
 } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('custom trim and manual powertrain produces valid valuation report', async () => {
  const customInput = { make: input.make, model: input.model, year: 2020, distanceKm: 45000, owners: 1, trim: 'VXi', fuel: 'Petrol', transmission: 'Manual' };
  const resolver = async () => ({ make: input.make, model: input.model, choices: [] });
  const marketFetcher = async () => market(rows);
  const rep = await createReport(customInput, { resolveVehicle: resolver, getListings: marketFetcher });
  assert.equal(rep.vehicle.variant, 'VXi');
  assert.equal(rep.vehicle.isCustomTrim, true);
  assert.equal(rep.valuation.status, 'estimated');
  assert.equal(rep.valuation.estimatedPrice, 550000);
});
