"""Offline asset authoring only. Requires the isolated MLX environment in qa/."""
import argparse
import json
import subprocess
import time
from pathlib import Path
import numpy as np
from mlx_audio.tts.utils import load_model

parser = argparse.ArgumentParser()
parser.add_argument("--limit", type=int)
parser.add_argument("--gender", choices=["female", "male", "all"], default="all")
parser.add_argument("--male-voice", default="am_michael")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
corpus = json.loads((root / "qa/speech-corpus.json").read_text())
voices = [("af_heart", "female"), (args.male_voice, "male")]
voices = [(voice, name) for voice, name in voices if args.gender in ["all", name]]
jobs = [(item, voice, name) for item in corpus for voice, name in voices]
if args.limit:
    jobs = jobs[:args.limit]
output = root / "public/audio/kokoro-v1"
for name in ["female", "male"]:
    (output / name).mkdir(parents=True, exist_ok=True)
for voice, name in voices:
    metadata = output / name / "voice.json"
    identity = {"model": "mlx-community/Kokoro-82M-bf16", "voice": voice, "speed": 0.95}
    if metadata.exists() and json.loads(metadata.read_text()) != identity:
        raise ValueError("Existing recordings use another voice; archive them before regenerating: " + name)
    metadata.write_text(json.dumps(identity))
print("Loading natural English voices", flush=True)
model = load_model("mlx-community/Kokoro-82M-bf16")
started = time.monotonic()
done = skipped = 0
seconds = 0
for item, voice, name in jobs:
    destination = output / name / (item["key"] + ".mp3")
    if destination.exists() and destination.stat().st_size > 512:
        skipped += 1
        continue
    chunks = [np.asarray(result.audio) for result in model.generate(item["spoken"], voice=voice, speed=0.95, lang_code="a")]
    samples = np.concatenate(chunks).astype(np.float32)
    duration = len(samples) / model.sample_rate
    if not (0.15 < duration < 35) or not np.isfinite(samples).all() or np.sqrt(np.mean(samples ** 2)) < 0.0001:
        raise ValueError("Invalid generated audio: " + item["key"] + "/" + name)
    temporary = destination.with_suffix(".tmp.mp3")
    subprocess.run([
        "/opt/homebrew/bin/ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "f32le", "-ar", str(model.sample_rate), "-ac", "1", "-i", "pipe:0",
        "-af", "loudnorm=I=-19:TP=-1.5:LRA=11", "-ar", "24000", "-ac", "1",
        "-codec:a", "libmp3lame", "-b:a", "32k", "-write_xing", "0", "-id3v2_version", "0",
        str(temporary),
    ], input=samples.tobytes(), check=True)
    temporary.replace(destination)
    done += 1
    seconds += duration
    if done <= 6 or done % 50 == 0:
        print(json.dumps({"generated": done, "skipped": skipped, "total": len(jobs), "elapsed": round(time.monotonic() - started, 1), "audioSeconds": round(seconds, 1)}, ensure_ascii=False), flush=True)
print(json.dumps({"complete": True, "generated": done, "skipped": skipped, "elapsed": round(time.monotonic() - started, 1), "audioSeconds": round(seconds, 1)}), flush=True)
