"""Fetch Horizons reference rows (observer on the Moon, no refraction)."""
import json
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SITE_ID = "malapert-massif"
TIMES_UTC = [
    "2026-11-01 00:00",
    "2026-11-05 13:00",
    "2026-11-10 06:00",
    "2026-11-17 18:00",
    "2026-11-24 03:00",
]
SITES = Path(__file__).resolve().parents[2] / "frontend" / "sites_data.json"
site = next(s for s in json.loads(SITES.read_text(encoding="utf-8"))["sites"]
            if s["id"] == SITE_ID)
LAT, LON = site["lat"], site["lon"]


def jd(s):
    dt = datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
    return dt.timestamp() / 86400 + 2440587.5


def query(cmd):
    params = {
        "format": "json", "COMMAND": f"'{cmd}'", "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'", "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'", "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{LON},{LAT},0'",
        "TLIST": "'" + " ".join(f"{jd(t):.6f}" for t in TIMES_UTC) + "'",
        "TLIST_TYPE": "'JD'", "TIME_TYPE": "'UT'", "QUANTITIES": "'4'",
        "APPARENT": "'AIRLESS'", "ANG_FORMAT": "'DEG'",
        "EXTRA_PREC": "'YES'", "CSV_FORMAT": "'YES'",
    }
    url = "https://ssd.jpl.nasa.gov/api/horizons.api?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=90) as r:
        d = json.load(r)
    if "result" not in d:
        raise SystemExit(f"Horizons error: {d}")
    return d["result"]


def parse(result):
    if "$$SOE" not in result:
        raise SystemExit("Horizons returned no table:\n" + result[:3000])
    head, rest = result.split("$$SOE", 1)
    body = rest.split("$$EOE", 1)[0]
    rows = []
    for line in body.strip().splitlines():
        parts = [p.strip() for p in line.split(",")]
        nums = []
        for p in parts[1:]:
            try:
                nums.append(float(p))
            except ValueError:
                pass
        if len(nums) < 2:
            raise SystemExit(f"Cannot parse line: {line!r}")
        rows.append((parts[0], nums[-2], nums[-1]))   # (date, az, el)
    return head, rows


sun_head, sun = parse(query("10"))
_, earth = parse(query("399"))

print("# ---- Horizons header lines worth reading (send these to me) ----")
for line in sun_head.splitlines():
    if any(k in line.lower() for k in ("radii", "geodetic", "cylindric", "frame", "center body")):
        print("#", line.strip())

print("\n# ---- paste this into HORIZONS_ROWS in tests/test_ephemeris.py ----")
print("HORIZONS_ROWS = [")
for t, (d1, saz, sel), (d2, eaz, eel) in zip(TIMES_UTC, sun, earth):
    print(f'    {{"time_utc": "{t}", "lat": {LAT}, "lon": {LON},  # Horizons date: {d1}')
    print(f'     "sun_az": {saz}, "sun_el": {sel}, "earth_az": {eaz}, "earth_el": {eel}}},')
print("]")
