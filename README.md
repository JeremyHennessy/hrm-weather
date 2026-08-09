# Weather Consensus

A **Real Feel-first**, locally calibrated weather PWA for **HRM Core, Moncton, Shediac, Lunenburg, and the Wolfville area**.

Permanent app URL: `https://jeremyhennessy.github.io/hrm-weather/`

## Production source of truth

The live app has one production dependency path. Do not infer that a file is obsolete from its version-like filename alone.

- `app.html` — live application shell and ordered legacy core scripts.
- `startup-fallback.js` → `request-manager.js` → `v5b.js` → `v6-extra.js` → `v7-final.js` → `v8-ui.js` → `v11-layout.js` → `scene-images.js` — active browser startup chain.
- `scene-images.js` — **sole dynamic module bootstrap**. Critical UI/Engine modules must be imported here once only; do not add nested duplicate imports in other modules.
- `deep-ui.js` — deep-section styling/classes only; it must not bootstrap other modules.
- `accuracy-v2.js`, `accuracy-v3.js`, `atomic-render.js`, `daily-card-fix.js`, `forecast-confidence.js`, `forecast-ui-guard.js`, `uv-guidance.js`, `forecast-insights.js`, `weather-icons.js` — active production modules loaded by `scene-images.js`.
- `scripts/collect.py` — canonical server collector entry point. It installs ECCC/solar/Engine 3.1 adapters and runs Engine 2 then Engine 3.
- `data/engine-v3.json` — authoritative server forecast snapshot used by the browser when fresh.
- `data/skill.json`, `data/ledger.json`, `data/v3-verification.json`, `data/run-history-v2.json`, `data/model-set-state.json` — active learning/verification state.

One-off UI mutation workflows, temporary importers, superseded background SVGs, and experimental 90-day/multi-cycle backtests have been removed. The canonical retrospective model test is `.github/workflows/backtest-v3.yml`.

## Locations

- **HRM Core:** Halifax Peninsula + Bedford + Dartmouth. Clayton Park, Lower Sackville, and Eastern Passage remain microclimate context only.
- **Moncton:** downtown Moncton.
- **Shediac:** Shediac town centre.
- **Lunenburg:** Town of Lunenburg.
- **Wolfville Area:** equal-location view of Wolfville + New Minas + Kentville.

Coordinates for the new Nova Scotia locations are based on official Canadian Geographical Names Database place records.

## Forecast stack

The app combines multiple deterministic model products including Canadian GEM/HRDPS, ECMWF, GFS, ICON, UKMO, Météo-France, JMA, KMA, BOM and CMA products when available. Failed providers degrade gracefully rather than blocking the forecast.

**Real Feel** is the primary user-facing temperature metric. **Actual** is used consistently for air temperature. The app also includes precipitation probability/amount, model wet/dry agreement, UV, gusts, sunrise/sunset, ECCC alerts, nearby observations, radar-extrapolation nowcast attempts, ensemble uncertainty, and a model scorecard.

## Calibration

Calibration has four layers:

1. **Official-now correction** — nearby ECCC hourly observations help correct current model consensus.
2. **Historical browser backtest** — archived previous model runs can be compared with ECCC observations and stored locally on the device.
3. **Continuous shared learning** — `.github/workflows/collect-weather.yml` runs hourly, records +3h/+6h/+12h/+24h model forecasts, verifies matured forecasts against fresh ECCC observations, and updates `data/skill.json`.
4. **Short-lead archive bootstrap** — `.github/workflows/backfill-short.yml` uses Open-Meteo Single Runs to backfill exact +3h/+6h/+12h skill for major models and refreshes the shared calibration weekly.

The hourly learner averages the same forecast points used by multi-point headlines such as HRM Core and Wolfville Area. Model combination applies learned warm/cold bias before weighting. Lead-specific MAE is preferred; the `all` fallback is a sample-weighted aggregate across lead times.

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
- `backtest-v3.yml` — canonical retrospective Engine 3 ledger + 21-day archive test.
- `validate.yml` — syntax, JSON, and critical app-reference validation.
- `release-guard.yml` — release skill/startup safety checks.
- `screenshot-ui.yml` — deployed browser rendering and screenshot QA.
- `generate-icons.yml` — regenerates PNG PWA icons only when the source SVG changes or on manual dispatch.

## Data / safety

This is an experimental statistical post-processing and forecast-consensus project. It is **not** an official hazardous-weather service. Environment Canada warnings and alerts remain authoritative for severe-weather decisions.
