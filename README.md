# CarValue — ML-powered used car valuation

A local full-stack project for the Indian used car market. It identifies a vehicle, fetches its year-specific variant specifications from CarWale, estimates its market value using **two independent engines** — a live comparable-listing median and a trained XGBoost ML model — and presents both on a single report page.

## Run

Requires **Node.js 20+** and **Python 3.10+**. No external API keys needed.

```sh
npm start
```

Open **http://127.0.0.1:8787/** — the backend serves the frontend and API on the same origin.

```sh
npm test       # 12 backend tests
```

**Python dependencies** (for ML model):
```sh
pip install xgboost scikit-learn pandas numpy
```

To retrain the model from scratch:
```sh
python ml/train.py
```

## How it works

### 1 — Market Comparables (live)
Fetches current CarWale listings, filters by make/model/generation/fuel/transmission, ranks by year, mileage, trim, owner count and city similarity, and returns a **weighted median** of the closest matches. Requires at least 3 same-trim or 5 same-generation listings. No fictional fallback price is ever returned.

### 2 — XGBoost ML Model (trained)
A gradient-boosted regression model trained on **7,000 synthetic Indian market records** calibrated to real-world brand/segment pricing. It predicts resale price from:

| Feature | Description |
|---|---|
| Age | `2026 − year` |
| Mileage | Log-transformed km driven |
| Fuel type | Petrol / Diesel / CNG / Electric |
| Transmission | Manual / Automatic / AMT |
| Owners | 1 / 2 / 3+ |
| Brand | Encoded by brand identity |
| Segment | Budget / Mid / Premium / Luxury |

**Accuracy on held-out test set:**
- R² = **0.99**
- MAE ≈ **₹44,680**
- RMSE ≈ **₹78,171**

The ML estimate always returns a price even when live listings are unavailable.

## User flow

1. Search brand and model, select manufacture year.
2. Backend resolves the source generation and returns year-matched variants. Choose the variant from the invoice.
3. Enter distance driven, owner count and optionally city.
4. Backend fetches variant equipment and up to four pages of live listings.
5. The `valuation.html` report page shows **both**:
   - **Market Asking Price** — comparable-listing median
   - **ML Model Estimate** — XGBoost prediction with confidence level

## API

| Route | Purpose |
|---|---|
| `GET /api/health` | Service status and model info |
| `GET /api/vehicle?make=&model=&year=` | Fetch year-matched variant IDs |
| `POST /api/predict` | Create full valuation report |
| `GET /api/valuations/:id` | Retrieve report for results page |
| `POST /api/ml-predict` | XGBoost price prediction only |

**`/api/ml-predict` example:**
```json
{
  "make": "Honda",
  "year": 2018,
  "km": 45000,
  "fuel": "Petrol",
  "transmission": "Manual",
  "owners": 1
}
```
**Response:**
```json
{ "price": 723000, "confidence": "high" }
```

**`/api/predict` example (catalog variant):**
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

**`/api/predict` example (manual trim):**
```json
{
  "make": "Honda",
  "model": "City",
  "year": 2018,
  "trim": "VX",
  "fuel": "Petrol",
  "transmission": "Manual",
  "distanceKm": 45000,
  "owners": 1
}
```

## Structure

```text
dist/                  Search form, report page, styles, catalog
backend/server.js      HTTP routes, validation, ML inference, report lifecycle
backend/vehicles.js    Brand/model matching and variant resolution
backend/source.js      Source adapters, JSON parsing and cache
backend/valuation.js   Comparable selection, weighted median, feature diffs
backend/data/          Variant fallbacks and source cache
backend/test/          12 automated regression and HTTP tests
ml/train.py            XGBoost training script (7,000 rows, R²=0.99)
ml/predict.py          Inference script called by Node.js backend
ml/model.ubj           Trained XGBoost model binary
ml/meta.json           Feature encodings and model metadata
docs/METHODOLOGY.md    Full method, evidence requirements and limitations
```

## Data and provenance

The local catalog contains 693 source-listed nameplates across 49 brands from CarWale India, retrieved 2026-09-09. Market data consists of **advertised asking prices**, not completed sale prices. Specifications are cached for 24 hours, listings for one hour. The ML training dataset is synthetic but calibrated to real Indian market price ranges by brand and segment — it is not trained on actual transaction records.

## Verification

Twelve automated backend tests cover make/model isolation, generation and fuel filtering, minimum evidence, dispersion, feature absence, variant mismatch, year windows, malformed payloads, CORS and custom trim valuation. Frontend simulation checks variant lookup, dependency reset, powertrain auto-fill, report rendering and insufficient-data states.

## Research relationship

Inspired by Bergmann & Feuerriegel, *Machine learning for predicting used car resale prices using granular vehicle equipment information*, Expert Systems with Applications (2025), https://doi.org/10.1016/j.eswa.2024.125640.
