"""Local speech recognition for the wake word and the "shut up" / "turn off" commands.

Runs fully offline once the model is downloaded (Whisper tiny.en through sherpa-onnx, ~100 MB, int8).
Nothing here needs a Gemini key, so the wake word costs no quota and no room audio leaves the computer.
"""
import os, io, sys, tarfile, threading, time, urllib.request

import numpy as np

MODEL_NAME = os.environ.get("PARU_ASR_MODEL", "tiny.en")          # tiny.en (fast) | base.en (more accurate)
URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-%s.tar.bz2"
SAMPLE_RATE = 16000

STATUS = {"state": "idle", "pct": 0, "error": "", "model": MODEL_NAME}   # idle | downloading | loading | ready | error
_lock = threading.Lock()
_rec = None


def model_dir(base):
    return os.path.join(base, "models", "whisper-" + MODEL_NAME)


def _files(d):
    n = MODEL_NAME
    return (os.path.join(d, f"{n}-encoder.int8.onnx"), os.path.join(d, f"{n}-decoder.int8.onnx"),
            os.path.join(d, f"{n}-tokens.txt"))


def installed(base):
    return all(os.path.exists(f) for f in _files(model_dir(base)))


def download(base):
    """Download + unpack the model (only the int8 files are kept). Safe to call twice."""
    d = model_dir(base)
    if installed(base):
        return
    os.makedirs(d, exist_ok=True)
    STATUS.update(state="downloading", pct=0, error="")
    tmp = os.path.join(d, "download.tar.bz2")
    req = urllib.request.Request(URL % MODEL_NAME, headers={"User-Agent": "paru"})
    with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
            got += len(b)
            if total:
                STATUS["pct"] = int(got * 90 / total)
    keep = {os.path.basename(p) for p in _files(d)}
    with tarfile.open(tmp, "r:bz2") as t:
        for m in t:
            if m.isfile() and os.path.basename(m.name) in keep:
                m.name = os.path.basename(m.name)          # flatten, and never write outside d
                t.extract(m, d)
    os.remove(tmp)
    STATUS["pct"] = 100


def load(base):
    """Return the recognizer, downloading the model first if needed. Thread-safe."""
    global _rec
    with _lock:
        if _rec is not None:
            return _rec
        try:
            download(base)
            STATUS.update(state="loading")
            import sherpa_onnx
            enc, dec, tok = _files(model_dir(base))
            _rec = sherpa_onnx.OfflineRecognizer.from_whisper(
                encoder=enc, decoder=dec, tokens=tok, language="en", task="transcribe",
                num_threads=max(1, min(4, (os.cpu_count() or 2) - 1 or 1)))
            STATUS.update(state="ready", error="")
        except Exception as e:                                  # network down, disk full, bad install ...
            STATUS.update(state="error", error=str(e)[:200])
            raise
        return _rec


def transcribe(base, pcm):
    """pcm: float32 mono 16 kHz in [-1, 1]. Returns the transcript ('' when nothing was heard)."""
    rec = load(base)
    x = np.asarray(pcm, dtype=np.float32)
    if len(x) < 1600:
        return ""
    x = np.concatenate([np.zeros(3200, np.float32), x, np.zeros(4800, np.float32)])   # lead/tail padding: Whisper clips abrupt starts
    s = rec.create_stream()
    s.accept_waveform(SAMPLE_RATE, x)
    rec.decode_stream(s)
    t = s.result.text.strip()
    # Whisper sometimes loops ("Turn off the lights. Turn off the lights. ...") on short clips: cut the repeats
    return _dedupe(t)


def _dedupe(t):
    prev = None
    while t != prev:                                        # loops can be nested (4 x "Turn off Peru")
        prev, t = t, _dedupe1(t)
    return t


def _dedupe1(t):
    w = t.split()
    h = len(w) // 2
    if h and len(w) % 2 == 0 and [x.lower().strip(".,!?") for x in w[:h]] == [x.lower().strip(".,!?") for x in w[h:]]:
        return " ".join(w[:h])                              # "Shut up. Shut up." -> "Shut up."
    for n in range(1, min(8, len(w) // 2) + 1):
        if len(w) >= 3 * n and w[:n] == w[n:2 * n] == w[2 * n:3 * n]:
            return " ".join(w[:n])
    return t


def pcm16_to_f32(raw):
    return np.frombuffer(raw[: len(raw) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0


def pcm_to_wav(raw, rate=SAMPLE_RATE):
    """int16 PCM bytes -> a WAV file (what Gemini accepts)."""
    import struct
    return (b"RIFF" + struct.pack("<I", 36 + len(raw)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16)
            + b"data" + struct.pack("<I", len(raw)) + raw)
