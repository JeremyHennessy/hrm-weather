# Weather Consensus v1.0

A feels-like-first, locally calibrated weather PWA for **HRM Core**, **Moncton**, and **Shediac**.

Permanent app URL: `https://jeremyhennessy.github.io/hrm-weather/`

## HRM definition

The HRM Core headline remains the equal-location view of:

- Halifax Peninsula
- Bedford
- Dartmouth

Clayton Park, Lower Sackville, and Eastern Passage are shown as microclimate context and do **not** change the HRM Core headline.

## Forecast stack

The app combines multiple deterministic model products including Canadian GEM/HRDPS, ECMWF, GFS, ICON, UKMO, Météo-France, JMA, KMA, BOM and CMA products when available. Failed providers degrade gracefully rather than blocking the forecast.

`Feels Like` is the primary user-facing metric. The app also includes precipitation probability/amount, model wet/dry agreement, UV, gusts, sunrise/sunset, ECCC alerts, nearby observations, radar-extrapolation nowcast attempts, ensemble uncertainty, and a model scorecard.

## Calibration

Calibration has three layers:

1. **Official-now correction** — nearby ECCC hourly observations help correct current model consensus.
2. **Historical browser backtest** — archived previous model runs can be compared with ECCC observations and stored locally on the device.
3. **Continuous shared learning** — `.github/workflows/collect-weather.yml` runs hourly, records +3h/+6h/+12h/+24h model forecasts, verifies matured forecasts against ECCC observations, and updates `data/skill.json`.

Model combination applies learned warm/cold bias before weighting. Lead-specific MAE is preferred; the `all` fallback is a sample-weighted aggregate across lead times rather than the final lead processed.

## Automation

### `collect-weather.yml`

Runs hourly and can also be started manually. It executes `scripts/collect.py`, then commits changed `data/skill.json` and `data/ledger.json` back to the repository.

### `validate.yml`

Runs on pushes and pull requests. It checks JavaScript syntax, Python syntax, JSON validity, and key app references.

## PWA / iPhone

Open the permanent URL in Safari and choose **Share → Add to Home Screen**. The manifest starts at the root URL and the service worker uses network-first refresh behavior for application files. Live weather APIs and shared calibration JSON are not frozen in the offline cache.

## Data / safety

This is an experimental statistical post-processing and forecast-consensus project. It is **not** an official hazardous-weather service. Environment Canada warnings and alerts remain authoritative for severe-weather decisions.
