# High-quality neural TTS for the RushPoint VO — ElevenLabs or OpenAI.
# Reads the API key from env (.env). Generates vo/<id>.mp3 for every line in vo-script.json.
#
#   ElevenLabs:  set ELEVENLABS_API_KEY   (best Hebrew; model eleven_multilingual_v2)
#   OpenAI:      set OPENAI_API_KEY        (voice: onyx/nova/…; model gpt-4o-mini-tts)
#
#   python neural_tts.py elevenlabs        # or:  python neural_tts.py openai
import os, sys, json, urllib.request, pathlib

HERE = pathlib.Path(__file__).parent
LINES = json.loads((HERE / "vo-script.json").read_text(encoding="utf-8"))
OUT = HERE / "vo"; OUT.mkdir(exist_ok=True)

# load .env if present
env = HERE / ".env"
if env.exists():
    for ln in env.read_text(encoding="utf-8").splitlines():
        ln = ln.strip()
        if ln and not ln.startswith("#") and "=" in ln:
            k, v = ln.split("=", 1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

provider = (sys.argv[1] if len(sys.argv) > 1 else "elevenlabs").lower()

def elevenlabs(text):
    key = os.environ["ELEVENLABS_API_KEY"]
    # A warm male multilingual voice ("Adam"); override via ELEVENLABS_VOICE_ID.
    voice = os.environ.get("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB")
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128"
    # eleven_v3 is the only model that supports Hebrew (and supports [emotion] tags).
    body = json.dumps({
        "text": text,
        "model_id": os.environ.get("ELEVENLABS_MODEL", "eleven_v3"),
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"xi-api-key": key, "Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=60).read()

def openai(text):
    key = os.environ["OPENAI_API_KEY"]
    url = "https://api.openai.com/v1/audio/speech"
    body = json.dumps({
        "model": "gpt-4o-mini-tts",
        "voice": os.environ.get("OPENAI_VOICE", "onyx"),
        "input": text,
        "instructions": "Speak in Hebrew with warm, upbeat, charismatic energy — like an exciting product launch trailer. Natural pacing, clear enthusiasm.",
    }).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    return urllib.request.urlopen(req, timeout=60).read()

gen = {"elevenlabs": elevenlabs, "openai": openai}[provider]
for l in LINES:
    audio = gen(l["text"])
    (OUT / f'{l["id"]}.mp3').write_bytes(audio)
    print(f'{l["id"]}: {len(audio)} bytes')
print(f"done via {provider}")
