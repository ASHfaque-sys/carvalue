"""
CarValue ML inference — called by Node.js backend via child_process.
Usage: python predict.py '{"brand":"Honda","year":2018,"km":45000,"fuel":"Petrol","transmission":"Manual","owners":1}'
Prints a single JSON line: {"price": 720000, "confidence": "medium"}
"""

import sys, json, math, os
import numpy as np
import xgboost as xgb

BASE_DIR = os.path.dirname(__file__)

# Load model + meta once
model = xgb.XGBRegressor()
model.load_model(os.path.join(BASE_DIR, "model.ubj"))
with open(os.path.join(BASE_DIR, "meta.json")) as f:
    meta = json.load(f)

CURRENT_YEAR  = meta["current_year"]
brands        = meta["brands"]
fuels         = meta["fuels"]
transmissions = meta["transmissions"]
segments      = meta["segments"]
brand_segs    = meta["brand_segments"]

def encode(value, classes):
    try:
        return classes.index(value)
    except ValueError:
        return 0   # fallback to first class

def predict(inp):
    brand        = inp.get("brand", "Maruti Suzuki")
    year         = int(inp.get("year", 2018))
    km           = float(inp.get("km", 60000))
    fuel         = inp.get("fuel", "Petrol")
    transmission = inp.get("transmission", "Manual")
    owners       = int(inp.get("owners", 1))

    age     = CURRENT_YEAR - year
    km_log  = math.log1p(km)
    segment = brand_segs.get(brand, "mid")

    features = [[
        age,
        km_log,
        encode(fuel, fuels),
        encode(transmission, transmissions),
        owners,
        encode(brand, brands),
        encode(segment, segments),
    ]]

    price = float(model.predict(np.array(features))[0])
    price = max(50_000, round(price / 1000) * 1000)

    # Rough confidence based on brand familiarity
    known_brand = brand in brands
    confidence  = "high" if known_brand and 1 <= owners <= 2 else "medium"

    return {"price": int(price), "confidence": confidence}

if __name__ == "__main__":
    try:
        inp = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
        result = predict(inp)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
