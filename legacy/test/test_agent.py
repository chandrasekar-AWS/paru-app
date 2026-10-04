"""End-to-end tests of the Python agent over real HTTP, with real speech clips (test/fixtures/*.wav).
Gemini is replaced by test/mock_gemini.py. The local speech model is used for real (set PARU_TEST_MODEL_DIR, or let it download).
Run:  cd test && python -m pytest -v -s test_agent.py"""
import os, sys, time, glob, wave, shutil, socket, subprocess, tempfile, json
import httpx, pytest

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import mock_gemini

KEY = "testkey"
FIX = os.path.join(HERE, "fixtures")


def pcm(name):
    w = wave.open(os.path.join(FIX, name)); b = w.readframes(w.getnframes()); w.close(); return b


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


@pytest.fixture(scope="session")
def agent():
    gport = free_port(); mock_gemini.start(gport)
    tmp = tempfile.mkdtemp(prefix="paru-agent-"); d = os.path.join(tmp, "agent"); shutil.copytree(os.path.join(ROOT, "agent"), d, ignore=shutil.ignore_patterns("__pycache__", "models", "env.txt", "*.db"))
    mdir = os.environ.get("PARU_TEST_MODEL_DIR")
    if mdir:
        os.makedirs(os.path.join(d, "models"), exist_ok=True); os.symlink(mdir, os.path.join(d, "models", "whisper-tiny.en"))
    open(os.path.join(d, "env.txt"), "w").write(f"VOICE_KEY={KEY}\nGEMINI_API_KEY=test\nOWNER_NAME=Tester\nTIMEZONE=Asia/Kolkata\n")
    port = free_port(); env = {**os.environ, "GEMINI_BASE": f"http://127.0.0.1:{gport}/v1beta"}
    p = subprocess.Popen([sys.executable, "-m", "uvicorn", "agent:app", "--port", str(port), "--log-level", "warning"], cwd=d, env=env)
    base = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            h = httpx.get(base + "/health", timeout=2).json()
            if h["asr"]["state"] in ("ready", "error"):
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        p.kill(); pytest.fail("agent did not start")
    yield base
    p.kill(); shutil.rmtree(tmp, ignore_errors=True)


def post(base, name, wake, key=KEY, raw=None):
    t = time.time()
    r = httpx.post(f"{base}/voice/audio?wake={wake}", content=raw if raw is not None else pcm(name), headers={"x-key": key, "Content-Type": "audio/L16"}, timeout=40)
    return r, time.time() - t


def test_health_needs_no_key_and_hides_nothing(agent):
    h = httpx.get(agent + "/health").json()
    assert h["ok"] and h["asr"]["state"] == "ready" and "key" not in json.dumps(h).replace("key_set", "")


def test_wrong_key_rejected(agent):
    assert httpx.post(agent + "/voice/audio?wake=1", content=b"0" * 20000, headers={"x-key": "nope"}).status_code == 401
    assert httpx.get(agent + "/voice/history").status_code == 401


def test_cors_preflight_for_phone_app(agent):
    r = httpx.options(agent + "/voice/audio", headers={"Origin": "http://localhost", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-key,content-type"})
    assert r.status_code == 200 and r.headers.get("access-control-allow-origin") == "*"


def test_wake_word_hello_paru(agent):
    files = sorted(glob.glob(FIX + "/wake_hello_paru_*.wav") + glob.glob(FIX + "/wake_hey_paru_*.wav"))
    hits, lat = 0, []
    for f in files:
        mock_gemini.CALLS.clear()
        r, dt = post(agent, os.path.basename(f), 1); j = r.json(); lat.append(dt)
        if j["kind"] == "wake":
            hits += 1
    print(f"\n  wake hits {hits}/{len(files)}  avg latency {sum(lat)/len(lat):.2f}s")
    assert hits >= len(files) * 0.7


def test_plain_hello_paru_makes_no_cloud_call(agent):
    f = sorted(glob.glob(FIX + "/wake_hello_paru_[0-9].wav"))
    for name in f:
        mock_gemini.CALLS.clear()
        j = post(agent, os.path.basename(name), 1)[0].json()
        if j["kind"] == "wake":
            assert j["greeting"] and not j["text"] and not mock_gemini.CALLS, "greeting-only wake must be local and free"
            return
    pytest.fail("no clip woke")


def test_hello_paru_with_request_answers_in_one_call(agent):
    mock_gemini.SCRIPT.update(answer="Sunny, 31 degrees.", action={"type": "none", "target": ""}, heard="hello paru what is the weather", delay=0)
    for name in sorted(glob.glob(FIX + "/wake_hello_paru_what_is_the_weather_*.wav")):
        mock_gemini.CALLS.clear()
        j = post(agent, os.path.basename(name), 1)[0].json()
        if j["kind"] == "wake" and j["text"]:
            assert j["text"] == "Sunny, 31 degrees." and len(mock_gemini.CALLS) == 1
            return
    pytest.fail("never answered")


def test_idle_ignores_everything_else_and_never_calls_cloud(agent):
    names = [os.path.basename(f) for f in glob.glob(FIX + "/neg_*.wav")]
    assert names
    mock_gemini.CALLS.clear(); bad = []
    for n in names:
        j = post(agent, n, 1)[0].json()
        if j["kind"] != "none":
            bad.append((n, j["heard"], j["kind"]))
    print("\n  idle false triggers:", bad)
    assert len(bad) <= 1                       # "hello everyone" style phrases may be 'weak' -> cloud-checked; nothing should *wake*
    assert not any(b[2] == "wake" for b in bad)


def test_shut_up_is_instant_and_local(agent):
    mock_gemini.SCRIPT.update(delay=3.0)       # a slow cloud must not slow "shut up" down
    ok, lat = 0, []
    names = [os.path.basename(f) for f in glob.glob(FIX + "/stop_*.wav") if "shut_up" in f or "stop_" in f.split("/")[-1][:6] or "be_quiet" in f]
    for n in names:
        j, dt = post(agent, n, 0); j = j.json(); lat.append(dt)
        if j["action"]["type"] == "stop":
            ok += 1
    mock_gemini.SCRIPT.update(delay=0)
    print(f"\n  stop {ok}/{len(names)} avg {sum(lat)/len(lat):.2f}s (cloud was delayed 3s)")
    assert ok >= len(names) * 0.85 and sum(lat) / len(lat) < 1.5


def test_turn_off_paru(agent):
    ok = 0; names = [os.path.basename(f) for f in glob.glob(FIX + "/off_*.wav")]
    for n in names:
        if post(agent, n, 0)[0].json()["action"]["type"] == "sleep":
            ok += 1
    print(f"\n  turn off (open session) {ok}/{len(names)}")
    assert ok >= len(names) * 0.75


def test_turn_off_paru_while_idle(agent):
    ok = 0; names = [os.path.basename(f) for f in glob.glob(FIX + "/off_*.wav")]
    for n in names:
        if post(agent, n, 1)[0].json()["kind"] == "off":
            ok += 1
    print(f"\n  turn off (orb hidden) {ok}/{len(names)}")
    assert ok >= len(names) * 0.5


def test_normal_question_in_open_session_goes_to_gemini(agent):
    mock_gemini.SCRIPT.update(answer="The meeting is at three.", action={"type": "none", "target": ""}, heard="what time is the meeting", delay=0)
    mock_gemini.CALLS.clear()
    j = post(agent, "neg_what_time_is_the_meeting_0.wav", 0)[0].json()
    assert j["text"] == "The meeting is at three." and j["kind"] == "talk" and mock_gemini.CALLS[0]["audio"]


def test_stop_phrase_inside_a_sentence_is_not_a_stop(agent):
    mock_gemini.SCRIPT.update(answer="Okay.", delay=0)
    j = post(agent, "neg_stop_at_the_shop_0.wav", 0)[0].json()
    assert j["action"]["type"] != "stop"
    j = post(agent, "neg_turn_off_the_lights_0.wav", 0)[0].json()
    assert j["action"]["type"] not in ("sleep", "stop")


def test_gemini_quota_error_is_reported_not_hung(agent):
    mock_gemini.SCRIPT.update(status=429)
    t = time.time(); j = post(agent, "neg_what_time_is_the_meeting_0.wav", 0)[0].json(); dt = time.time() - t
    mock_gemini.SCRIPT.pop("status")
    assert dt < 8, f"voice must fail fast, took {dt:.1f}s"
    assert j["text"] and ("busy" in j["text"] or "internet" in j["text"])


def test_learn_wake_aliases(agent):
    r = httpx.post(agent + "/voice/wake/learn", headers={"x-key": KEY}, json={"samples": [__import__("base64").b64encode(pcm(os.path.basename(f))).decode() for f in sorted(glob.glob(FIX + "/wake_hello_paru_[0-9].wav"))[:3]]}).json()
    assert r["total"] == 3
    assert httpx.post(agent + "/voice/wake/forget", headers={"x-key": KEY}).json()["ok"]


def test_tts_cache_and_bad_voice(agent):
    assert httpx.get(agent + "/voice/tts?text=hi&voice=../../etc", headers={"x-key": KEY}).status_code == 400
    r = httpx.get(agent + "/voice/tts?text=hi&voice=en-US-AriaNeural", headers={"x-key": KEY}, timeout=30)
    assert r.status_code in (200, 503)         # 503 here: no internet to Microsoft's voice service and no espeak in this sandbox? (espeak is installed -> 200 wav)
    if r.status_code == 200:
        assert len(r.content) > 500


def test_text_chat_path(agent):
    mock_gemini.SCRIPT.update(answer="Hi Tester.", heard="hello", delay=0)
    j = httpx.post(agent + "/voice/text", headers={"x-key": KEY}, json={"text": "hello"}, timeout=20).json()
    assert j["text"] == "Hi Tester."
    assert any(i["text"] == "Hi Tester." for i in httpx.get(agent + "/voice/history", headers={"x-key": KEY}).json()["items"])
