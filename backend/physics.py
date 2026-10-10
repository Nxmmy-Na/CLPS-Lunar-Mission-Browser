"""
physics.py - Lunar surface physics helpers for the CLPS Lunar Mission Browser.

Contents
--------
* me_to_enu                 : rotate a vector from the Moon Mean-Earth (ME) body-fixed
                              frame into a local East-North-Up (ENU) frame.
* subsolar_vector_me        : unit Sun direction in the ME frame from a subsolar point.
* panel_normal_enu          : solar-panel normal from tilt / azimuth.
* solar_disk_visibility     : fraction of the solar disk above a flat horizon.
* calculate_solar_power     : electrical power produced by a flat solar panel.
* calculate_battery_survival: how long a battery keeps a lander alive in darkness.
* calculate_slope_tri       : slope and Terrain Ruggedness Index from a DEM grid.

Conventions
-----------
* Angles in function arguments are in DEGREES unless the name says otherwise.
* ENU components are ordered [East, North, Up].
* Azimuth is measured clockwise from North (0 = N, 90 = E).
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

# --- Physical constants -------------------------------------------------------
SOLAR_CONSTANT_W_M2 = 1361.0       # Mean total solar irradiance at 1 AU (W/m^2)
MOON_RADIUS_M = 1_737_400.0        # IAU mean lunar radius (m)
SOLAR_DISK_RADIUS_DEG = 0.267      # Apparent angular radius of the Sun from the Moon
LUNAR_OBLIQUITY_DEG = 1.54         # Lunar equator vs ecliptic -> max |subsolar lat|
SYNODIC_MONTH_HOURS = 29.530589 * 24.0


def _unit(v: np.ndarray) -> np.ndarray:
    """Return v normalised to unit length (raises on a zero vector)."""
    v = np.asarray(v, dtype=float)
    n = np.linalg.norm(v)
    if n == 0.0:
        raise ValueError("Cannot normalise a zero-length vector")
    return v / n


# --- Frames -------------------------------------------------------------------
def me_to_enu(target_vec_me, lat_deg: float, lon_deg: float) -> np.ndarray:
    """
    Rotate a vector from the Moon ME (body-fixed Cartesian) frame to local ENU.

    The ENU basis at planetocentric (lat, lon) expressed in ME coordinates is:
        East  = [-sin(lon),           cos(lon),          0      ]
        North = [-sin(lat)cos(lon),  -sin(lat)sin(lon),  cos(lat)]
        Up    = [ cos(lat)cos(lon),   cos(lat)sin(lon),  sin(lat)]
    Stacking these as rows gives the rotation matrix R so that v_enu = R @ v_me.

    This is a pure rotation (direction vectors). To convert a *position*,
    subtract the site's ME position first.
    """
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    sin_lat, cos_lat = np.sin(lat), np.cos(lat)
    sin_lon, cos_lon = np.sin(lon), np.cos(lon)

    rotation = np.array([
        [-sin_lon,            cos_lon,           0.0],
        [-sin_lat * cos_lon, -sin_lat * sin_lon, cos_lat],
        [ cos_lat * cos_lon,  cos_lat * sin_lon, sin_lat],
    ])
    return rotation @ np.asarray(target_vec_me, dtype=float)


def subsolar_vector_me(subsolar_lat_deg: float, subsolar_lon_deg: float) -> np.ndarray:
    """
    Unit vector pointing toward the Sun in the ME frame.

    The Sun is ~150 million km away, so the direction from any surface point is
    effectively the same as from the Moon's centre: it points at the subsolar point.
    """
    lat = np.radians(subsolar_lat_deg)
    lon = np.radians(subsolar_lon_deg)
    return np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])


def enu_to_az_el(vec_enu) -> tuple[float, float]:
    """Return (azimuth_deg, elevation_deg) of an ENU direction vector."""
    e, n, u = _unit(vec_enu)
    azimuth = round(float(np.degrees(np.arctan2(e, n))), 9) % 360.0  # avoid 360.0 from -0
    elevation = np.degrees(np.arcsin(np.clip(u, -1.0, 1.0)))
    return float(azimuth), float(elevation)


def panel_normal_enu(tilt_deg: float, azimuth_deg: float) -> np.ndarray:
    """
    Solar-panel normal in ENU.

    tilt_deg    : 0 = panel lying flat facing up, 90 = vertical panel.
    azimuth_deg : direction the panel faces, clockwise from North.

    At the lunar poles the Sun skims the horizon, so landers use near-vertical
    panels (tilt ~ 90 deg).
    """
    t = np.radians(tilt_deg)
    a = np.radians(azimuth_deg)
    return np.array([np.sin(t) * np.sin(a), np.sin(t) * np.cos(a), np.cos(t)])


# --- Illumination ---------------------------------------------------------------
def solar_disk_visibility(sun_elevation_deg: float,
                          disk_radius_deg: float = SOLAR_DISK_RADIUS_DEG) -> float:
    """
    Fraction (0..1) of the solar disk above a flat, local horizon.

    Uses the area of a circular segment: the Sun is modelled as a disk of angular
    radius r whose centre sits h degrees above the horizon. This matters at the
    poles where the Sun is often only partially risen.
    """
    r = disk_radius_deg
    h = float(np.clip(sun_elevation_deg, -r, r))
    # Signed distance from the disk centre to the horizon chord is d = -h.
    # The visible (upper) part is a circular segment with central angle
    # theta = 2*acos(d/r): h = +r -> whole disk, h = 0 -> half, h = -r -> none.
    d = -h
    theta = 2.0 * np.arccos(np.clip(d / r, -1.0, 1.0))
    segment_above = (r ** 2 / 2.0) * (theta - np.sin(theta))
    return float(segment_above / (np.pi * r ** 2))


def calculate_solar_power(sun_vector, panel_normal, area: float, efficiency: float,
                          visibility: float = 1.0,
                          solar_constant: float = SOLAR_CONSTANT_W_M2) -> float:
    """
    Electrical power (W) produced by a flat solar panel.

        P = S * A * eta * max(0, s_hat . n_hat) * V

    sun_vector   : direction to the Sun (any frame, same frame as panel_normal)
    panel_normal : outward normal of the panel's active face
    area         : panel area (m^2)
    efficiency   : cell + system efficiency (0..1)
    visibility   : fraction of the solar disk actually visible (0..1); combines
                   horizon/terrain shadowing. 0 = fully shadowed.
    solar_constant : irradiance at the Moon (W/m^2); ~1361 at 1 AU.

    The cosine term is clipped at zero: light hitting the back of the panel
    produces no power.
    """
    if area < 0 or not (0.0 <= efficiency <= 1.0) or not (0.0 <= visibility <= 1.0):
        raise ValueError("area must be >= 0; efficiency and visibility must be in [0, 1]")
    cos_incidence = float(np.dot(_unit(sun_vector), _unit(panel_normal)))
    cos_incidence = max(0.0, cos_incidence)
    return solar_constant * area * efficiency * cos_incidence * visibility


# --- Energy storage -------------------------------------------------------------
def calculate_battery_survival(battery_capacity_wh: float, base_power_w: float,
                               heater_power_w: float,
                               depth_of_discharge: float = 1.0) -> float:
    """
    Hours a lander can survive on battery alone during darkness.

        t = (C * DoD) / (P_base + P_heater)

    battery_capacity_wh : nameplate capacity (Wh)
    base_power_w        : avionics / comms / keep-alive load (W)
    heater_power_w      : survival heater load needed in shadow (W)
    depth_of_discharge  : usable fraction of capacity (0..1)
    """
    total_load = base_power_w + heater_power_w
    if total_load <= 0:
        raise ValueError("Total load must be positive")
    if battery_capacity_wh < 0 or not (0.0 < depth_of_discharge <= 1.0):
        raise ValueError("Capacity must be >= 0 and depth_of_discharge in (0, 1]")
    return battery_capacity_wh * depth_of_discharge / total_load


# --- Terrain --------------------------------------------------------------------
def _tri_kernel(window: np.ndarray) -> float:
    """Riley et al. (1999) TRI for one 3x3 window (flattened, centre at index 4)."""
    centre = window[4]
    return float(np.sqrt(np.sum((window - centre) ** 2)))


def calculate_slope_tri(dem: np.ndarray, cell_size_m: float) -> dict:
    """
    Slope and Terrain Ruggedness Index (TRI) for a gridded DEM.

    dem         : 2-D array of elevations (m), rows = north->south, cols = west->east
    cell_size_m : grid spacing (m)

    Returns a dict with full grids and summary statistics:
        slope_deg : arctan(|grad z|) per cell (degrees)
        tri_m     : sqrt(sum of squared elevation differences to 8 neighbours)
    """
    dem = np.asarray(dem, dtype=float)
    if dem.ndim != 2 or min(dem.shape) < 3:
        raise ValueError("DEM must be a 2-D grid of at least 3x3 cells")

    dz_dy, dz_dx = np.gradient(dem, cell_size_m)
    slope_deg = np.degrees(np.arctan(np.hypot(dz_dx, dz_dy)))
    tri_m = ndimage.generic_filter(dem, _tri_kernel, size=3, mode="nearest")

    return {
        "slope_deg": slope_deg,
        "tri_m": tri_m,
        "mean_slope_deg": float(slope_deg.mean()),
        "max_slope_deg": float(slope_deg.max()),
        "mean_tri_m": float(tri_m.mean()),
    }
