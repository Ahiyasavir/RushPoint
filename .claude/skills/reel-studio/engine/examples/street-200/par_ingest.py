# Parallel transcription, priority order, one JSON per file (nothing lost if stopped).
import sys, json
from pathlib import Path
from multiprocessing import Pool
sys.path.insert(0, r"C:\Users\savir\Projects\Rushpoint\.claude\skills\reel-studio\scripts")
import ingest as I
HERE = Path(__file__).resolve().parent
SRC, OUT = HERE / "raw", HERE / "ingest"
ORDER = ["VID-20261016-WA0015", "VID-20261016-WA0016", "VID-20261016-WA0014", "VID-20261016-WA0009",
         "VID-20261016-WA0013", "VID-20261016-WA0010", "VID-20261016-WA0008", "VID-20261016-WA0007",
         "20261015_234102", "20261015_214519", "20261015_214200", "20261015_205716", "20261015_214907",
         "20261015_221738", "20261015_213954"]

def work(files):
    from faster_whisper import WhisperModel
    m = WhisperModel("ivrit-ai/whisper-large-v3-turbo-ct2", device="cpu", compute_type="int8", cpu_threads=4)
    for stem in files:
        p = SRC / f"{stem}.mp4"; dst = OUT / f"{stem}.json"
        if dst.exists():
            continue
        info = I.probe(p)
        regs, floor = I.speech_regions(p)
        info["speech"], info["noise_floor_db"] = regs, floor
        segs, _ = m.transcribe(str(p), language="he", word_timestamps=True, vad_filter=False, beam_size=5)
        words, lines = [], []
        for s in segs:
            lines.append([round(s.start, 2), round(s.end, 2), s.text.strip()])
            words += [[w.word.strip(), round(w.start, 2), round(w.end, 2)] for w in (s.words or [])]
        info["segments"], info["words"] = lines, words
        dst.write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
        print("done", stem, flush=True)

if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    n = 2
    with Pool(n) as pool:
        pool.map(work, [ORDER[i::n] for i in range(n)])
    print("ALL DONE", flush=True)
