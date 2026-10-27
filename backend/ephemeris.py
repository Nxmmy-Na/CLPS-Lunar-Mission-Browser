"""
ephemeris.py - Time-based Sun and Earth directions at a lunar surface site.

What it does
------------
Given a site (selenographic lat/lon, degrees, EAST-positive longitude) and UTC
times, returns for the Sun and the Earth:
    * enu : unit vector in local East-North-Up, shape (N, 3)
    * alt : altitude above the local horizontal plane, degrees
    * az  : azimuth clockwise from North (0 = N, 90 = E), degrees

Model used (read this before trusting the numbers)
--------------------------------------------------
* Ephemeris : JPL DE421 (de421.bsp) via Skyfield.
* Moon orientation : NAIF high-accuracy lunar frame MOON_ME_DE421 (Mean Earth /
  Polar Axis), built by Skyfield's PlanetaryConstants from
      - moon_080317.tf                 (frame definitions)
      - moon_pa_de421_1900-2050.bpc    (DE421 lunar orientation incl. PHYSICAL
                                        libration, valid 1900-2050)
      - pck00008.tpc                   (body constants, e.g. radii)
  So libration is INCLUDED (optical + physical). Nothing is simplified.
* Site position : sphere of radius R = 1737.4 km (IAU mean radius, same as
  sites_data.json metadata). Latitude is therefore planetocentric = geodetic.
  The radius from the PCK is overridden to 1737.4 km explicitly.
* Direction : "apparent" direction (light-time, gravitational deflection,
  stellar aberration included), seen from the site, NOT from the Moon centre,
  so Earth parallax from the site offset is included. No atmospheric
  refraction is applied (the Moon has none).
* The ME vector -> ENU rotation reuses physics.me_to_enu (east-positive lon).

Approximations / limits
-----------------------
* Only the CENTRE direction of the Sun and Earth is returned (no disk size).
* Valid only for 1900-2050 (limit of DE421 and the lunar PCK).
* Site elevation = 0 (reference sphere). Local terrain is not modelled.
* Checked against JPL Horizons at Malapert Massif (5 times, Nov 2026): Sun and
  Earth directions agreed to <= ~1e-5 deg. An older note expected up to ~0.005 deg
  of frame disagreement; that was NOT observed in these samples. Other sites,
  dates and years have not been checked yet.

Memory: kernels are loaded once (init()) and reused; DE421 is memory-mapped.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Sequence, Union

import numpy as np

import physics

R_MOON_KM = 1737.4
DATA_DIR = Path(__file__).resolve().parent / "data"
FRAME_NAME = "MOON_ME_DE421"
REQUIRED_FILES = (
    "de421.bsp",
    "moon_080317.tf",
    "moon_pa_de421_1900-2050.bpc",
    "pck00008.tpc",
)
VALID_YEARS = (1900, 2050)


class EphemerisUnavailable(RuntimeError):
    """Kernels missing or Skyfield not installed."""


_STATE: dict = {}


def missing_files() -> list[str]:
    return [f for f in REQUIRED_FILES if not (DATA_DIR / f).exists()]


def kernels_available() -> bool:
    return not missing_files()


def init() -> dict:
    """Load kernels once (idempotent) and return the cached state."""
    if _STATE:
        return _STATE
    miss = missing_files()
    if miss:
        raise EphemerisUnavailable(
            f"Missing kernel files in {DATA_DIR}: {miss}. "
            "Run: python scripts/fetch_kernels.py")
    try:
        from skyfield.api import Loader, PlanetaryConstants
    except ImportError as exc:  # pragma: no cover
        raise EphemerisUnavailable("skyfield is not installed") from exc

    load = Loader(str(DATA_DIR), verbose=False)  # local files only, no downloads
    pc = PlanetaryConstants()
    pc.read_text(load("moon_080317.tf"))
    pc.read_text(load("pck00008.tpc"))
    pc.read_binary(load("moon_pa_de421_1900-2050.bpc"))
    frame = pc.build_frame_named(FRAME_NAME)
    radii = pc.variables["BODY301_RADII"]
    _STATE.update(
        ts=load.timescale(),  # built-in leap-second table, no download
        eph=load("de421.bsp"),
        pc=pc,
        frame=frame,
        pck_radius_km=float(radii[0]),
    )
    return _STATE


# --- Pure geometry (no kernels needed; unit-testable) ------------------------
def me_vectors_to_sky(vec_me: np.ndarray, lat_deg: float, lon_deg: float) -> dict:
    """
    vec_me : (3, N) vectors in the Moon ME frame (any length units).
    Returns dict(enu=(N,3) unit vectors, alt=(N,), az=(N,)) in degrees.
    """
    vec_me = np.asarray(vec_me, dtype=float).reshape(3, -1)
    enu = physics.me_to_enu(vec_me, lat_deg, lon_deg)          # (3, N)
    enu = enu / np.linalg.norm(enu, axis=0)
    alt = np.degrees(np.arcsin(np.clip(enu[2], -1.0, 1.0)))
    az = np.degrees(np.arctan2(enu[0], enu[1])) % 360.0
    return {"enu": enu.T, "alt": alt, "az": az}


# --- Time helpers -----------------------------------------------------------
def utc_grid(start: datetime, days: int, step_hours: int) -> list[datetime]:
    """Aware-UTC datetimes from start, inclusive of the final step."""
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    start = start.astimezone(timezone.utc)
    n = int(days * 24 // step_hours) + 1
    return [start + timedelta(hours=step_hours * i) for i in range(n)]


def _to_time(ts, times):
    if hasattr(times, "tt"):                       # already a Skyfield Time
        return times
    aware = []
    for d in times:
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        aware.append(d.astimezone(timezone.utc))
    if not aware:
        raise ValueError("times_utc is empty")
    if not (VALID_YEARS[0] <= aware[0].year and aware[-1].year <= VALID_YEARS[1]):
        raise ValueError(f"Times must be within {VALID_YEARS} (DE421 / lunar PCK range)")
    return ts.from_datetimes(aware)


# --- Main function -------------------------------------------------------------
def sun_earth_sky(lat_deg: float, lon_deg: float,
                  times_utc: Union[Sequence[datetime], object]) -> dict:
    """
    lat_deg, lon_deg : selenographic, Mean Earth / Polar Axis, east-positive.
    times_utc        : sequence of datetimes (naive = UTC) or a Skyfield Time.

    Returns {"sun": {...}, "earth": {...}}, each with enu (N,3), alt (N,), az (N,).
    """
    st = init()
    t = _to_time(st["ts"], times_utc)
    # Force the reference sphere to R_MOON_KM regardless of the PCK radius.
    elevation_m = (R_MOON_KM - st["pck_radius_km"]) * 1e3
    site = st["pc"].build_latlon_degrees(st["frame"], lat_deg, lon_deg,
                                         elevation_m=elevation_m)
    observer = (st["eph"]["moon"] + site).at(t)
    out = {}
    for name in ("sun", "earth"):
        apparent = observer.observe(st["eph"][name]).apparent()
        vec_me = apparent.frame_xyz(st["frame"]).km      # (3, N), ME frame
        out[name] = me_vectors_to_sky(vec_me, lat_deg, lon_deg)
    return out


def sky_over_period(lat_deg: float, lon_deg: float, start: datetime,
                    days: int, step_hours: int) -> tuple[list[datetime], dict]:
    grid = utc_grid(start, days, step_hours)
    return grid, sun_earth_sky(lat_deg, lon_deg, grid)
