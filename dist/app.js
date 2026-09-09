'use strict';
const API_BASE = location.protocol === 'file:' ? 'http://127.0.0.1:8787' : '';
const catalog = window.CAR_CATALOG || { brands: [] };
const $ = id => document.getElementById(id);
const form = $('vehicle-form'), make = $('make'), model = $('model'), year = $('year');
const variant = $('variant'), customTrim = $('custom-trim');
const variantSelectWrap = $('variant-select-wrap'), variantManualWrap = $('variant-manual-wrap');
const manualPowertrain = $('manual-powertrain');
const manualFuel = $('manual-fuel'), manualTransmission = $('manual-transmission');
const toggleManual = $('toggle-manual-trim'), toggleCatalog = $('toggle-catalog-trim');
const norm = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const aliases = { vw: 'volkswagen', maruti: 'marutisuzuki', suzuki: 'marutisuzuki', benz: 'mercedesbenz', mercedes: 'mercedesbenz', chevy: 'chevrolet', hm: 'hindustanmotors', reva: 'mahindra' };
const brand = () => catalog.brands.find(b => norm(b.name) === (aliases[norm(make.value)] || norm(make.value)));
const car = () => brand()?.models.find(m => norm(m.name) === norm(model.value));
let identity = '', lookupKey = '', lookupState = 'idle', lookupResult = null, lookupAbort = null, predictAbort = null, revision = 0, timer = null, isManualTrim = false;

$('catalog-total').textContent = catalog.brands.reduce((n, b) => n + b.models.length, 0).toLocaleString('en-IN');
$('catalog-heading').textContent = `${catalog.brands.length} brands. Find your make and model.`;
$('catalog-about').textContent = `Catalog snapshot: ${catalog.retrievedAt || 'unavailable'}. Source: CarWale India. Name coverage does not guarantee specification or resale-listing coverage. You can select an official catalog trim or type your trim manually.`;

year.add(new Option('Select year', ''));
for (let y = new Date().getFullYear(); y >= 1950; y--) year.add(new Option(String(y), String(y)));

function setManualMode(manual) {
  isManualTrim = manual;
  if (variantSelectWrap) variantSelectWrap.hidden = manual;
  if (variantManualWrap) variantManualWrap.hidden = !manual;
  if (manualPowertrain) manualPowertrain.hidden = !manual;
  if (toggleCatalog) toggleCatalog.hidden = !manual || !(lookupResult?.variants?.length);
  if (manual) {
    variant.required = false;
    customTrim.required = true;
    $('fuel-summary').textContent = manualFuel.value;
    $('gear-summary').textContent = manualTransmission.value;
    $('powertrain').hidden = false;
    lookupState = 'ready';
  } else {
    customTrim.required = false;
    variant.required = !!(lookupResult?.variants?.length);
    updateVariant();
  }
  snapshot();
}

if (toggleManual) toggleManual.addEventListener('click', () => setManualMode(true));
if (toggleCatalog) toggleCatalog.addEventListener('click', () => setManualMode(false));
customTrim.addEventListener('input', () => { changed(); snapshot(); saveDraft(); });
manualFuel.addEventListener('change', () => { $('fuel-summary').textContent = manualFuel.value; changed(); saveDraft(); });
manualTransmission.addEventListener('change', () => { $('gear-summary').textContent = manualTransmission.value; changed(); saveDraft(); });

function validate() {
  make.setCustomValidity(brand() ? '' : 'Choose a listed brand.');
  model.setCustomValidity(car() ? '' : 'Choose a listed model for this brand.');
}

function snapshot() {
  validate();
  $('vehicle-name').textContent = car() ? `${brand().name} ${car().name}` : 'Your next chapter starts here.';
  $('snapshot-year').textContent = year.value || 'Year —';
  $('snapshot-distance').textContent = $('distance').value !== '' && $('distance').validity.valid ? `${Number($('distance').value).toLocaleString('en-IN')} km` : 'Distance —';
  $('submit').disabled = !!predictAbort || !['ready', 'unavailable'].includes(lookupState);
}

function clearLookup() {
  clearTimeout(timer);
  lookupAbort?.abort();
  lookupAbort = null;
  lookupResult = null;
  lookupKey = '';
  lookupState = 'idle';
  isManualTrim = false;
  if (variantSelectWrap) variantSelectWrap.hidden = false;
  if (variantManualWrap) variantManualWrap.hidden = true;
  if (manualPowertrain) manualPowertrain.hidden = true;
  customTrim.value = '';
  customTrim.required = false;
  variant.replaceChildren(new Option('Choose brand, model and year', ''));
  variant.disabled = true;
  variant.required = true;
  $('powertrain').hidden = true;
  $('retry-lookup').hidden = true;
  $('lookup-status').textContent = 'Choose the year to find matching variants, or enter your trim manually.';
  snapshot();
}

function changed() {
  revision++;
  predictAbort?.abort();
  predictAbort = null;
  $('submit').innerHTML = 'View valuation <span aria-hidden="true">↗</span>';
  $('form-error').hidden = true;
  snapshot();
}

function saveDraft() {
  try {
    sessionStorage.setItem('carvalue-vehicle', JSON.stringify({
      make: make.value,
      model: model.value,
      year: year.value,
      variant: variant.value,
      isManualTrim,
      customTrim: customTrim.value,
      fuel: manualFuel.value,
      transmission: manualTransmission.value,
      distance: $('distance').value,
      owners: $('owners').value,
      city: $('city').value
    }));
  } catch {}
}

function chooseBrand() {
  const b = brand();
  if (b) make.value = b.name;
  const key = b?.name || '';
  if (key !== identity) {
    identity = key;
    model.value = '';
    clearLookup();
  }
  model.disabled = !b;
  model.placeholder = b ? 'Search a model' : 'Choose a brand first';
  $('catalog-source').href = b?.source || 'https://www.carwale.com/';
  changed();
  scheduleLookup();
}

function combo(input, list, getOptions, pick) {
  let options = [], active = -1;
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const choose = i => {
    if (!options[i]) return;
    input.value = options[i].name;
    pick();
    close();
  };
  const open = () => {
    if (input.disabled) return;
    const q = norm(input.value);
    options = getOptions().filter(o => norm(o.name).includes(q) || norm(o.name) === (aliases[q] || q));
    active = -1;
    input.removeAttribute('aria-activedescendant');
    list.replaceChildren();
    options.forEach((o, i) => {
      const li = document.createElement('li');
      li.id = `${input.id}-option-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.append(document.createTextNode(o.name));
      const small = document.createElement('small');
      small.textContent = o.note || '';
      li.append(small);
      li.addEventListener('pointerdown', e => {
        e.preventDefault();
        choose(i);
      });
      list.append(li);
    });
    if (!options.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No catalog match. Try another spelling.';
      list.append(li);
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  input.addEventListener('input', () => { pick(false); open(); });
  input.addEventListener('blur', () => { close(); pick(); });
  input.addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      if (list.hidden) open();
      if (options.length) {
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
        input.setAttribute('aria-activedescendant', list.children[active].id);
        list.children[active].scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'Enter' && !list.hidden && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape' || e.key === 'Tab') close();
  });
  return { close };
}

const makeCombo = combo(make, $('make-options'), () => catalog.brands.map(b => ({ name: b.name, note: `${b.models.length} models` })), chooseBrand);
const modelCombo = combo(model, $('model-options'), () => brand()?.models.map(m => ({ name: m.name, note: m.status === 'Discontinued' ? 'Discontinued' : '' })) || [], canonical => {
  if (canonical !== false && car()) model.value = car().name;
  changed();
  scheduleLookup();
});

function scheduleLookup() {
  const key = brand() && car() && year.value ? `${brand().name}|${car().name}|${year.value}` : '';
  if (key && key === lookupKey) return;
  clearLookup();
  if (!key) return;
  lookupKey = key;
  timer = setTimeout(() => loadVariants(), 250);
}

async function loadVariants(restoreVariant) {
  const key = lookupKey;
  if (!key) return;
  lookupAbort?.abort();
  const abort = new AbortController();
  lookupAbort = abort;
  lookupState = 'loading';
  variant.replaceChildren(new Option('Fetching matching variants…', ''));
  $('lookup-status').textContent = 'Looking up the correct generation and its factory specifications…';
  $('retry-lookup').hidden = true;
  snapshot();
  try {
    const params = new URLSearchParams({ make: brand().name, model: car().name, year: year.value });
    const response = await fetch(`${API_BASE}/api/vehicle?${params}`, { signal: abort.signal });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'Vehicle lookup failed.');
    if (abort.signal.aborted || lookupKey !== key) return;
    lookupResult = data;
    if (data.variants && data.variants.length > 0) {
      variant.replaceChildren(new Option('Select your exact variant', ''));
      for (const v of data.variants) {
        variant.add(new Option(`${v.name} · ${v.generation}`, v.id));
      }
      variant.add(new Option('+ Other / enter trim manually…', 'custom'));
      variant.disabled = false;
      variant.required = true;
      lookupState = 'ready';
      if (restoreVariant) {
        if (data.variants.some(v => v.id === restoreVariant)) {
          variant.value = restoreVariant;
          setManualMode(false);
        } else if (restoreVariant === 'custom') {
          setManualMode(true);
        }
      } else if (!isManualTrim) {
        setManualMode(false);
      }
      $('lookup-status').textContent = `${data.variants.length} year-matched variants found. Select the one on your invoice or enter manually.`;
      if (data.source) $('catalog-source').href = data.source;
      updateVariant();
    } else {
      setManualMode(true);
      lookupState = 'ready';
      $('lookup-status').textContent = data.reason || 'Factory catalog has no verified trim list for this year. Enter your trim name and powertrain below.';
      if (data.source) $('catalog-source').href = data.source;
    }
  } catch (error) {
    if (abort.signal.aborted) return;
    setManualMode(true);
    lookupState = 'ready';
    $('lookup-status').textContent = 'Online specifications lookup is currently unreachable. Enter your trim and powertrain below.';
    $('retry-lookup').hidden = false;
  } finally {
    if (lookupAbort === abort) lookupAbort = null;
    snapshot();
  }
}

function updateVariant() {
  if (isManualTrim) return;
  const selected = lookupResult?.variants.find(v => v.id === variant.value);
  $('powertrain').hidden = !selected;
  if (selected) {
    $('fuel-summary').textContent = selected.fuel || 'Fuel not recorded';
    $('gear-summary').textContent = selected.transmission || 'Transmission not recorded';
  }
  snapshot();
}

year.addEventListener('change', () => { changed(); scheduleLookup(); });
variant.addEventListener('change', () => {
  if (variant.value === 'custom') {
    setManualMode(true);
    customTrim.focus();
  } else {
    changed();
    updateVariant();
  }
  saveDraft();
});
$('retry-lookup').addEventListener('click', () => loadVariants());
form.addEventListener('input', () => { changed(); saveDraft(); });
form.addEventListener('change', () => { changed(); saveDraft(); });

async function submitVehicle() {
  validate();
  if (!form.reportValidity()) return null;
  if (isManualTrim) {
    if (!customTrim.value.trim()) {
      customTrim.reportValidity();
      return null;
    }
  } else {
    if (lookupState === 'ready' && !variant.value) {
      variant.reportValidity();
      return null;
    }
  }
  saveDraft();
  const payload = {
    make: brand().name,
    model: car().name,
    year: Number(year.value),
    distanceKm: Number($('distance').value),
    owners: Number($('owners').value),
    city: $('city').value.trim()
  };
  if (isManualTrim) {
    payload.trim = customTrim.value.trim();
    payload.fuel = manualFuel.value;
    payload.transmission = manualTransmission.value;
  } else if (variant.value) {
    payload.variantId = variant.value;
  }
  const token = revision, abort = new AbortController();
  predictAbort?.abort();
  predictAbort = abort;
  $('submit').disabled = true;
  $('submit').textContent = 'Building your valuation…';
  $('form-error').hidden = true;
  try {
    const response = await fetch(`${API_BASE}/api/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: abort.signal
    });
    const report = await response.json();
    if (!response.ok) throw Error(report.error || 'Valuation failed.');
    if (abort.signal.aborted || token !== revision) return null;
    window.location.assign(`valuation.html?id=${encodeURIComponent(report.id)}`);
    return { reportId: report.id, status: report.valuation.status };
  } catch (error) {
    if (!abort.signal.aborted) {
      $('form-error').textContent = error.message;
      $('form-error').hidden = false;
    }
    return null;
  } finally {
    if (predictAbort === abort) {
      predictAbort = null;
      $('submit').innerHTML = 'View valuation <span aria-hidden="true">↗</span>';
      snapshot();
    }
  }
}

form.addEventListener('submit', e => { e.preventDefault(); submitVehicle(); });
$('reset').addEventListener('click', () => {
  changed();
  form.reset();
  identity = '';
  makeCombo.close();
  modelCombo.close();
  model.disabled = true;
  clearLookup();
  try { sessionStorage.removeItem('carvalue-vehicle'); } catch {}
  snapshot();
});

try {
  const draft = JSON.parse(sessionStorage.getItem('carvalue-vehicle') || 'null');
  if (draft) {
    make.value = draft.make || '';
    chooseBrand();
    model.value = draft.model || '';
    year.value = draft.year || '';
    for (const id of ['distance', 'owners', 'city']) $(id).value = draft[id] || '';
    if (draft.fuel && manualFuel) manualFuel.value = draft.fuel;
    if (draft.transmission && manualTransmission) manualTransmission.value = draft.transmission;
    if (draft.customTrim && customTrim) customTrim.value = draft.customTrim;
    scheduleLookup();
    clearTimeout(timer);
    loadVariants(draft.isManualTrim ? 'custom' : draft.variant);
  }
} catch {}
snapshot();

if (document.modelContext?.registerTool) {
  const life = new AbortController();
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'create_vehicle_valuation',
      description: 'Create a source-backed market comparison report for the completed form and open its separate results page. May return insufficient-data status; never fabricates prices.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false },
      async execute(input) {
        if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).length) throw Error('Expected an empty object.');
        const result = await submitVehicle();
        if (!result) throw Error('Complete the form or resolve the displayed error.');
        return result;
      }
    }, { signal: life.signal })).catch(() => {});
  } catch {}
  window.addEventListener('pagehide', () => life.abort(), { once: true });
}
