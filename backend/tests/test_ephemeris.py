"""
Tests for ephemeris.py.

Three groups:
  1. Pure geometry / data conventions       - need NO kernels, always run.
  2. Physical sanity at a south-pole site   - need the kernels in backend/data/.
  3. JPL Horizons comparison                - SKIPPED until reference rows are
                                              filled in (see HORIZONS_ROWS).

HOW TO FETCH HORIZONS REFERENCE ROWS (observer ON THE MOON, refraction off)
---------------------------------------------------------------------------
Web interface (https://ssd.jpl.nasa.gov/horizons/app.html) or API with:
    EPHEM_TYPE   = OBSERVER
    COMMAND      = '10'   (Sun)   and   '399'  (Earth)      -> one query each
    CENTER       = 'coord@301'                    (observer site on the Moon)
    COORD_TYPE   = 'GEODETIC'
    SITE_COORD   = 'EAST_LON_deg,LAT_deg,ALT_km'  e.g. '0.5,-85.9,0'
    START_TIME / STOP_TIME / STEP_SIZE            (UT, times at whole minutes)
    QUANTITIES   = '4'            (Apparent azimuth & elevation)
    APPARENT     = 'AIRLESS'      (no refraction)
    ANG_FORMAT   = 'DEG'
    EXTRA_PREC   = 'YES'
    CSV_FORMAT   = 'YES'
Then READ THE HEADER of the output and note:
    * "Center radii"      -> must be a sphere (1737.4 km?) like ours
    * Center geodetic     -> longitude must echo your EAST-positive input
    * reference frame     -> which Moon body-fixed frame it names
Copy Azi/Elev for 3-5 times into HORIZONS_ROWS below.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

import ephemeris
import physics

# ---- Tolerances (constants; nothing below hard-codes a claimed accuracy) ----
HORIZONS_TOL_DEG = 0.001      # PROVISIONAL: loosen/tighten after you see the measured error. ไม่เกินประมาณ 0.00001°
INTERNAL_TOL_DEG = 1e-4      # our ENU conversion vs Skyfield's own altaz().
EARTH_LIBRATION_MAX_DEG = 8.0   # generous upper bound on Earth libration amplitude.
SANITY_MARGIN_DEG = 1.0

SITES_FILE = Path(__file__).resolve().parents[2] / "frontend" / "sites_data.json"
# NOTE: site lat/lon in sites_data.json are APPROXIMATE region centres
# (each real region is about 15 x 15 km), not landing targets.

# ---- TODO: fill with values copied from JPL Horizons (do NOT invent) --------
# time_utc: "YYYY-MM-DD HH:MM"; angles in degrees; lon is EAST-positive.
HORIZONS_ROWS = [
    {"time_utc": "2026-11-01 00:00", "lat": -85.9, "lon": 0.5,  # Horizons date: 2026-Nov-01 00:00:00.000
     "sun_az": 284.494005562, "sun_el": 2.487845757, "earth_az": 3.479743971, "earth_el": 7.03376252},
    {"time_utc": "2026-11-05 13:00", "lat": -85.9, "lon": 0.5,  # Horizons date: 2026-Nov-05 13:00:00.029
     "sun_az": 229.293080395, "sun_el": -1.170359787, "earth_az": 5.106498905, "earth_el": 0.265035374},
    {"time_utc": "2026-11-10 06:00", "lat": -85.9, "lon": 0.5,  # Horizons date: 2026-Nov-10 06:00:00.000
     "sun_az": 171.85025249, "sun_el": -2.512890038, "earth_az": 2.707324882, "earth_el": -2.711393334},
    {"time_utc": "2026-11-17 18:00", "lat": -85.9, "lon": 0.5,  # Horizons date: 2026-Nov-17 18:00:00.000
     "sun_az": 80.584797476, "sun_el": 2.22723254, "earth_az": 353.47539283, "earth_el": 4.155686585},
    {"time_utc": "2026-11-24 03:00", "lat": -85.9, "lon": 0.5,  # Horizons date: 2026-Nov-24 03:00:00.000
     "sun_az": 3.038388624, "sun_el": 5.617998688, "earth_az": 356.071123296, "earth_el": 10.346551201},
]

needs_kernels = pytest.mark.skipif(
    not ephemeris.kernels_available(),
    reason=f"Kernels missing in backend/data/: {ephemeris.missing_files()} "
           "(run: python scripts/fetch_kernels.py)")


def _site(site_id: str) -> dict:
    data = json.loads(SITES_FILE.read_text(encoding="utf-8"))
    return next(s for s in data["sites"] if s["id"] == site_id)


def _unit_from_az_el(az_deg, el_deg):
    az, el = np.radians(az_deg), np.radians(el_deg)
    return np.array([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)])


# =============================== 1. geometry ================================
def test_local_up_vector():
    lat, lon = -85.9, 33.0
    r = np.array([[np.cos(np.radians(lat)) * np.cos(np.radians(lon))],
                  [np.cos(np.radians(lat)) * np.sin(np.radians(lon))],
                  [np.sin(np.radians(lat))]])
    sky = ephemeris.me_vectors_to_sky(r, lat, lon)
    assert np.allclose(sky["enu"][0], [0, 0, 1], atol=1e-12)
    assert sky["alt"][0] == pytest.approx(90.0)


def test_longitude_is_east_positive_and_azimuth_convention():
    # Equatorial site at lon 0: the ME +Y axis is 90 deg EAST -> must appear due East.
    east = ephemeris.me_vectors_to_sky([[0], [1], [0]], 0.0, 0.0)
    assert east["az"][0] == pytest.approx(90.0)
    assert east["alt"][0] == pytest.approx(0.0, abs=1e-9)
    # ME +Z (north pole direction) -> due North, azimuth 0.
    north = ephemeris.me_vectors_to_sky([[0], [0], [1]], 0.0, 0.0)
    assert north["az"][0] == pytest.approx(0.0, abs=1e-9)


def test_sites_json_uses_east_positive_longitude():
    # Blue Ghost M1 lands in Mare Crisium, on the EAST limb of the near side
    # (~ +59 deg E). If the file were west-positive this would be negative.
    assert _site("blue-ghost-m1")["lon"] > 0
    meta = json.loads(SITES_FILE.read_text(encoding="utf-8"))["metadata"]["reference_frame"]
    assert "Mean Earth" in meta and "1737.4" in meta


def test_physics_me_to_enu_matches_ephemeris_convention():
    v = np.array([0.3, -0.5, 0.8])
    a = physics.me_to_enu(v, -85.9, 12.0)
    b = ephemeris.me_vectors_to_sky(v.reshape(3, 1), -85.9, 12.0)["enu"][0]
    assert np.allclose(a / np.linalg.norm(a), b, atol=1e-12)


# =============================== 2. sanity ==================================
@needs_kernels
def test_malapert_sun_and_earth_sanity():
    site = _site("malapert-massif")
    lat, lon = site["lat"], site["lon"]
    grid = ephemeris.utc_grid(datetime(2026, 11, 1, tzinfo=timezone.utc), 30, 1)
    sky = ephemeris.sun_earth_sky(lat, lon, grid)

    colat = 90.0 - abs(lat)
    sun_alt, earth_alt = sky["sun"]["alt"], sky["earth"]["alt"]
    print(f"\nSun   alt range: {sun_alt.min():.3f} .. {sun_alt.max():.3f} deg")
    print(f"Earth alt range: {earth_alt.min():.3f} .. {earth_alt.max():.3f} deg")

    # Sun: sub-solar latitude never exceeds the lunar obliquity, so the Sun stays
    # within (90-|lat|) + obliquity of the horizon (plus a small margin).
    sun_bound = colat + physics.LUNAR_OBLIQUITY_DEG + SANITY_MARGIN_DEG
    assert np.all(np.abs(sun_alt) <= sun_bound)

    # Earth: sub-Earth point wanders within EARTH_LIBRATION_MAX_DEG of (0,0), so its
    # angular distance from the site is |lat| +/- that amount.
    assert earth_alt.min() >= colat - EARTH_LIBRATION_MAX_DEG - SANITY_MARGIN_DEG
    assert earth_alt.max() <= colat + EARTH_LIBRATION_MAX_DEG + SANITY_MARGIN_DEG
    assert (earth_alt.max() - earth_alt.min()) < 2 * EARTH_LIBRATION_MAX_DEG

    # Unit vectors really are unit length.
    for body in ("sun", "earth"):
        assert np.allclose(np.linalg.norm(sky[body]["enu"], axis=1), 1.0, atol=1e-9)


@needs_kernels
def test_enu_matches_skyfield_altaz():
    st = ephemeris.init()
    lat, lon = -85.9, 0.5
    grid = ephemeris.utc_grid(datetime(2026, 11, 1, tzinfo=timezone.utc), 3, 6)
    t = st["ts"].from_datetimes(grid)
    site = st["pc"].build_latlon_degrees(
        st["frame"], lat, lon,
        elevation_m=(ephemeris.R_MOON_KM - st["pck_radius_km"]) * 1e3)
    ours = ephemeris.sun_earth_sky(lat, lon, t)
    for name in ("sun", "earth"):
        alt, az, _ = (st["eph"]["moon"] + site).at(t).observe(
            st["eph"][name]).apparent().altaz()      # no refraction by default
        ref = np.array([_unit_from_az_el(a, e) for a, e in zip(az.degrees, alt.degrees)])
        cosang = np.clip(np.sum(ref * ours[name]["enu"], axis=1), -1, 1)
        err = np.degrees(np.arccos(cosang)).max()
        print(f"\n{name}: max angular difference vs Skyfield altaz = {err:.3e} deg")
        assert err < INTERNAL_TOL_DEG


# =============================== 3. Horizons ================================
def _row_complete(row) -> bool:
    keys = ("sun_az", "sun_el", "earth_az", "earth_el")
    return all(row.get(k) is not None for k in keys)


@needs_kernels
@pytest.mark.parametrize("row", HORIZONS_ROWS or [None])
def test_against_horizons(row):
    if row is None or not _row_complete(row):
        pytest.skip("TODO: paste JPL Horizons reference rows into HORIZONS_ROWS "
                    "(settings are in this file's docstring).")
    t = datetime.strptime(row["time_utc"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    sky = ephemeris.sun_earth_sky(row["lat"], row["lon"], [t])
    for body in ("sun", "earth"):
        ref = _unit_from_az_el(row[f"{body}_az"], row[f"{body}_el"])
        cosang = np.clip(float(np.dot(ref, sky[body]["enu"][0])), -1, 1)
        err = np.degrees(np.arccos(cosang))
        print(f"\n{row['time_utc']} {body}: measured angular error = {err:.5f} deg "
              f"(tolerance constant = {HORIZONS_TOL_DEG} deg)")
        assert err < HORIZONS_TOL_DEG
