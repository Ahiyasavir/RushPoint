# Parallel ingest: N workers, each its own whisper model, files split round robin.
import sys, json, os
from pathlib import Path
from multiprocessing import Pool
sys.path.insert(0, r"C:\Users\savir\Projects\Rushpoint\.claude\skills\reel-studio\scripts")
import ingest as I

SRC = Path(__file__).parent / "src"
OUT = Path(__file__).parent / "ingest"

def work(files):
    from faster_whisper import WhisperModel
    m = WhisperModel("ivrit-ai/whisper-large-v3-turbo-ct2", device="cpu", compute_type="int8", cpu_threads=4)
    res = {}
    for p in files:
        p = Path(p)
        info = I.probe(p)
        regs, floor = I.speech_regions(p)
        info["speech"], info["noise_floor_db"] = regs, floor
        I.sheet(p, info["duration"], OUT / f"{p.stem}.jpg")
        segs, _ = m.transcribe(str(p), language="he", word_timestamps=True, vad_filter=False)
        words, text = [], []
        for s in segs:
            text.append(s.text)
            words += [[w.word.strip(), round(w.start, 2), round(w.end, 2)] for w in (s.words or [])]
        shift = round(regs[0][0] - words[0][1], 2) if (words and regs) else 0.0
        info["text"] = " ".join(text).strip()
        info["whisper_shift_s"] = shift
        info["words"] = [[w, round(a + shift, 2), round(b + shift, 2)] for w, a, b in words]
        res[p.name] = info
        print(p.name, info["duration"], "«" + info["text"] + "»", flush=True)
    return res

if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    fs = sorted(str(p) for p in SRC.glob("*.mp4"))
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    groups = [fs[i::n] for i in range(n)]
    with Pool(n) as pool:
        parts = pool.map(work, groups)
    allr = {}
    for p in parts: allr.update(p)
    (OUT / "ingest.json").write_text(json.dumps(allr, ensure_ascii=False, indent=1), encoding="utf-8")
    print("done", len(allr))
