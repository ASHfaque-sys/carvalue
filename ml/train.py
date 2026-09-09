"""
CarValue — XGBoost price prediction model
Trains on a synthetic Indian used-car dataset derived from real market
price ranges per brand/segment, then exports the model + feature metadata
as JSON for use by the Node.js backend.
"""

import json, math, random, os
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.preprocessing import LabelEncoder
import xgboost as xgb

random.seed(42)
np.random.seed(42)

# ── Dataset ──────────────────────────────────────────────────────────────────
# Base prices (₹) for brand segments. Each car is then adjusted by year,
# km, fuel, transmission and owners to produce a realistic asking price.

BRANDS = {
    "Maruti Suzuki": {"segment": "budget",   "base": 850_000,   "models": ["Swift","Alto","Baleno","Dzire","Wagon R","Celerio","Ignis","Ertiga","Vitara Brezza","S-Cross"]},
    "Hyundai":       {"segment": "mid",      "base": 1_150_000, "models": ["i10","i20","Creta","Verna","Venue","Tucson","Aura","Santro"]},
    "Honda":         {"segment": "mid",      "base": 1_350_000, "models": ["City","Amaze","Jazz","WR-V","CR-V","HR-V"]},
    "Tata":          {"segment": "mid",      "base": 1_100_000, "models": ["Nexon","Harrier","Altroz","Tiago","Tigor","Safari","Punch"]},
    "Mahindra":      {"segment": "mid",      "base": 1_300_000, "models": ["XUV500","XUV300","Scorpio","Bolero","Thar","KUV100"]},
    "Toyota":        {"segment": "premium",  "base": 2_100_000, "models": ["Innova","Fortuner","Camry","Glanza","Urban Cruiser","Yaris"]},
    "Kia":           {"segment": "mid",      "base": 1_350_000, "models": ["Seltos","Sonet","Carnival","Carens"]},
    "Skoda":         {"segment": "premium",  "base": 1_900_000, "models": ["Octavia","Superb","Kushaq","Slavia","Kodiaq"]},
    "Volkswagen":    {"segment": "premium",  "base": 1_850_000, "models": ["Polo","Vento","Taigun","Tiguan","Virtus"]},
    "Ford":          {"segment": "mid",      "base": 1_150_000, "models": ["EcoSport","Endeavour","Figo","Freestyle","Aspire"]},
    "Renault":       {"segment": "budget",   "base": 800_000,   "models": ["Kwid","Duster","Triber","Kiger"]},
    "Nissan":        {"segment": "budget",   "base": 900_000,   "models": ["Magnite","Kicks","Terrano"]},
    "MG":            {"segment": "premium",  "base": 2_000_000, "models": ["Hector","ZS EV","Astor","Gloster"]},
    "Jeep":          {"segment": "luxury",   "base": 3_200_000, "models": ["Compass","Wrangler","Meridian"]},
    "BMW":           {"segment": "luxury",   "base": 5_500_000, "models": ["3 Series","5 Series","X1","X3","X5"]},
    "Mercedes-Benz": {"segment": "luxury",   "base": 6_200_000, "models": ["C-Class","E-Class","GLA","GLC","S-Class"]},
    "Audi":          {"segment": "luxury",   "base": 5_800_000, "models": ["A4","A6","Q3","Q5","Q7"]},
}

FUEL_MULT   = {"Petrol": 1.0, "Diesel": 1.08, "CNG": 0.88, "Electric": 1.25}
TRANS_MULT  = {"Manual": 1.0, "Automatic": 1.12, "Automatic (AMT)": 1.05}
OWNER_MULT  = {1: 1.0, 2: 0.88, 3: 0.78}
CURRENT_YEAR = 2026

def gen_price(base, year, km, fuel, transmission, owners):
    age   = CURRENT_YEAR - year
    # Realistic Indian automotive residual curve: ~7-8% depreciation per year + mileage decay
    dep   = max(0.18, math.exp(-0.075 * age) * (1.0 - 0.0000008 * min(km, 200000)))
    price = base * dep * FUEL_MULT[fuel] * TRANS_MULT[transmission] * OWNER_MULT.get(owners, 0.72)
    noise = random.gauss(1.0, 0.06)
    return max(100_000, round(price * noise, -3))

rows = []
for brand, info in BRANDS.items():
    n = 600 if info["segment"] in ("budget","mid") else 200
    for _ in range(n):
        model        = random.choice(info["models"])
        year         = random.randint(2010, 2024)
        km           = int(random.gauss(60_000, 35_000))
        km           = max(500, min(250_000, km))
        fuel         = random.choices(["Petrol","Diesel","CNG"], weights=[60,35,5])[0]
        transmission = random.choices(["Manual","Automatic","Automatic (AMT)"], weights=[65,25,10])[0]
        owners       = random.choices([1,2,3], weights=[55,35,10])[0]
        price        = gen_price(info["base"], year, km, fuel, transmission, owners)
        rows.append(dict(brand=brand, model=model, year=year, km=km,
                         fuel=fuel, transmission=transmission, owners=owners,
                         segment=info["segment"], price=price))

df = pd.DataFrame(rows)
print(f"Dataset: {len(df)} rows  |  price range INR {df.price.min():,.0f} - INR {df.price.max():,.0f}")

# ── Feature engineering ───────────────────────────────────────────────────────
df["age"]     = CURRENT_YEAR - df["year"]
df["km_log"]  = np.log1p(df["km"])

le_brand = LabelEncoder().fit(df["brand"])
le_fuel  = LabelEncoder().fit(df["fuel"])
le_trans = LabelEncoder().fit(df["transmission"])
le_seg   = LabelEncoder().fit(df["segment"])

df["brand_enc"] = le_brand.transform(df["brand"])
df["fuel_enc"]  = le_fuel.transform(df["fuel"])
df["trans_enc"] = le_trans.transform(df["transmission"])
df["seg_enc"]   = le_seg.transform(df["segment"])

FEATURES = ["age","km_log","fuel_enc","trans_enc","owners","brand_enc","seg_enc"]
X = df[FEATURES]
y = df["price"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# ── Train ─────────────────────────────────────────────────────────────────────
model = xgb.XGBRegressor(
    n_estimators=400,
    max_depth=6,
    learning_rate=0.05,
    subsample=0.8,
    colsample_bytree=0.8,
    random_state=42,
    verbosity=0,
)
model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

# ── Evaluate ──────────────────────────────────────────────────────────────────
preds = model.predict(X_test)
mae   = mean_absolute_error(y_test, preds)
rmse  = math.sqrt(mean_squared_error(y_test, preds))
r2    = r2_score(y_test, preds)
print(f"MAE  : INR {mae:,.0f}")
print(f"RMSE : INR {rmse:,.0f}")
print(f"R²   : {r2:.4f}")

# Feature importance
imp = dict(zip(FEATURES, model.feature_importances_.tolist()))
print("\nFeature importance:")
for k,v in sorted(imp.items(), key=lambda x:-x[1]):
    print(f"  {k:15s} {v:.4f}")

# ── Export ────────────────────────────────────────────────────────────────────
out_dir = os.path.join(os.path.dirname(__file__))
model.save_model(os.path.join(out_dir, "model.ubj"))

meta = {
    "features":    FEATURES,
    "current_year": CURRENT_YEAR,
    "brands":      le_brand.classes_.tolist(),
    "fuels":       le_fuel.classes_.tolist(),
    "transmissions": le_trans.classes_.tolist(),
    "segments":    le_seg.classes_.tolist(),
    "brand_segments": {b: v["segment"] for b,v in BRANDS.items()},
    "metrics": {"mae": round(mae), "rmse": round(rmse), "r2": round(r2,4), "test_rows": len(y_test)},
}
with open(os.path.join(out_dir, "meta.json"), "w") as f:
    json.dump(meta, f, indent=2)

print(f"\nModel saved → ml/model.ubj")
print(f"Meta  saved → ml/meta.json")
