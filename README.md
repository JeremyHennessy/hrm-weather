# Weather Consensus

A **Real Feel-first**, locally calibrated weather PWA for **HRM Core, Moncton, Shediac, Lunenburg, and the Wolfville area**.

Permanent app URL: `https://jeremyhennessy.github.io/hrm-weather/`

## Locations

- **HRM Core:** Halifax Peninsula + Bedford + Dartmouth. Clayton Park, Lower Sackville, and Eastern Passage remain microclimate context only.
- **Moncton:** downtown Moncton.
- **Shediac:** Shediac town centre.
- **Lunenburg:** Town of Lunenburg.
- **Wolfville Area:** equal-location view of Wolfville + New Minas + Kentville.

## Forecast stack

The app combines multiple deterministic model products including Canadian GEM/HRDPS, ECMWF, GFS, ICON, UKMO, Météo-France, JMA, KMA, BOM and CMA products when available. Failed providers degrade gracefully rather than blocking the forecast.

**Real Feel** is the primary user-facing temperature metric. **Actual** is used consistently for air temperature. The app also includes precipitation probability/amount, model wet/dry agreement, UV, gusts, sunrise/sunset, ECCC alerts, nearby observations, radar-extrapolation nowcast attempts, ensemble uncertainty, and a model scorecard.

## Calibration

Calibration has four layers:

1. **Official-now correction** — nearby ECCC hourly observations help correct current model consensus.
2. **Historical browser backtest** — archived previous model runs can be compared with ECCC observations and stored locally on the device.
3. **Continuous shared learning** — `.github/workflows/collect-weather.yml` runs hourly, records +3h/+6h/+12h/+24h model forecasts, verifies matured forecasts against fresh ECCC observations, and updates `data/skill.json`.
4. **Short-lead archive bootstrap** — `.github/workflows/backfill-short.yml` uses Open-Meteo Single Runs to backfill exact +3h/+6h/+12h skill for major models and refreshes the shared calibration weekly.

The hourly learner now averages the same forecast points used by multi-point headlines such as HRM Core and Wolfville Area. Model combination applies learned warm/cold bias before weighting. Lead-specific MAE is preferred; the `all` fallback is a sample-weighted aggregate across lead times.

## UI screenshot QA

`.github/workflows/screenshot-ui.yml` opens the **deployed GitHub Pages app** in Chromium at an iPhone-sized viewport and captures:

- `screenshots/live-iphone.png` — full mobile UI
- `screenshots/hero-share-card.png` — compact weather card suitable for sharing/posts
- `screenshots/live-desktop.png` — desktop QA view
- `screenshots/report.json` — console errors and terminology checks

The capture fails if old user-facing temperature terminology such as `Feels Like`, `feels-like`, or `FEELS HIGH` leaks back into the live UI.

## PWA / iPhone

The permanent root URL redirects to stable `app.html`. A generated landscape/weather Home Screen icon is supplied as an Apple touch icon, with a scalable SVG version for the web manifest. The service worker uses network-first refresh behaviour for application files while weather APIs and shared calibration JSON bypass the offline cache.

Open the permanent URL in Safari and choose **Share → Add to Home Screen**.

## Automation

- `collect-weather.yml` — hourly shared learner; stale observations are rejected.
- `backfill-short.yml` — weekly short-range historical skill refresh, also triggered when the backfill code changes.
- `validate.yml` — syntax, JSON, and critical app-reference validation.
- `screenshot-ui.yml` — deployed browser rendering and screenshot QA.

## Data / safety

This is an experimental statistical post-processing and forecast-consensus project. It is **not** an official hazardous-weather service. Environment Canada warnings and alerts remain authoritative for severe-weather decisions.
