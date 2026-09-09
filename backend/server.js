'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { AppError, getListings, norm } = require('./source');
const { resolveVehicle, publicVehicle, canonical } = require('./vehicles');
const { priceVehicle, featureProfile } = require('./valuation');
const reports = new Map();
const publicRoot = path.resolve(__dirname, '../dist');
const ML_PREDICT = path.resolve(__dirname, '../ml/predict.py');
const staticFiles = new Set(['index.html', 'valuation.html', 'styles.css', 'app.js', 'results.js', 'catalog.js', 'car-studio.webp']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp' };
function validateInput(input, full = true) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('INVALID_INPUT', 'A JSON object is required.', 400);
  for (const key of ['make', 'model']) if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 100) throw new AppError('INVALID_INPUT', `A valid ${key} is required.`);
  if (!Number.isInteger(input.year) || input.year < 1950 || input.year > new Date().getFullYear()) throw new AppError('INVALID_INPUT', 'Choose a valid manufacture year.');
  if (full) {
    if (!Number.isInteger(input.distanceKm) || input.distanceKm < 0 || input.distanceKm > 1000000) throw new AppError('INVALID_INPUT', 'Distance must be a whole number between 0 and 1,000,000 km.');
    if (!Number.isInteger(input.owners) || input.owners < 1 || input.owners > 3) throw new AppError('INVALID_INPUT', 'Ownership must be 1, 2, or 3.');
    if (input.city != null && (typeof input.city !== 'string' || input.city.length > 80)) throw new AppError('INVALID_INPUT', 'City must be under 80 characters.');
    if (input.variantId != null && (typeof input.variantId !== 'string' || !/^(?:\d{1,10}|custom)$/.test(input.variantId))) throw new AppError('INVALID_INPUT', 'Choose a valid variant.');
    if (input.trim != null && (typeof input.trim !== 'string' || input.trim.length > 80)) throw new AppError('INVALID_INPUT', 'Trim must be under 80 characters.');
    if (input.fuel != null && typeof input.fuel !== 'string') throw new AppError('INVALID_INPUT', 'Invalid fuel type.');
    if (input.transmission != null && typeof input.transmission !== 'string') throw new AppError('INVALID_INPUT', 'Invalid transmission type.');
    if ('equipment' in input) throw new AppError('SERVER_OWNED_FEATURES', 'Equipment is fetched from the selected variant; it cannot be supplied by the client.');
  }
  return input;
}
async function readBody(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new AppError('UNSUPPORTED_MEDIA', 'Use application/json.', 415);
  let length = 0; const chunks = [];
  for await (const chunk of req) { length += chunk.length; if (length > 16384) throw new AppError('BODY_TOO_LARGE', 'Request is too large.', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('INVALID_JSON', 'Request body must be valid JSON.', 400); }
}
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); }
async function createReport(input, dependencies = {}) {
  const resolve = dependencies.resolveVehicle || resolveVehicle;
  const fetchMarket = dependencies.getListings || getListings;
  const vehicle = await resolve(input.make, input.model, input.year);
  let selection = vehicle.choices.find(c => c.variant.id === input.variantId);
  if (vehicle.choices.length && input.variantId && input.variantId !== 'custom' && !selection) {
    throw new AppError('VARIANT_REQUIRED', 'Select the exact variant sold in this year.');
  }
  if (!vehicle.choices.length && input.variantId && input.variantId !== 'custom') {
    throw new AppError('INVALID_VARIANT', 'This variant is not available for the selected year.');
  }
  // Support custom / manual trim entry
  if ((!selection || input.variantId === 'custom') && typeof input.trim === 'string' && input.trim.trim()) {
    const trimName = input.trim.trim();
    const fuelVal = typeof input.fuel === 'string' && input.fuel.trim() ? input.fuel.trim() : 'Petrol';
    const transVal = typeof input.transmission === 'string' && input.transmission.trim() ? input.transmission.trim() : 'Manual';
    const customVariant = {
      id: 'custom',
      name: trimName,
      trim: trimName,
      specs: [
        { name: 'Fuel Type', value: fuelVal },
        { name: 'Transmission Type', value: transVal }
      ],
      equipment: []
    };
    const genModel = vehicle.choices[0]?.model || {
      name: vehicle.model,
      makeSlug: norm(vehicle.make),
      rootSlug: norm(vehicle.model)
    };
    selection = {
      variant: customVariant,
      peers: [],
      model: genModel,
      source: vehicle.source,
      fetchedAt: new Date().toISOString(),
      custom: true
    };
  }
  let market = { status: 'insufficient_data', estimatedPrice: null, range: null, evidence: [], reason: vehicle.reason, used: 0, scanned: 0 };
  let features = { equipment: [], highlights: [], specifications: [], source: vehicle.source, coverage: vehicle.reason };
  if (selection) {
    if (selection.custom) {
      features = {
        equipment: [],
        highlights: [],
        specifications: selection.variant.specs,
        source: vehicle.source,
        coverage: 'Manual trim entry. Comparable market listings are filtered by trim name, fuel, and transmission.'
      };
    } else {
      features = featureProfile(selection.variant, selection.peers, selection.source, selection.fetchedAt);
    }
    try {
      let makeSlug = selection.model?.makeSlug;
      let rootSlug = selection.model?.rootSlug;
      if (!makeSlug || !rootSlug) {
        try {
          const { brand, car } = canonical(vehicle.make, vehicle.model);
          makeSlug = makeSlug || brand?.slug || norm(brand?.name);
          rootSlug = rootSlug || car?.slug || norm(car?.name);
        } catch {
          makeSlug = makeSlug || norm(vehicle.make);
          rootSlug = rootSlug || norm(vehicle.model);
        }
      }
      const listings = await fetchMarket(makeSlug, rootSlug);
      market = priceVehicle({ ...input, make: vehicle.make, model: vehicle.model }, selection.model, selection.variant, listings);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      market = { ...market, status: 'source_unavailable', reason: error.message };
    }
  }
  const report = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    vehicle: {
      make: vehicle.make,
      model: vehicle.model,
      year: input.year,
      distanceKm: input.distanceKm,
      owners: input.owners,
      city: input.city || '',
      variant: selection?.variant.name || null,
      variantId: selection?.variant.id || null,
      generation: selection?.model.name || null,
      isCustomTrim: Boolean(selection?.custom)
    },
    features,
    valuation: market,
    modelVersion: 'market-comparables-1.0',
    isDemo: false,
    methodology: 'No trained sales-price model is available. Estimates are weighted medians of current source-listed asking prices. Equipment explains the selected variant; feature-specific rupee effects have not been learned or assigned.'
  };
  return report;
}
function mlPredict(payload) {
  return new Promise((resolve, reject) => {
    const arg = JSON.stringify(payload);
    const proc = spawn('python', [ML_PREDICT, arg], { env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    proc.on('close', code => {
      try { resolve(JSON.parse(out.trim())); }
      catch { reject(new Error(err.trim() || 'ML inference failed')); }
    });
    proc.on('error', reject);
    setTimeout(() => { proc.kill(); reject(new Error('ML inference timed out')); }, 8000);
  });
}
function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      const isAllowed = !origin || origin === 'null' || /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin);
      if (!isAllowed) return send(res, 403, { code: 'ORIGIN_DENIED', error: 'This local API accepts requests from the local CarValue frontend only.' });
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin === 'null' ? '*' : origin);
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); return res.end(); }
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { status: 'ok', service: 'carvalue-api', model: 'market-comparables-1.0', mlModel: 'xgboost-1.0', trainedModel: true, specificationSource: 'CarWale India', pricingBasis: 'Comparable asking prices + XGBoost ML estimate.' });
      if (req.method === 'POST' && url.pathname === '/api/ml-predict') {
        const body = await readBody(req);
        if (!body.make || !body.year || !body.km) throw new AppError('INVALID_INPUT', 'make, year and km are required.', 400);
        const result = await mlPredict({ brand: body.make, year: body.year, km: body.km, fuel: body.fuel || 'Petrol', transmission: body.transmission || 'Manual', owners: body.owners || 1 });
        if (result.error) throw new AppError('ML_ERROR', result.error, 500);
        return send(res, 200, result);
      }
      if (req.method === 'GET' && url.pathname === '/api/vehicle') { const input = validateInput({ make: url.searchParams.get('make'), model: url.searchParams.get('model'), year: Number(url.searchParams.get('year')) }, false); return send(res, 200, publicVehicle(await resolveVehicle(input.make, input.model, input.year))); }
      if (req.method === 'POST' && url.pathname === '/api/predict') {
        const input = validateInput(await readBody(req)); const report = await createReport(input);
        for (const [id, value] of reports) if (Date.parse(value.expiresAt) < Date.now()) reports.delete(id);
        while (reports.size >= 200) reports.delete(reports.keys().next().value);
        reports.set(report.id, report); return send(res, 200, report);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/valuations/')) {
        const report = reports.get(url.pathname.split('/').pop());
        if (!report || Date.parse(report.expiresAt) < Date.now()) throw new AppError('REPORT_NOT_FOUND', 'This report expired or the server restarted. Create a new valuation.', 404);
        return send(res, 200, report);
      }
      if (req.method === 'GET') {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (staticFiles.has(file)) { const content = await fs.readFile(path.join(publicRoot, file)); res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(content); }
      }
      return send(res, 404, { code: 'NOT_FOUND', error: 'Route not found.' });
    } catch (error) { if (!res.headersSent) send(res, error instanceof AppError ? error.status : 500, { code: error.code || 'INTERNAL_ERROR', error: error instanceof AppError ? error.message : 'The request could not be completed. Please try again.' }); }
  });
}
if (require.main === module) { const server = createServer(); server.requestTimeout = 60000; server.headersTimeout = 15000; server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => console.log(`CarValue app and API: http://127.0.0.1:${process.env.PORT || 8787}`)); }
module.exports = { createServer, createReport, validateInput };
