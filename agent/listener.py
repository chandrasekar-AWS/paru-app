"""Always-on voice pipeline: mic audio (16 kHz mono int16 from the UI) -> VAD -> Whisper -> wake word -> agent.

Audio is captured by the UI (works in Electron, a browser, and an Android WebView), so no PortAudio / sounddevice
dependency exists on the server. Whisper and speaker-ID are optional: if they're missing, the engine still starts
and /api/status says exactly what's missing.
"""
import difflib, queue, re, threading, time
import numpy as np
from . import config, events, llm

SR = 16000
FRAME = 480                      # 30 ms
MIN_SPEECH_FRAMES = 4            # ~120 ms of voice to start a segment
MAX_SEG_SEC = 20


def norm(t):
    return re.sub(r"[^\w\s]", " ", t.lower(), flags=re.UNICODE).split()


def find_wake(text, wake_words):
    """Return (found, remainder_after_wake_word). Fuzzy because Whisper spells 'Alexi' many ways."""
    toks = norm(text)
    for i, tk in enumerate(toks):
        for w in wake_words:
            if tk == w or (len(tk) >= 4 and difflib.SequenceMatcher(None, tk, w).ratio() >= 0.78):
                rest = " ".join(toks[i + 1:])
                return True, rest
    return False, ""


def is_stop(text, stop_words):
    flat = " ".join(norm(text))
    return any(" ".join(norm(w)) in flat for w in stop_words)


class Transcriber:
    def __init__(self):
        self._model = None
        self._name = None
        self.error = None
        self._lock = threading.Lock()

    def available(self):
        try:
            import faster_whisper  # noqa
            return True, ""
        except Exception as e:
            return False, "Speech recognition isn't installed. Run: pip install faster-whisper"

    def transcribe(self, audio):
        ok, why = self.available()
        if not ok:
            return ""
        s = config.load()
        with self._lock:
            if self._model is None or self._name != s["whisper_model"]:
                from faster_whisper import WhisperModel
                self._model = WhisperModel(s["whisper_model"], device="auto", compute_type="int8")
                self._name = s["whisper_model"]
        lang = None if s["language"] == "auto" else s["language"]
        segs, _ = self._model.transcribe(audio, language=lang, vad_filter=True, beam_size=1, temperature=0.0,
                                         condition_on_previous_text=False, no_speech_threshold=0.6,
                                         initial_prompt="Alexi. Hey Alexi, shut up.")
        return " ".join(sg.text.strip() for sg in segs).strip()


class VoiceID:
    """Optional 'only my voice' check using Resemblyzer. Convenience filter, NOT a security feature."""
    def __init__(self):
        self._enc = None
        self.ref = None
        f = config.HOME / "voice.npy"
        if f.exists():
            try:
                self.ref = np.load(f)
            except Exception:
                self.ref = None

    def available(self):
        try:
            import resemblyzer  # noqa
            return True
        except Exception:
            return False

    def _embed(self, audio):
        if self._enc is None:
            from resemblyzer import VoiceEncoder
            self._enc = VoiceEncoder(device="cpu")
        from resemblyzer import preprocess_wav
        return self._enc.embed_utterance(preprocess_wav(audio, source_sr=SR))

    def enroll(self, audio):
        if not self.available():
            raise RuntimeError("Voice recognition isn't installed. Run: pip install resemblyzer")
        e = self._embed(audio)
        self.ref = e
        np.save(config.HOME / "voice.npy", e)

    def is_owner(self, audio):
        if self.ref is None or not self.available() or len(audio) < 0.8 * SR:
            return True
        try:
            e = self._embed(audio)
            sim = float(np.dot(e, self.ref) / (np.linalg.norm(e) * np.linalg.norm(self.ref) + 1e-9))
            return sim >= 0.72
        except Exception:
            return True


class Listener:
    def __init__(self, transcriber=None, voice_id=None):
        self.asr = transcriber or Transcriber()
        self.vid = voice_id or VoiceID()
        self.state = "idle"                 # idle (waiting for wake word) | active (orb shown, conversation)
        self.muted_until = 0.0
        self._buf = np.zeros(0, np.int16)
        self._seg = []
        self._in_speech = False
        self._voiced = 0
        self._silence = 0
        self._noise = 300.0
        self._q = queue.Queue(maxsize=8)
        self._enroll = None
        self._ptt = None
        threading.Thread(target=self._worker, daemon=True, name="asr").start()

    # --------------------------------------------------------------- state
    def set_state(self, st):
        if st == self.state:
            return
        self.state = st
        events.publish("orb", visible=(st == "active"), state=st)

    def speaking(self, on):
        # ignore the mic while Paru talks, plus a short tail for room echo
        self.muted_until = time.time() + 3600 if on else time.time() + 0.8
        if on:
            self._reset_seg()

    def _reset_seg(self):
        self._seg, self._in_speech, self._voiced, self._silence = [], False, 0, 0

    # --------------------------------------------------------------- audio in
    def feed(self, pcm: bytes):
        if self._enroll is not None:
            self._enroll.append(np.frombuffer(pcm, np.int16).copy())
            return
        if self._ptt is not None:
            self._ptt.append(np.frombuffer(pcm[: len(pcm) // 2 * 2], np.int16).copy())
            return
        cfg = config.load()
        if time.time() < self.muted_until or not cfg["listen_in_background"] or not cfg["permissions"]["microphone"]:
            return
        self._buf = np.concatenate([self._buf, np.frombuffer(pcm[: len(pcm) // 2 * 2], np.int16)])
        end_sil = 24 if self.state == "active" else 16     # frames of silence that close a segment
        while len(self._buf) >= FRAME:
            fr, self._buf = self._buf[:FRAME], self._buf[FRAME:]
            rms = float(np.sqrt(np.mean(fr.astype(np.float32) ** 2)))
            voiced = rms > max(self._noise * 2.2, 450)
            if not voiced and not self._in_speech:
                self._noise = 0.95 * self._noise + 0.05 * rms
            if self._in_speech:
                self._seg.append(fr)
                self._silence = 0 if voiced else self._silence + 1
                if self._silence >= end_sil or len(self._seg) * FRAME > MAX_SEG_SEC * SR:
                    self._finish()
            else:
                self._voiced = self._voiced + 1 if voiced else 0
                self._seg = (self._seg + [fr])[-8:]          # keep a little pre-roll
                if self._voiced >= MIN_SPEECH_FRAMES:
                    self._in_speech, self._silence = True, 0

    def _finish(self):
        seg = np.concatenate(self._seg)
        self._reset_seg()
        if len(seg) < 0.25 * SR:
            return
        try:
            self._q.put_nowait(seg)
        except queue.Full:
            pass

    # --------------------------------------------------------------- enrollment
    def enroll_start(self):
        self._enroll = []

    def enroll_stop(self):
        chunks, self._enroll = self._enroll or [], None
        audio = np.concatenate(chunks).astype(np.float32) / 32768 if chunks else np.zeros(0, np.float32)
        if len(audio) < 2.5 * SR:
            raise RuntimeError("That was too short. Please read the whole sentence.")
        self.vid.enroll(audio)
        return True

    # --------------------------------------------------------------- voice notes (hold the mic button)
    def ptt_start(self):
        self._reset_seg()
        self._ptt = []

    def ptt_stop(self):
        chunks, self._ptt = self._ptt or [], None
        if not chunks:
            return ""
        audio = np.concatenate(chunks).astype(np.float32) / 32768
        if len(audio) < 0.4 * SR:
            return ""
        return self.asr.transcribe(audio)

    # --------------------------------------------------------------- worker
    def _worker(self):
        while True:
            seg = self._q.get()
            try:
                self.process_segment(seg.astype(np.float32) / 32768)
            except Exception as e:
                events.publish("status", error=f"Voice engine error: {type(e).__name__}: {e}")

    def process_segment(self, audio):
        s = config.load()
        if s["only_my_voice"] and not self.vid.is_owner(audio):
            return
        text = self.asr.transcribe(audio)
        if text:
            self.on_text(text)

    def on_text(self, text):
        """Wake-word / stop-word state machine. Separate from audio so it is unit-testable."""
        s = config.load()
        if self.state == "idle":
            found, rest = find_wake(text, s["wake_words"])
            if not found:
                return
            self.set_state("active")
            events.publish("wake")
            if len(rest) > 2 and not is_stop(rest, s["stop_words"]):
                llm.handle(rest, "voice")
            return
        if is_stop(text, s["stop_words"]):
            self.set_state("idle")
            events.publish("stopped")
            return
        found, rest = find_wake(text, s["wake_words"])
        llm.handle(rest if found and len(rest) > 2 else text, "voice")

    # manual triggers (hotkey / "Talk" button)
    def activate(self):
        self.set_state("active")
        events.publish("wake")

    def deactivate(self):
        self.set_state("idle")
        events.publish("stopped")
