"""Voice + the v2 bed. Every level MEASURED, never estimated.

The bed is ducked by the voice (sidechain, key duplicated with asplit because a
labelled stream is consumed once) and then sat a measured ~10 dB under it.
"""
import subprocess, re, os

def lufs(path):
    p = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path,
                        "-af", "ebur128=framelog=quiet", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.findall(r"I:\s*(-?\d+\.\d+)\s*LUFS", p.stderr)
    return float(m[-1]) if m else None

VO_TARGET = -16.0
MUSIC_UNDER = 10.0          # dB below the voice

# vo_raw is at the NATURAL speaking rate; the picture is 1.2x. Speed FIRST,
# then measure, or the loudness is measured on the wrong file.
SPEED = 1.2
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "vo_raw.wav",
                "-af", f"atempo={SPEED}", "vo_sped.wav"], check=True)
vo_in = lufs("vo_sped.wav")
g_vo = VO_TARGET - vo_in
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "vo_sped.wav",
                "-af", f"volume={g_vo:.2f}dB", "vo.wav"], check=True)
print(f"voice  {vo_in:.2f} -> {lufs('vo.wav'):.2f} LUFS  (gain {g_vo:+.2f} dB)")

mu_in = lufs("music_env.wav")
g_mu = (VO_TARGET - MUSIC_UNDER) - mu_in
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "music_env.wav",
                "-af", f"volume={g_mu:.2f}dB", "music_lvl.wav"], check=True)
print(f"bed    {mu_in:.2f} -> {lufs('music_lvl.wav'):.2f} LUFS  (gain {g_mu:+.2f} dB, "
      f"{MUSIC_UNDER:.0f} dB under voice)")

# duck the bed under speech; asplit because a labelled stream is consumed once
fc = ("[0:a]asplit=2[key][v];"
      "[1:a][key]sidechaincompress=threshold=0.05:ratio=6:attack=12:release=260"
      ":makeup=1[duck];"
      "[v][duck]amix=inputs=2:duration=first:normalize=0,"
      "alimiter=limit=0.94:level=disabled[out]")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", "vo.wav", "-i", "music_lvl.wav",
                "-filter_complex", fc, "-map", "[out]", "-ar", "48000", "mixed.wav"], check=True)
print(f"mix    {lufs('mixed.wav'):.2f} LUFS integrated")
