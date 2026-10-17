# Re-run only the voice chain on an assembled take (picture untouched): python revoice.py s200-compilation ...
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from street import voice_chain  # noqa: E402

for reel in sys.argv[1:]:
    RD = HERE.parent / reel
    M = json.loads((RD / "measured.json").read_text(encoding="utf-8"))
    voice_chain(RD / "_seg" / "take_raw.wav", RD / "voice" / "take.wav", M["take_end"], 32)
    print("revoiced", reel)
