# CarValue — equipment-aware market valuation

A local full-stack university project for identifying an Indian-market vehicle, retrieving its year-specific variant specifications, and estimating its advertised market value from comparable used-car listings.

## Run

Requires Node.js 20 or newer. No npm dependencies or API keys are needed for the application.

```sh
npm start
```

Open http://127.0.0.1:8787/ — the backend serves the complete frontend and API on the same origin. The existing development preview on port 4173 forwards `/api/` requests to this backend. Internet access is needed to retrieve source data not already in the cache.

```sh
npm test
```

## User flow

1. Search brand and model, then select manufacture year.
2. The backend resolves the source generation and returns year-matched variants. Choose the variant printed on the invoice. No manual equipment checklist is used.
3. Enter distance driven, ownership count and optionally city.
4. The backend retrieves variant equipment and up to four pages of current source listings.
5. A separate `valuation.html?id=...` page shows either a supported asking-price estimate or an explicit coverage limitation, plus source-listed equipment, variant differences, and comparable listing links.

Reports survive page refresh and expire after 24 hours or a server restart. A browser-session draft preserves the vehicle form for the Edit link. There is no login, user profile, or permanent valuation-history database.

## What the algorithm does

The old shared ₹9 lakh starting price, depreciation multipliers, per-feature markup and offline fixed-price fallback have been removed.

The current implementation is a **weighted comparable-listing median**, not a trained transaction-price ML model. It requires the same make, model, generation, fuel and transmission. It ranks listings by year, mileage, trim, owner count and city, then uses up to 12 closest neighbours. At least three matching-trim listings, or five same-generation mixed-trim listings, are required. Wide dispersion also suppresses the estimate. [Full method and limitations](docs/METHODOLOGY.md).

Features are descriptions from the selected variant’s specification record. Highlights have documented differences versus other retrieved variants in the same generation/year. The application does not claim a feature is unique across the whole market and does not invent a monetary premium for it.

## API

| Route | Purpose |
| --- | --- |
| `GET /api/health` | Service status, source and pricing basis |
| `GET /api/vehicle?make=Maruti+Suzuki&model=Swift&year=2020` | Fetch matching variant IDs and automatically sourced powertrain labels |
| `POST /api/predict` | Validate a selected variant or manual trim, fetch equipment/comparables, compare listings and create a report |
| `GET /api/valuations/:id` | Retrieve a report for the separate results page |

Example request using catalog variant ID (returned by `/api/vehicle`):

```json
{
  "make": "Maruti Suzuki",
  "model": "Swift",
  "year": 2020,
  "variantId": "6399",
  "distanceKm": 45000,
  "owners": 1,
  "city": "Pune"
}
```

Example request using manual trim (when catalog variants are unavailable or manually entered):

```json
{
  "make": "Honda",
  "model": "City",
  "year": 2018,
  "trim": "VX",
  "fuel": "Petrol",
  "transmission": "Manual",
  "distanceKm": 45000,
  "owners": 1,
  "city": "Delhi"
}
```

`equipment` from the client is rejected. Fuel and transmission are either derived from server-fetched variant data or supplied via manual trim mode. Unknown variants, mismatched years, invalid bodies and excessive body size are rejected. The API never returns a fictional sample on failure.

## Structure

```text
dist/                  Search form, report page, styles, catalog and artwork
backend/server.js      HTTP routes, validation, report lifecycle and static serving
backend/vehicles.js    Brand/model matching and generation/variant resolution
backend/source.js      Source adapters, safe JSON parsing, pagination and cache
backend/valuation.js   Comparable selection, weighted median and feature differences
backend/test/          Deterministic regression and HTTP tests
backend/data/cache/    Generated sanitized source cache, excluded from Git
docs/METHODOLOGY.md     Method, evidence requirements and research limitations
```

## Data and provenance

The local catalog contains 693 source-listed nameplates across 49 brands from CarWale India pages, retrieved on 2026-09-09. Generations are grouped by the source root name. The catalog is not an exhaustive Indian registration database; it includes some imports, legacy entries and source inconsistencies. Catalog inclusion does not mean usable specification or pricing data exists.

Specification lookup uses source make/model records and their previous-generation links, with year bounds from the source. A curated local fallback dataset supplies verified trims and core specifications when a public model page does not expose a usable versions list; live source data remains preferred. A boundary year can contain several versions; the user must select the correct one. Unknown years and optional or modified equipment are not inferred. Reports display source URLs and retrieval times.

Market data consists of **advertised asking prices**, not completed sale prices. The source’s own valuation fields are not used. The application retains only relevant vehicle facts and listing URLs, not seller names, phone numbers, street addresses, reviews or dealer contacts. Specifications are cached for 24 hours and listings for one hour. If continuation pages time out, any estimate uses only successfully retrieved listings and records the partial coverage.

The studio car is generated illustrative artwork, not an image of the selected vehicle.

## Verification

Twelve automated backend tests cover make/model isolation (including the Bentley regression), generation and fuel filtering, minimum evidence, dispersion, feature absence, variant mismatch, year windows, malformed payloads, body size, CORS, and custom trim valuation. Frontend simulation additionally checks variant lookup, dependency reset, automatically populated powertrain labels, removal of equipment checkboxes, report rendering and insufficient-data states. Browser screenshot/interaction QA was not performed.

An optional feature-detected WebMCP tool, `create_vehicle_valuation`, shares the submit action. Its contract was checked in a simulated registry, not a browser with native WebMCP support.

## Research relationship

Inspired by Bergmann & Feuerriegel, *Machine learning for predicting used car resale prices using granular vehicle equipment information*, Expert Systems with Applications (2025), https://doi.org/10.1016/j.eswa.2024.125640.

This project does not reproduce the paper’s private dataset, trained model, or reported accuracy improvement. A future research phase needs licensed transaction prices joined to exact variants and equipment, a chronological train/test split, comparison with a no-equipment baseline, and MAE/RMSE results before claiming ML accuracy.
