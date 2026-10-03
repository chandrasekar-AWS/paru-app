"""Any-provider support: key verification, OpenAI / Claude / OpenAI-compatible calls, voice through the on-device recogniser.
cd test && PARU_TEST_MODEL_DIR=... python -m pytest -q test_llm.py"""
import os, sys, glob, wave, shutil, socket, subprocess, tempfile, time, json
import httpx, pytest
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); sys.path.insert(0, HERE)
import mock_providers, mock_gemini
KEY = "k3y"; FIX = os.path.join(HERE, "fixtures")
H = {"x-key": KEY}
def pcm(n):
    w = wave.open(os.path.join(FIX, n)); b = w.readframes(w.getnframes()); w.close(); return b
def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

@pytest.fixture(scope="module")
def env():
    pp, gp = free_port(), free_port(); mock_providers.start(pp); mock_gemini.start(gp)
    tmp = tempfile.mkdtemp(prefix="paru-llm-"); d = os.path.join(tmp, "agent")
    shutil.copytree(os.path.join(ROOT, "agent"), d, ignore=shutil.ignore_patterns("__pycache__", "models", "env.txt", "*.db", "profile.json", "wake_aliases.json"))
    m = os.environ.get("PARU_TEST_MODEL_DIR")
    if m: os.makedirs(os.path.join(d, "models")); os.symlink(m, os.path.join(d, "models", "whisper-tiny.en"))
    open(os.path.join(d, "env.txt"), "w").write(f"VOICE_KEY={KEY}\nOWNER_NAME=Tester\nTIMEZONE=Asia/Kolkata\n")      # NO Gemini key: the provider comes from the app
    port = free_port(); p = subprocess.Popen([sys.executable, "-m", "uvicorn", "agent:app", "--port", str(port), "--log-level", "warning"], cwd=d, env={**os.environ, "GEMINI_BASE": f"http://127.0.0.1:{gp}/v1beta"})
    base = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            if httpx.get(base + "/health", timeout=2).json()["asr"]["state"] in ("ready", "error"): break
        except Exception: pass
        time.sleep(1)
    yield {"base": base, "p": f"http://127.0.0.1:{pp}", "g": f"http://127.0.0.1:{gp}/v1beta"}
    p.kill(); shutil.rmtree(tmp, ignore_errors=True)

def verify(env, id, key, base="", model=""):
    return httpx.post(env["base"] + "/voice/provider/verify", headers=H, json={"id": id, "key": key, "base": base, "model": model}, timeout=30).json()

def test_catalog_lists_many_providers(env):
    ids = {p["id"] for p in httpx.get(env["base"] + "/voice/providers", headers=H).json()["providers"]}
    assert {"gemini", "openai", "anthropic", "openrouter", "groq", "deepseek", "ollama", "custom"} <= ids

def test_verify_real_key_ok_and_picks_a_chat_model(env):
    r = verify(env, "openai", "good", env["p"] + "/v1")
    assert r["ok"] and r["model"] == "gpt-4o-mini" and "whisper-1" in r["models"]
    r = verify(env, "anthropic", "good", env["p"] + "/anthropic/v1")
    assert r["ok"] and "haiku" in r["model"]

def test_verify_fake_key_is_rejected(env):
    for pid, base in (("openai", "/v1"), ("anthropic", "/anthropic/v1")):
        r = verify(env, pid, "sk-fake-key-not-real", env["p"] + base)
        assert not r["ok"] and "not valid" in r["error"]
    assert not verify(env, "openai", "")["ok"]

def test_verify_unreachable_is_explained(env):
    r = verify(env, "custom", "x", "http://127.0.0.1:9/v1")
    assert not r["ok"] and r.get("network")
    r = verify(env, "ollama", "", "http://127.0.0.1:9/v1")
    assert not r["ok"] and "running" in r["error"]

def test_keyless_local_provider_needs_no_key(env):
    r = verify(env, "lmstudio", "", env["p"] + "/local/v1")
    assert r["ok"]

def test_detect_guess(env):
    g = lambda k: verify(env, "openai", k, env["p"] + "/v1")["guess"]
    assert g("sk-ant-api03-abcdefghijklmnopqrstuvwxyz") == "anthropic" and g("AIzaSyA1234567890abcdefghijklmnopqrstu") == "gemini" and g("gsk_abcdefghijklmnopqrstuvwxyz1234") == "groq" and g("sk-or-v1-abcdefghijklmnopqrstuvwxyz") == "openrouter"

def test_no_key_means_a_clear_message(env):
    r = httpx.post(env["base"] + "/voice/text", headers=H, json={"text": "hello"}, timeout=20).json()
    assert "AI key" in (r.get("text") or r.get("error") or "") or r.get("error")

def test_openai_provider_answers_text(env):
    mock_providers.ANSWER.update(answer="Hi from GPT.")
    assert httpx.post(env["base"] + "/voice/provider", headers=H, json={"id": "openai", "key": "good", "base": env["p"] + "/v1"}).json()["ready"]
    mock_providers.REQ.clear()
    r = httpx.post(env["base"] + "/voice/text", headers=H, json={"text": "what is 2+2"}, timeout=30).json()
    assert r["text"] == "Hi from GPT."
    q = mock_providers.REQ[-1]; assert q["headers"]["authorization"] == "Bearer good" and q["body"]["model"] == "gpt-4o-mini"
    assert q["body"]["messages"][0]["role"] == "system" and q["body"]["messages"][-1]["content"] == "what is 2+2"

def test_claude_provider_uses_claude_format(env):
    mock_providers.ANSWER.update(answer="Hi from Claude.")
    httpx.post(env["base"] + "/voice/provider", headers=H, json={"id": "anthropic", "key": "good", "base": env["p"] + "/anthropic/v1"})
    mock_providers.REQ.clear()
    assert httpx.post(env["base"] + "/voice/text", headers=H, json={"text": "hello"}, timeout=30).json()["text"] == "Hi from Claude."
    q = mock_providers.REQ[-1]; assert q["headers"]["x-api-key"] == "good" and "system" in q["body"] and q["body"]["messages"][0]["role"] == "user" and "claude" in q["body"]["model"]

def test_wrong_key_at_call_time_gives_friendly_error(env):
    httpx.post(env["base"] + "/voice/provider", headers=H, json={"id": "openai", "key": "revoked", "base": env["p"] + "/v1"})
    r = httpx.post(env["base"] + "/voice/text", headers=H, json={"text": "hello"}, timeout=30).json()
    assert "AI key" in json.dumps(r) or "rejected" in json.dumps(r)

@pytest.mark.skipif(not os.environ.get("PARU_TEST_MODEL_DIR"), reason="needs the speech model")
def test_voice_with_a_provider_that_cannot_hear(env):
    """OpenAI/Claude cannot take audio: the on-device recogniser writes the words and only TEXT goes to the provider."""
    mock_providers.ANSWER.update(answer="The meeting is at three.")
    httpx.post(env["base"] + "/voice/provider", headers=H, json={"id": "openai", "key": "good", "base": env["p"] + "/v1"})
    mock_providers.REQ.clear()
    r = httpx.post(env["base"] + "/voice/audio?wake=0", headers={**H, "Content-Type": "audio/L16"}, content=pcm("neg_what_time_is_the_meeting_0.wav"), timeout=40).json()
    assert r["text"] == "The meeting is at three." and "meeting" in mock_providers.REQ[-1]["body"]["messages"][-1]["content"].lower()
    r = httpx.post(env["base"] + "/voice/audio?wake=0", headers={**H, "Content-Type": "audio/L16"}, content=pcm("stop_shut_up_0.wav"), timeout=40).json()
    assert r["action"]["type"] == "stop"
    mock_providers.REQ.clear()
    r = httpx.post(env["base"] + "/voice/audio?wake=1", headers={**H, "Content-Type": "audio/L16"}, content=pcm("wake_hello_paru_what_is_the_weather_0.wav"), timeout=40).json()
    assert r["kind"] == "wake" and len(mock_providers.REQ) == 1 and "weather" in mock_providers.REQ[0]["body"]["messages"][-1]["content"].lower()

def test_gemini_still_works_through_the_app_path(env):
    mock_gemini.SCRIPT.update(answer="Gemini here.", heard="x", delay=0)
    assert httpx.post(env["base"] + "/voice/provider", headers=H, json={"id": "gemini", "key": "test", "base": env["g"]}).json()["ready"]
    assert httpx.post(env["base"] + "/voice/text", headers=H, json={"text": "hello"}, timeout=30).json()["text"] == "Gemini here."

def test_profile_and_custom_wake_phrase(env):
    r = httpx.post(env["base"] + "/voice/config", headers=H, json={"wake": "hey jarvis", "off": "goodbye jarvis", "assistant": "Jarvis", "owner": "Chandru"}).json()
    assert r["wake"] == "hey jarvis" and r["assistant"] == "Jarvis"
    assert httpx.get(env["base"] + "/voice/config", headers=H).json()["owner"] == "Chandru"
