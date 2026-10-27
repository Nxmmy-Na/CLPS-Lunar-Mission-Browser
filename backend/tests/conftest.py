import sys
from pathlib import Path

# Make `import ephemeris` / `import physics` work when running `pytest` from backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
