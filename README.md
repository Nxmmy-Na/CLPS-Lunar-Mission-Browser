# CLPS Lunar Mission Browser

A 3D lunar browser for **Artemis III candidate landing regions** and **CLPS** (Commercial Lunar Payload Services) missions, plus a FastAPI backend for physics analysis (solar power, battery survival, ENU vectors, slope/TRI).

```
clps-lunar-browser/
├── frontend/
│   ├── index.html        # Layout: top KPI bar, site list, 3D viewer, sidebar + analysis dashboard
│   ├── style.css         # Dark space / mission-control theme
│   ├── app.js            # CesiumJS Moon globe, 3D pins, click -> sidebar, API calls, chart
│   ├── textures/moon_lroc_color_4k.jpg  # NASA LROC colour mosaic (equirectangular)
│   └── sites_data.json   # 9 Artemis III regions (+1 legacy) and CLPS landings (IM-1, IM-2, Blue Ghost M1)
├── backend/
│   ├── main.py           # FastAPI REST server (CORS enabled)
│   ├── physics.py        # Solar power, battery survival, ME->ENU, slope/TRI
│   └── requirements.txt
└── README.md
```

## Requirements

- Python 3.10+
- A modern browser with WebGL
- Internet access (CesiumJS and fonts load from CDNs)

## 1. Backend (FastAPI)

```bash
cd clps-lunar-browser/backend
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

- Interactive API docs: http://localhost:8000/docs
- Health check: http://localhost:8000/api/health
- The backend also serves the frontend, so http://localhost:8000 is the whole app.
  To share it on your network, run with `--host 0.0.0.0` and open `http://<your-ip>:8000`.

## 2. Frontend (static files)

The frontend has to be served over HTTP, not opened as `file://`, because `fetch("sites_data.json")` doesn't work from `file://`. In a second terminal:

```bash
cd clps-lunar-browser/frontend
python3 -m http.server 5500
```

Then open http://localhost:5500.

### Optional: real lunar terrain

By default, the Moon is a smooth sphere textured with the NASA LROC colour mosaic ([NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/), pole-corrected version, converted to a 4k JPG), with a faint lat/lon grid on top. That mode doesn't need an account. To show the high-resolution **Cesium Moon Terrain** 3D Tiles:

1. Create a free token at https://ion.cesium.com/tokens
2. Open `http://localhost:5500/?ion=YOUR_TOKEN`, or set `CESIUM_ION_TOKEN` in `app.js`

## API

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/sites` | All sites, read from `frontend/sites_data.json` |
| GET | `/api/sites/{site_id}` | One site |
| GET | `/api/site-analysis/{site_id}` | Solar power plus battery survival analysis |

Query parameters for `/api/site-analysis/{site_id}` (all optional):

| Param | Default | Meaning |
|---|---|---|
| `subsolar_lon_deg` | site longitude | Sun position (longitude of the subsolar point) |
| `subsolar_lat_deg` | 0 | Season (±1.54°) |
| `terrain_visibility` | 1.0 | Terrain shadowing factor, 0–1 |
| `panel_mode` | `tracking` | `tracking` or `fixed` |
| `panel_tilt_deg` / `panel_azimuth_deg` | 90 / 0 | Panel orientation |
| `panel_area_m2` / `panel_efficiency` | 2.0 / 0.28 | Solar panel |
| `battery_capacity_wh` | 2000 | Battery capacity |
| `base_power_w` / `heater_power_w` | 40 / 60 | Base load and heater load |
| `depth_of_discharge` | 0.8 | Usable fraction of battery capacity |
| `darkness_hours` | from site data | Darkness duration to plan for |

Example:

```bash
curl "http://localhost:8000/api/site-analysis/malapert-massif?panel_area_m2=4&battery_capacity_wh=8000"
```

## Physics formulas (`backend/physics.py`)

- **Solar power**: `P = S · A · η · max(0, ŝ·n̂) · V`, with S = 1361 W/m²
- **Battery survival**: `t = (C · DoD) / (P_base + P_heater)`
- **ME → ENU**: rotation matrix with rows East, North, Up at (lat, lon)
- **Solar disk visibility**: circular-segment fraction of the solar disk above a flat horizon (sun radius 0.267°)
- **Slope / TRI**: `slope = atan(|∇z|)`; TRI (Riley 1999) = √Σ(zᵢ − z₀)² over the 3×3 neighbourhood

## Data caveats

- Coordinates for the Artemis III regions are **approximate region centres**. Each real region is about 15×15 km.
- `sunlight_pct`, `dte_pct` and `max_darkness_hours` for the polar regions are **illustrative estimates**. Replace them with LOLA illumination and DTE data before using them for real analysis.
- The power profile in the API uses a **flat horizon**. Near the poles, terrain dominates illumination, so use the `terrain_visibility` parameter to account for it.
