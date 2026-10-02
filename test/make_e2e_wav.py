"""Builds the 'microphone' recording used by e2e.js: room noise with speech clips at known times. Prints the timeline as JSON."""
import wave, sys, json, numpy as np, os
H = os.path.dirname(os.path.abspath(__file__)); F = H + "/fixtures/"
def clip(n):
    w = wave.open(F + n); x = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(np.float32) / 32768; w.close(); return x
rng = np.random.default_rng(3)
noise = lambda s: rng.standard_normal(int(16000 * s)).astype(np.float32) * 0.004
plan = [("gap", 3.0), ("wake_hello_paru_0.wav", "wake1"), ("gap", 2.5), ("neg_what_time_is_the_meeting_0.wav", "question"), ("gap", 9.0),
        ("stop_shut_up_0.wav", "shutup"), ("gap", 4.0), ("wake_hello_paru_1.wav", "wake2"), ("gap", 3.0), ("off_turn_off_paru_1.wav", "off"), ("gap", 5.0)]
out, t, tl = [], 0.0, {}
for a, b in plan:
    x = noise(b) if a == "gap" else clip(a)
    if a != "gap": tl[b] = round(t, 2)
    out.append(x); t += len(x) / 16000
y = np.concatenate(out); pcm = (np.clip(y, -1, 1) * 32767).astype("<i2")
w = wave.open(sys.argv[1], "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000); w.writeframes(pcm.tobytes()); w.close()
print(json.dumps({"timeline": tl, "seconds": round(t, 1)}))
