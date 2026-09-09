# Valuation methodology and model card

## Purpose and scope

Estimate the advertised asking-price level of a selected used vehicle using a small, current sample of similar source listings. The estimate is not a guaranteed sale price, dealer purchase offer, professional appraisal, insurance value, or a reproduction of the research paper.

The current method is a rule-defined similarity search and weighted median. Its coefficients are not fitted on historical transactions. There is no reported test-set accuracy, because a representative labeled transaction dataset has not been collected.

## Vehicle identity and features

The backend resolves brand + model + manufacture year against dated source generation records. It follows up to eight previous-generation links when needed. Source-listed variants are filtered by their launch/discontinuation years. Boundary years may offer more than one production-period version.

The user chooses a variant, not a list of features. Every request revalidates the variant against the selected vehicle/year. Fuel, transmission, specifications and equipment come from that variant. `No`, `None`, `0`, `Not available`, `Not tested` and empty feature values are excluded from the equipment list. Missing entries mean unknown, not absent.

Highlight features must have a different documented value in another retrieved variant. The report names comparison variants and values. It does not treat these differences as causal rupee contributions.

## Source sampling

Retrieve the model-specific public listing page and follow up to three public pagination URLs returned by that page/API. De-duplicate by listing URL; discard unrelated recommendation stocks, invalid prices, and invalid year/mileage records. Do not follow a redirect to a generic all-cars search. Keep source URLs and retrieval timestamps; cache results for one hour.

The sample is limited by source ranking and advertisements. Four pages do not constitute an unbiased full-market sample. Cache retrieval time is not proof of a listing’s original publication or sale date.

## Comparison rules

Candidates must have:

- the same make and model;
- the same source generation label;
- the same fuel and transmission category;
- a manufacture year within two years of the target;
- mileage within `max(40,000 km, 0.6 × target mileage)`.

For each candidate:

```text
distance = abs(year difference) / 2
         + abs(mileage difference) / 40,000
         + 0.8 if the trim differs
         + 0.25 if a recorded owner count differs
         + 0.25 if a supplied target city differs

weight = 1 / (1 + distance)
```

Trim matching uses source variant/trim identifiers when present, with a conservative textual fallback for structured schema listings. These are design choices, not statistically learned coefficients.

When at least three matching-trim candidates exist, use only that set. Otherwise the same-generation mixed-trim set needs at least five candidates. Use at most 12 closest listings. The point estimate is their weighted median asking price, rounded to ₹1,000. The displayed interval is the weighted 20th–80th percentile range, not a statistical confidence interval. If the upper percentile exceeds 1.8 times the lower percentile, withhold a price.

No depreciation formula extrapolates beyond the sample. No arbitrary luxury brand multiplier, original-price fallback, equipment-count bonus, or fixed offline fixture is used. More representative sales data may require different thresholds and a learned estimator.

## Failure behaviour

- Missing year/variant specifications: no inferred equipment, no price.
- Insufficient or excessively dispersed comparisons: evidence can be displayed, but no point estimate.
- Source unavailable: explicit error or partial-page coverage, no silent stale or sample-price replacement.
- Client submits equipment or a mismatched variant ID: validation error.
- Source markup changes: data adapter fails explicitly; update it before restoring coverage.

## Limitations

Asking prices may exceed eventual sale prices. Accident history, inspections, service records, insurance, registration restrictions, modifications and negotiation are not modeled. Geographic ranking is weak, owner counts can be missing, source specification records can be inaccurate, and luxury/rare models often have sparse evidence. Do not equate availability of a catalog name with valuation support.

## Path to a research-grade ML experiment

Collect licensed, timestamped sale records with make, model, generation, variant, year, mileage, location, owners, condition and actual transaction price. Join equipment using stable variant identifiers and retain unknown/missing values. Keep repeated listings/vehicles in the same split, and avoid features collected after the sale.

Use a chronological holdout, compare a median baseline and a vehicle-only model with a model that includes granular equipment, and report MAE, RMSE, coverage and errors by brand/price band. Evaluate rare luxury vehicles separately and allow the model to abstain outside supported coverage. Only then claim predictive accuracy or a measured equipment benefit.
