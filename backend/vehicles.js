'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { AppError, norm, inYear, modelUrl, getMake, getModel } = require('./source');
const { getFallback } = require('./data/variant-fallbacks');
const text = fs.readFileSync(path.join(__dirname, '../dist/catalog.js'), 'utf8');
const catalog = JSON.parse(text.slice(text.indexOf('=') + 1).trim().replace(/;$/, ''));
function canonical(make, model) {
  const brand = catalog.brands.find(b => norm(b.name) === norm(make));
  const car = brand?.models.find(m => norm(m.name) === norm(model));
  if (!brand || !car) throw new AppError('UNKNOWN_VEHICLE', 'Select a brand and model from the vehicle catalog.');
  return { brand, car };
}
async function resolveVehicle(make, model, year) {
  const { brand, car } = canonical(make, model);
  const local = getFallback(brand.name, car.name, year);
  let root;
  try { root = await getMake(brand.source); }
  catch (error) { if (local) return local; return { make: brand.name, model: car.name, year, choices: [], reason: 'Online catalog lookup timed out or is temporarily unavailable. You can enter your trim manually.', source: brand.source }; }
  const targetNorm = norm(car.name);
  const starts = root.data.filter(m => {
    const n = norm(m.rootName || m.name.replace(/\s*\[[^\]]*\]/g, '').replace(/^Old Generation\s+/i, ''));
    return n === targetNorm || (n.includes(targetNorm) && !n.includes('hybrid') && !n.includes('electric') && !n.includes('active') && !n.includes('nline'));
  });
  const seen = new Set(), choices = [];
  let oldest = null;
  for (let m of starts) {
    for (let step = 0; m && step < 8; step++) {
      if (seen.has(m.id)) break; seen.add(m.id);
      const url = modelUrl(m);
      let record;
      try { record = await getModel(url); } catch { break; }
      const page = record?.data;
      if (!page) break;
      oldest = page.model;
      if (inYear({ ...page.model, modelName: page.model.name }, year)) {
        for (const variant of page.versions.filter(v => inYear(v, year))) {
          if (!choices.some(c => c.variant.id === variant.id)) choices.push({ variant, peers: page.versions.filter(v => inYear(v, year)), model: page.model, source: url, fetchedAt: record.fetchedAt });
        }
      }
      const prior = page.previous;
      if (!prior || (choices.length && !inYear({ ...prior, modelName: prior.name }, year))) break;
      m = prior;
    }
  }
  if (choices.length) return { make: brand.name, model: car.name, year, choices, reason: null, source: brand.source };
  if (local) return local;
  return { make: brand.name, model: car.name, year, choices, reason: 'No year-matched variant specifications are available from this source. You can enter your trim manually.', source: brand.source };
}
function publicVehicle(v) { return { make: v.make, model: v.model, year: v.year, status: v.choices.length ? 'available' : 'unavailable', reason: v.reason, source: v.source, variants: v.choices.map(c => ({ id: c.variant.id, name: c.variant.name, generation: c.model.name, source: c.source, featureCount: c.variant.equipment.length, fuel: c.variant.specs.find(s => s.name === 'Fuel Type')?.value || null, transmission: c.variant.specs.find(s => s.name === 'Transmission Type')?.value || null })) }; }
module.exports = { resolveVehicle, publicVehicle, canonical };
