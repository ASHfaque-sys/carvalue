'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const CACHE_DIR = path.join(__dirname, 'data', 'cache');
const inflight = new Map();
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
class AppError extends Error { constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; } }

function parseState(html) {
  const marker = /window\.__INITIAL_STATE__\s*=\s*/g.exec(html);
  if (!marker) throw new AppError('SOURCE_SCHEMA_CHANGED', 'The specification source is temporarily unavailable.', 502);
  const start = marker.index + marker[0].length;
  if (html[start] !== '{') throw new AppError('SOURCE_SCHEMA_CHANGED', 'Specification data could not be read.', 502);
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new AppError('SOURCE_SCHEMA_CHANGED', 'Specification data is incomplete.', 502);
}

async function fetchHtml(url) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://www.carwale.com') throw new AppError('INVALID_SOURCE', 'Invalid data source.', 400);
  let response;
  try { response = await fetch(url, { signal: AbortSignal.timeout(18000), redirect: 'manual', headers: { 'Accept': 'text/html' } }); }
  catch { throw new AppError('SOURCE_UNAVAILABLE', 'The vehicle data source could not be reached. Please try again.', 503); }
  // Never follow a model-specific search redirect to unrelated general listings.
  if (response.status >= 300 && response.status < 400) return null;
  if (response.status === 404) return null;
  if (!response.ok) throw new AppError('SOURCE_UNAVAILABLE', 'The vehicle data source is temporarily unavailable.', 503);
  const chunks = []; let bytes = 0;
  try { for await (const chunk of response.body) { bytes += chunk.length; if (bytes > 8 * 1024 * 1024) throw new AppError('SOURCE_TOO_LARGE', 'The source response is too large.', 502); chunks.push(chunk); } }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError('SOURCE_UNAVAILABLE', 'The data source timed out while returning vehicle information. Please retry.', 503); }
  return Buffer.concat(chunks).toString('utf8');
}

async function cached(key, ttl, load) {
  if (inflight.has(key)) return inflight.get(key);
  const run = (async () => {
    const file = path.join(CACHE_DIR, crypto.createHash('sha256').update(key).digest('hex') + '.json');
    try { const stored = JSON.parse(await fs.readFile(file, 'utf8')); if (Date.now() - Date.parse(stored.fetchedAt) < ttl) return stored; } catch {}
    const data = await load(); const record = { fetchedAt: new Date().toISOString(), data };
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const temp = file + '.tmp'; await fs.writeFile(temp, JSON.stringify(record)); await fs.rename(temp, file);
    return record;
  })();
  inflight.set(key, run);
  try { return await run; } finally { inflight.delete(key); }
}
function yearFromDate(value) { const match = String(value || '').match(/(?:^|\/)(\d{4})\b/); return match ? Number(match[1]) : null; }
function yearRange(row) {
  const years = String(row.modelName || row.versionName || '').match(/\[(\d{4})(?:-(\d{4}))?\]/);
  return { from: yearFromDate(row.launchedOn) || (years ? Number(years[1]) : null), to: yearFromDate(row.discontinuedOn) || (years ? Number(years[2] || years[1]) : null) };
}
const inYear = (row, year) => { const range = yearRange(row); return range.from !== null && year >= range.from && (range.to === null || year <= range.to); };
function cleanModel(m) { return { id: m.modelId, name: m.modelName, rootName: m.rootName, slug: m.modelMaskingName, rootSlug: m.rootMaskingName, makeSlug: m.makeMaskingName, make: m.makeName, launchedOn: m.launchedOn, discontinuedOn: m.discontinuedOn, modelName: m.modelName, status: m.status }; }
function cleanSpecs(rows) { return (rows || []).filter(s => s.itemName && s.value != null).map(s => ({ name: s.itemName, value: String(s.value).replace(/<[^>]*>/g, '').trim(), unit: s.unitType || '' })); }
function cleanVersion(v) { return { id: String(v.versionId), name: v.versionName, trim: v.trimName || v.versionName.replace(/\s*\[.*?\]/g, ''), slug: v.versionMaskingName, launchedOn: v.launchedOn, discontinuedOn: v.discontinuedOn, versionName: v.versionName, specs: cleanSpecs(v.specsSummary), equipment: cleanSpecs(v.featureSpecs) }; }

async function getMake(source) {
  return cached('make-v2:' + source, 86400000, async () => {
    const html = await fetchHtml(source); if (!html) return [];
    const p = parseState(html).makePage; if (!p) throw new AppError('SOURCE_SCHEMA_CHANGED', 'Make details were not available.', 502);
    return [...(p.models || []), ...(p.discontinuedModels || [])].filter(m => [2, 3].includes(m.status)).map(cleanModel);
  });
}
async function getModel(source) {
  return cached('model-v2:' + source, 86400000, async () => {
    const html = await fetchHtml(source); if (!html) return null;
    const p = parseState(html).modelPage; if (!p?.modelDetails) return null;
    return { model: cleanModel(p.modelDetails), previous: p.replacedModelDetails?.modelId ? cleanModel(p.replacedModelDetails) : null, versions: (p.versions || []).map(cleanVersion) };
  });
}
function modelUrl(m) {
  if (!/^[a-z0-9-]+$/.test(m.makeSlug || '') || !/^[a-z0-9-]+$/.test(m.slug || '')) throw new AppError('INVALID_SOURCE', 'A specification link is missing.', 502);
  return `https://www.carwale.com/${m.makeSlug}-cars/${m.slug}/`;
}

function parseListings(html) {
  const cars = [];
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (value['@type'] === 'Car') { cars.push(value); return; }
    Object.values(value).forEach(walk);
  }
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(match[1])); } catch {}
  }
  const seen = new Set();
  return cars.flatMap(car => {
    const price = Number(car.offers?.price), year = Number(car.vehicleModelDate || car.modelDate), mileage = Number(car.mileageFromOdometer?.value);
    if (car.offers?.priceCurrency !== 'INR' || !Number.isFinite(price) || price <= 0 || !Number.isInteger(year) || !Number.isFinite(mileage) || mileage < 0 || !car.url || seen.has(car.url)) return [];
    try { if (new URL(car.url).origin !== 'https://www.carwale.com') return []; } catch { return []; }
    seen.add(car.url);
    const owner = String(car.numberOfPreviousOwners || '');
    return [{ make: car.Brand?.name || car.brand?.name || '', model: car.model || '', year, distanceKm: mileage, fuel: car.fuelType || '', transmission: car.vehicleTransmission || '', owners: /first|^1$/i.test(owner) ? 1 : /second|^2$/i.test(owner) ? 2 : /third|^3$/i.test(owner) ? 3 : null, price, city: car.location?.address?.addressLocality || '', title: car.disambiguatingDescription || car.name || '', url: car.url }];
  });
}
async function getListings(makeSlug, modelSlug) {
  if (!/^[a-z0-9-]+$/.test(makeSlug || '') || !/^[a-z0-9-]+$/.test(modelSlug || '')) throw new AppError('MISSING_MARKET_SOURCE', 'No model-specific market search is available.');
  const source = `https://www.carwale.com/used/${makeSlug}-${modelSlug}/`;
  // Keep the cache namespace compatible with the earlier collector so a temporary
  // source outage can still use recently collected comparable listings.
  const record = await cached('listings-v4:' + source, 3600000, async () => {
    const html = await fetchHtml(source); if (!html) return { rows: [], pagesFetched: 0, partial: false };
    let search = parseSearch(html);
    const rows = search ? cleanStocks(search.stocks) : parseListings(html), seen = new Set(rows.map(r => r.url));
    let pagesFetched = 1, partial = false;
    for (let page = 2; page <= 4; page++) {
      // Use only the public continuation URL actually returned by the source.
      const next = search?.nextPageUrl;
      if (typeof next !== 'string' || !next.startsWith('/api/stocks/?')) break;
      let body;
      try { body = await fetchHtml('https://www.carwale.com' + next); } catch (error) { if (!(error instanceof AppError)) throw error; partial = true; break; }
      if (!body) break;
      try { search = JSON.parse(body); } catch { throw new AppError('SOURCE_SCHEMA_CHANGED', 'Market data could not be read.', 502); }
      const fresh = cleanStocks(search.stocks).filter(row => !seen.has(row.url));
      if (!fresh.length) break;
      fresh.forEach(row => { seen.add(row.url); rows.push(row); });
      pagesFetched++;
    }
    return { rows, pagesFetched, partial };
  });
  // Support cache files produced by the first collector version, which stored
  // the rows directly instead of wrapping them with pagination metadata.
  const stored = Array.isArray(record.data) ? { rows: record.data, pagesFetched: 1, partial: false } : record.data;
  return { fetchedAt: record.fetchedAt, data: stored.rows || [], pagesFetched: stored.pagesFetched || 1, partial: Boolean(stored.partial), source };
}
function parseSearch(html) {
  function find(value) {
    if (!value || typeof value !== 'object') return null;
    if (value.usedSearch && Array.isArray(value.usedSearch.stocks)) return value.usedSearch;
    for (const nested of Object.values(value)) { const match = find(nested); if (match) return match; }
    return null;
  }
  for (const match of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    let payload; try { payload = JSON.parse(match[1])[1]; } catch { continue; }
    if (typeof payload !== 'string') continue;
    for (const line of payload.split('\n')) {
      try { const result = find(JSON.parse(line.slice(line.indexOf(':') + 1))); if (result) return result; } catch {}
    }
  }
  return null;
}
function cleanStocks(stocks) {
  if (!Array.isArray(stocks)) return [];
  return stocks.flatMap(stock => {
    const price = Number(stock.priceNumeric), year = Number(stock.makeYear), distanceKm = Number(stock.kmNumeric);
    if (!(price > 0) || !Number.isFinite(price) || !Number.isInteger(year) || !Number.isFinite(distanceKm) || distanceKm < 0 || stock.isSimilarStockListing) return [];
    let url; try { url = new URL(stock.url, 'https://www.carwale.com'); if (url.origin !== 'https://www.carwale.com' || !url.pathname.startsWith('/used/')) return []; } catch { return []; }
    return [{ make: stock.makeName, model: stock.modelName, modelId: String(stock.modelId || ''), variantId: String(stock.versionId || ''), trimName: stock.trimName || '', year, distanceKm, fuel: stock.fuel, transmission: stock.transmission, owners: [1, 2, 3].includes(stock.ownersId) ? stock.ownersId : null, price, city: stock.cityName || '', title: `${year} ${stock.carName}`, url: url.href }];
  });
}
module.exports = { AppError, norm, parseState, parseListings, parseSearch, cleanStocks, yearRange, inYear, modelUrl, getMake, getModel, getListings };
