# HRM Weather Consensus

Mobile-first multi-model weather consensus for Halifax Peninsula, Bedford and Dartmouth.

The app queries multiple numerical forecast products and calculates each HRM zone independently before creating an equal-zone HRM Core forecast. Large model outliers are softly down-weighted and unavailable feeds are excluded automatically.

## Models

The current web build attempts Open-Meteo Best Match, Environment Canada GEM, ECMWF IFS, NOAA GFS, DWD ICON, UK Met Office, Météo-France and JMA products where available.

## iPhone

This repository is designed for GitHub Pages. Once Pages is enabled for the `main` branch/root folder, open the Pages URL in Safari and choose **Share → Add to Home Screen**.

## Important

This is a forecast consensus experiment, not an official hazardous-weather warning service. Use Environment Canada alerts for severe weather decisions.
