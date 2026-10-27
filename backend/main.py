"""
main.py - FastAPI REST server for the CLPS Lunar Mission Browser.

Run (from the backend/ folder):
    uvicorn main:app --reload --port 8000

The frontend is also served from / so a single port (or a single public
tunnel) exposes the whole app.

Endpoints
---------
GET /api/health                  : liveness check used by the frontend status light
GET /api/sites                   : all landing sites from frontend/sites_data.json
GET /api/sites/{site_id}         : a single site
GET /api/site-analysis/{site_id} : solar power + battery survival analysis
GET /api/sites/{site_id}/sky     : time-based Sun/Earth unit ENU vectors (JPL DE421 + lunar libration)
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Literal, Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import ephemeris
import physics

# The frontend's JSON is the single source of truth for site data.
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
DATA_FILE = FRONTEND_DIR / "sites_data.json"

app = FastAPI(
    title="CLPS Lunar Mission Browser API",
    version="0.1.0",
    description="Site catalogue and lunar surface power/thermal survival analysis.",
)

# Allow the static frontend (served from another port / origin) to call the API.
# Tighten allow_origins before deploying anywhere public.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# Load the ephemeris kernels ONCE at startup. If they are missing the app still
# starts (all other endpoints keep working) and /sky answers 503.
try:
    ephemeris.init()
except ephemeris.EphemerisUnavailable as exc:
    logging.getLogger("uvicorn.error").warning("Ephemeris disabled: %s", exc)

MAX_SKY_STEPS = 4000


# --- Data access -----------------------------------------------------------------
@lru_cache(maxsize=1)
def load_dataset() -> dict:
    """Read sites_data.json once and cache it for the life of the process."""
    with DATA_FILE.open(encoding="utf-8") as f:
        return json.load(f)


def get_site_or_404(site_id: str) -> dict:
    for site in load_dataset()["sites"]:
        if site["id"] == site_id:
            return site
    raise HTTPException(status_code=404, detail=f"Unknown site_id '{site_id}'")


# --- Routes ------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "sites_loaded": len(load_dataset()["sites"])}


@app.get("/api/sites")
def list_sites() -> dict:
    """Return every site plus the dataset metadata."""
    return load_dataset()


@app.get("/api/sites/{site_id}")
def get_site(site_id: str) -> dict:
    return get_site_or_404(site_id)


@app.get("/api/site-analysis/{site_id}")
def site_analysis(
    site_id: str,
    # Sun geometry
    subsolar_lon_deg: Optional[float] = Query(
        None, ge=-180, le=180,
        description="Subsolar longitude. Default = site longitude (local noon)."),
    subsolar_lat_deg: float = Query(
        0.0, ge=-physics.LUNAR_OBLIQUITY_DEG, le=physics.LUNAR_OBLIQUITY_DEG,
        description="Subsolar latitude (seasonal, within +/-1.54 deg)."),
    terrain_visibility: float = Query(
        1.0, ge=0, le=1,
        description="Extra shadowing factor from surrounding terrain (1 = unobstructed)."),
    # Solar array
    panel_mode: Literal["tracking", "fixed"] = Query(
        "tracking", description="'tracking' = vertical panel that follows the Sun's azimuth."),
    panel_tilt_deg: float = Query(90.0, ge=0, le=90),
    panel_azimuth_deg: float = Query(0.0, ge=0, lt=360),
    panel_area_m2: float = Query(2.0, gt=0, le=100),
    panel_efficiency: float = Query(0.28, gt=0, le=1),
    # Battery / loads
    battery_capacity_wh: float = Query(2000.0, ge=0),
    base_power_w: float = Query(40.0, ge=0),
    heater_power_w: float = Query(60.0, ge=0),
    depth_of_discharge: float = Query(0.8, gt=0, le=1),
    darkness_hours: Optional[float] = Query(
        None, ge=0, description="Override the site's max continuous darkness."),
) -> dict:
    """
    Solar power at the requested Sun geometry, a one-lunar-day power profile,
    and whether the battery survives the site's longest darkness period.
    """
    site = get_site_or_404(site_id)
    lat, lon = site["lat"], site["lon"]
    if subsolar_lon_deg is None:
        subsolar_lon_deg = lon

    def power_at(sub_lon: float) -> tuple[float, float, float]:
        """Return (power_w, sun_azimuth_deg, sun_elevation_deg) for one Sun position."""
        sun_enu = physics.me_to_enu(
            physics.subsolar_vector_me(subsolar_lat_deg, sub_lon), lat, lon)
        az, el = physics.enu_to_az_el(sun_enu)
        if panel_mode == "tracking":
            normal = physics.panel_normal_enu(panel_tilt_deg, az)
        else:
            normal = physics.panel_normal_enu(panel_tilt_deg, panel_azimuth_deg)
        visibility = physics.solar_disk_visibility(el) * terrain_visibility
        p = physics.calculate_solar_power(
            sun_enu, normal, panel_area_m2, panel_efficiency, visibility)
        return p, az, el

    # Instantaneous result at the requested geometry
    power_w, sun_az, sun_el = power_at(subsolar_lon_deg)

    # Power over one synodic month: sweep the subsolar longitude through 360 deg.
    # (Flat-horizon model; real polar sites are dominated by local topography.)
    n_steps = 72
    profile = []
    for i in range(n_steps + 1):
        sub_lon = ((subsolar_lon_deg - 360.0 * i / n_steps) + 180.0) % 360.0 - 180.0
        p, _, el = power_at(sub_lon)
        profile.append({
            "hour": round(physics.SYNODIC_MONTH_HOURS * i / n_steps, 2),
            "power_w": round(p, 2),
            "sun_elevation_deg": round(el, 3),
        })
    profile_mean_w = float(np.mean([pt["power_w"] for pt in profile]))

    # Battery survival through the longest darkness period
    survival_h = physics.calculate_battery_survival(
        battery_capacity_wh, base_power_w, heater_power_w, depth_of_discharge)
    dark_h = darkness_hours if darkness_hours is not None else site["max_darkness_hours"]
    required_wh = dark_h * (base_power_w + heater_power_w) / depth_of_discharge

    return {
        "site": {k: site[k] for k in ("id", "name", "lat", "lon", "category")},
        "inputs": {
            "subsolar_lat_deg": subsolar_lat_deg,
            "subsolar_lon_deg": subsolar_lon_deg,
            "terrain_visibility": terrain_visibility,
            "panel_mode": panel_mode,
            "panel_tilt_deg": panel_tilt_deg,
            "panel_azimuth_deg": panel_azimuth_deg,
            "panel_area_m2": panel_area_m2,
            "panel_efficiency": panel_efficiency,
            "battery_capacity_wh": battery_capacity_wh,
            "base_power_w": base_power_w,
            "heater_power_w": heater_power_w,
            "depth_of_discharge": depth_of_discharge,
        },
        "sun": {
            "azimuth_deg": round(sun_az, 2),
            "elevation_deg": round(sun_el, 3),
            "disk_visible_fraction": round(physics.solar_disk_visibility(sun_el), 3),
        },
        "power": {
            "instantaneous_w": round(power_w, 2),
            "net_w": round(power_w - base_power_w, 2),
            "flat_horizon_mean_w": round(profile_mean_w, 2),
            # Rough site-specific estimate: tracking-panel peak scaled by the
            # catalogue's average illumination fraction.
            "illumination_weighted_w": round(
                max(pt["power_w"] for pt in profile) * site["sunlight_pct"] / 100.0, 2),
        },
        "battery": {
            "survival_hours": round(survival_h, 2),
            "darkness_hours": dark_h,
            "survives": survival_h >= dark_h,
            "margin_hours": round(survival_h - dark_h, 2),
            "required_capacity_wh": round(required_wh, 1),
        },
        "profile": profile,
    }


@app.get("/api/sites/{site_id}/sky")
def site_sky(
    site_id: str,
    start: str = Query(..., description="ISO-8601 UTC start, e.g. 2026-11-01T00:00:00Z"),
    days: int = Query(30, ge=1, le=366),
    step_hours: int = Query(1, ge=1, le=24),
) -> dict:
    """
    Sun and Earth directions at the site vs UTC time, as unit ENU vectors
    [east, north, up] (interpolate these, not the angles), plus alt/az (deg)
    for display. Time of sample i = start + i * step_hours.
    Model: DE421 + NAIF MOON_ME_DE421 (Mean Earth / Polar Axis, incl. libration);
    centre directions only; no refraction. See ephemeris.py.
    """
    site = get_site_or_404(site_id)
    try:
        t0 = datetime.fromisoformat(start.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="start must be ISO-8601, e.g. 2026-11-01T00:00:00Z")
    if t0.tzinfo is None:
        t0 = t0.replace(tzinfo=timezone.utc)
    if days * 24 // step_hours + 1 > MAX_SKY_STEPS:
        raise HTTPException(status_code=400, detail=f"Too many steps (max {MAX_SKY_STEPS})")
    try:
        grid, sky = ephemeris.sky_over_period(site["lat"], site["lon"], t0, days, step_hours)
    except ephemeris.EphemerisUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    def pack(b: dict) -> dict:
        return {"enu": b["enu"].round(5).tolist(),
                "alt": b["alt"].round(3).tolist(),
                "az": b["az"].round(3).tolist()}

    return {
        "site": {k: site[k] for k in ("id", "lat", "lon")},
        "frame": "Moon Mean Earth/Polar Axis (MOON_ME_DE421), sphere R=1737.4 km, ENU=[E,N,U]",
        "start": grid[0].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "step_hours": step_hours,
        "n": len(grid),
        "sun": pack(sky["sun"]),
        "earth": pack(sky["earth"]),
    }


# --- Static frontend ------------------------------------------------------------
# Mounted last so the /api routes above take precedence.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
