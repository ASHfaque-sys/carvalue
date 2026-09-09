'use strict';

// Curated India fallback records for models whose public source page does not
// expose a usable versions list. These records provide identification and
// equipment only; pricing still requires comparable used listings.
const fallbacks = [
  {
    make: 'Audi', model: 'e-tron GT', makeSlug: 'audi', rootSlug: 'e-tron-gt',
    generation: 'e-tron GT [2021-2024]', from: 2021, to: 2024,
    source: 'https://www.audi.in/en/models/e-tron-gt/e-tron-gt/',
    sourceLabel: 'Audi India / Audi MediaCenter',
    variants: [
      {
        id: '910001', name: 'e-tron GT quattro', trim: 'e-tron GT quattro',
        specs: [
          { name: 'Fuel Type', value: 'Electric', unit: '' },
          { name: 'Transmission Type', value: 'Automatic', unit: '' },
          { name: 'Drivetrain', value: 'quattro all-wheel drive', unit: '' },
          { name: 'Battery Capacity', value: '93.4', unit: 'kWh' },
          { name: 'Max Engine Power', value: '476', unit: 'PS (530 PS boost)' },
          { name: 'Max Engine Torque', value: '630', unit: 'Nm (640 Nm boost)' },
          { name: 'Seating Capacity', value: '5', unit: 'Person' }
        ],
        equipment: [
          { name: 'Drive system', value: 'Dual electric motors' },
          { name: 'All-wheel drive', value: 'quattro' },
          { name: 'Fast charging', value: 'DC charging supported' },
          { name: 'Launch control', value: 'Yes' }
        ]
      },
      {
        id: '910002', name: 'RS e-tron GT', trim: 'RS e-tron GT',
        specs: [
          { name: 'Fuel Type', value: 'Electric', unit: '' },
          { name: 'Transmission Type', value: 'Automatic', unit: '' },
          { name: 'Drivetrain', value: 'quattro all-wheel drive', unit: '' },
          { name: 'Battery Capacity', value: '93.4', unit: 'kWh' },
          { name: 'Max Engine Power', value: '598', unit: 'PS (646 PS boost)' },
          { name: 'Max Engine Torque', value: '830', unit: 'Nm' },
          { name: 'Seating Capacity', value: '5', unit: 'Person' }
        ],
        equipment: [
          { name: 'Drive system', value: 'Dual electric motors' },
          { name: 'All-wheel drive', value: 'quattro' },
          { name: 'Fast charging', value: 'DC charging supported' },
          { name: 'Launch control', value: 'Yes' },
          { name: 'RS performance character', value: 'Yes' }
        ]
      }
    ]
  }
];

const key = (make, model) => `${String(make).toLowerCase()}|${String(model).toLowerCase()}`;
function getFallback(make, model, year) {
  const row = fallbacks.find(item => key(item.make, item.model) === key(make, model) && year >= item.from && year <= item.to);
  if (!row) return null;
  const modelInfo = { id: `local-${row.makeSlug}-${row.rootSlug}`, name: row.generation, rootName: row.model, slug: row.rootSlug, rootSlug: row.rootSlug, makeSlug: row.makeSlug, make: row.make, launchedOn: `01/01/${row.from}`, discontinuedOn: `31/12/${row.to}` };
  const peers = row.variants.map(variant => ({ ...variant, id: String(variant.id), launchedOn: `01/01/${row.from}`, discontinuedOn: `31/12/${row.to}`, versionName: variant.name }));
  return { make: row.make, model: row.model, year, choices: peers.map(variant => ({ variant, peers, model: modelInfo, source: row.source, fetchedAt: '2026-09-09' })), reason: null, source: row.source, sourceLabel: row.sourceLabel, fallback: true };
}

module.exports = { getFallback };
