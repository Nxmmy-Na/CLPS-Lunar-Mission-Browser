"""
Download the kernels needed by ephemeris.py into backend/data/.
Run once, from backend/:   python scripts/fetch_kernels.py
(Needs internet; then commit backend/data/.)
"""
from pathlib import Path
from skyfield.api import Loader

DATA = Path(__file__).resolve().parent.parent / "data"
load = Loader(str(DATA), verbose=True)
for name in ("de421.bsp", "moon_080317.tf",
             "moon_pa_de421_1900-2050.bpc", "pck00008.tpc"):
    load(name)
print("Done ->", DATA)
