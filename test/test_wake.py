"""Unit tests for agent/wake.py: no model, no network. Transcripts are what the local recognizer really produced for the test voices."""
import os, sys, pytest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "agent"))
from wake import Wake
W = Wake()
k = lambda t, s=False: W.classify(t, session=s)["kind"]

@pytest.mark.parametrize("t", ["Hello Paru", "Hello Peru", "Hey, Paro.", "Hi Paru", "Okay, Parroo", "hello pero", "Hey Para", "Hello, Parou.", "hello pa ru", "Hyperoo"])
def test_wake(t): assert k(t) == "wake"

def test_wake_with_request():
    r = W.classify("Hello Paru what is the weather"); assert r["kind"] == "wake" and r["rest"] == "what is the weather"

@pytest.mark.parametrize("t", ["hello everyone", "hello there my friend", "What time is the meeting?", "I paid for it", "Turn off the lights", "stop at the shop", "paper roll please", "hello Paula", "the party was fun", "Hello Pam, how are you?", "she said hello to Paul"])
def test_idle_ignores_other_speech(t): assert k(t) not in ("wake", "off", "stop")

@pytest.mark.parametrize("t", ["Shut up.", "Stop", "Be quiet", "That's all", "Enough", "Shut up, Peru.", "Stop it", "he quiet"])
def test_stop_in_session(t): assert k(t, True) == "stop"

@pytest.mark.parametrize("t", ["Turn off Paru", "Turn off Peru", "Turn off power.", "Turn off Peri", "Switch off Paru", "go to sleep", "stop listening", "Turn Paru off", "Turn off Peru Turn off Peru Turn off Peru"])
def test_off_in_session(t):
    from asr import _dedupe
    assert k(_dedupe(t), True) == "off"

@pytest.mark.parametrize("t", ["stop at the shop", "stop the music at five", "turn off the lights", "turn off the TV", "what is the weather", "shut up and listen to this long story about my day"])
def test_session_keeps_real_requests(t): assert k(t, True) not in ("stop", "off")

def test_off_while_hidden_needs_the_name():
    assert k("turn off Paru") == "off" and k("turn off power") != "off" and k("go to sleep") != "off"

def test_stop_is_ignored_when_nothing_is_open():
    assert k("shut up") == "none"

def test_learn_alias(tmp_path):
    w = Wake(str(tmp_path / "a.json")); assert w.classify("hello Zorro")["kind"] != "wake"
    assert "zorro" in w.learn(["hello Zorro"]) and w.classify("hello Zorro")["kind"] == "wake"
    assert Wake(str(tmp_path / "a.json")).classify("hey zorro")["kind"] == "wake"        # persisted
    w.forget(); assert w.classify("hello Zorro")["kind"] != "wake"
