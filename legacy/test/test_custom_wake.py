"""Custom wake / off phrases (any phrase the person picks). Uses transcripts the real recogniser wrote for 12 different voices
saying 5 different phrases (test/custom_transcripts.json), so no model is needed. Each voice 'teaches' with 3 takes and is tested on 4 others."""
import os, sys, json, collections
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "agent"))
from wake import Wake
from asr import _dedupe
D = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "custom_transcripts.json")))
for d in D: d["text"] = _dedupe(d["text"])
PAIRS = [("hey jarvis", "goodbye jarvis"), ("hello buddy", "bye buddy"), ("okay nova", "turn off nova"), ("hey computer", "computer off"), ("hey chandru", "bye chandru")]
LOOKALIKES = {"hey travis", "hello body", "okay now", "hey commuter", "hey chandler"}            # sound (nearly) the same: cannot and should not be told apart
ORDINARY = [d["text"] for d in D if d["kind"] == "neg" and d["phrase"] not in LOOKALIKES]

def run(wp, op, learn=True):
    hit = collections.Counter(); tot = collections.Counter(); fp = 0
    for sid in {d["sid"] for d in D}:
        W = Wake(); W.configure(wp, op)
        for kind, ph in (("wake", wp), ("off", op)):
            takes = sorted((d for d in D if d["sid"] == sid and d["phrase"] == ph), key=lambda d: d["take"])
            if learn: W.learn_phrase(kind, [t["text"] for t in takes if t["take"] < 3])
        for kind, ph in (("wake", wp), ("off", op)):
            for t in (d for d in D if d["sid"] == sid and d["phrase"] == ph and d["take"] >= 3):
                tot[kind] += 1; hit[kind] += W.classify(t["text"])["kind"] == kind
        fp += sum(W.classify(x)["kind"] in ("wake", "off") for x in ORDINARY)
    return hit, tot, fp

def test_any_phrase_is_recognised_for_most_takes():
    for wp, op in PAIRS:
        h, t, _ = run(wp, op)
        assert h["wake"] / t["wake"] >= 0.78, (wp, h, t)
        assert h["off"] / t["off"] >= 0.78, (op, h, t)

def test_ordinary_speech_never_triggers():
    for wp, op in PAIRS:
        assert run(wp, op)[2] == 0, wp

def test_teaching_never_hurts():
    for wp, op in PAIRS:
        a, ta, _ = run(wp, op, learn=False); b, tb, _ = run(wp, op, learn=True)
        assert b["wake"] >= a["wake"] and b["off"] >= a["off"]

def test_wake_and_off_sharing_a_name_are_told_apart():
    W = Wake(); W.configure("hey chandru", "bye chandru")
    assert W.classify("Hey Chandra")["kind"] == "wake" and W.classify("Bye Chandra")["kind"] == "off"

def test_wake_phrase_with_a_request():
    W = Wake(); W.configure("hey jarvis", "goodbye jarvis"); r = W.classify("Hey Jarvis what is the weather today")
    assert r["kind"] == "wake" and r["rest"] == "what is the weather today"

def test_changing_the_phrase_forgets_the_old_teaching(tmp_path):
    W = Wake(str(tmp_path / "w.json")); W.configure("hey jarvis", "goodbye jarvis"); W.learn_phrase("wake", ["Hey Jervis"])
    assert W.classify("Hey Jervis")["kind"] == "wake"
    W.configure("okay nova", None); assert W.classify("Hey Jervis")["kind"] != "wake" and W.classify("okay nova")["kind"] == "wake"
    assert Wake(str(tmp_path / "w.json")).classify("okay nova")["kind"] == "wake"           # survives a restart
