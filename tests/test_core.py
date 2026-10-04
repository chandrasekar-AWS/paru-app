import json, time, types
import numpy as np
import httpx
import pytest
from agent import config, db, llm, skills, events
from agent.skills import agenda, mail, system, timers
from agent import listener as L

skills.load_all()


# ---------------------------------------------------------------- storage
def test_history_groups_by_local_day_midnight_boundary():
    import datetime as dt
    d1 = dt.datetime(2026, 10, 3, 23, 59, 30).timestamp()
    d2 = dt.datetime(2026, 10, 4, 0, 1, 0).timestamp()
    db.add_message("user", "late text", "text", ts=d1)
    db.add_message("user", "early voice", "voice", ts=d2)
    days = db.days()
    assert [d["label"] for d in days] == ["04-10-2026", "03-10-2026"]
    assert days[0]["voice"] == 1 and days[1]["text"] == 1
    assert db.messages("2026-10-03")[0]["content"] == "late text"


def test_settings_merge_and_secret_masking():
    config.save({"gemini_key": "AIza-secret", "mail": {"address": "a@b.c"}})
    s = config.load()
    assert s["mail"]["imap_host"] == "imap.gmail.com" and s["mail"]["address"] == "a@b.c"
    pub = config.public(s)
    assert pub["gemini_key"] == "••••••••" and "AIza" not in json.dumps(pub)


# ---------------------------------------------------------------- offline router
@pytest.mark.parametrize("text,tool,args", [
    ("set a timer for 5 minutes", "set_timer", {"seconds": 300}),
    ("timer 90 seconds", "set_timer", {"seconds": 90}),
    ("set timer for 2 hours", "set_timer", {"seconds": 7200}),
    ("check my mail", "check_mail", {}),
    ("any new email?", "check_mail", {}),
    ("what's on my calendar", "check_calendar", {"days": 1}),
    ("my schedule this week", "check_calendar", {"days": 7}),
    ("lock my screen", "lock_screen", {}),
    ("lock", "lock_screen", {}),
    ("open spotify", "launch_app", {"name": "spotify"}),
    ("close chrome", "close_app", {"name": "chrome"}),
    ("install vlc", "install_app", {"name": "vlc"}),
    ("uninstall vlc", "uninstall_app", {"name": "vlc"}),
    ("search for best laptops 2026", "web_search", {"query": "best laptops 2026"}),
    ("open github.com", "open_url", {"url": "github.com"}),
    ("download https://x.io/a.zip", "download_file", {"url": "https://x.io/a.zip"}),
    ("update the system", "update_system", {}),
    ("call +91 98765 43210", "make_call", {"number": "+91 98765 43210"}),
    ("what time is it", "get_time", {}),
])
def test_offline_router(text, tool, args):
    t, a = llm.route_offline(text)
    assert t == tool and a == args


def test_offline_router_unknown_returns_none():
    assert llm.route_offline("tell me a joke about cats") is None


# ---------------------------------------------------------------- timers
def test_timer_set_list_fire_cancel():
    r = skills.run("set_timer", {"seconds": 0.6, "label": "tea"})
    assert r["ok"] and "tea" in r["result"]
    assert "left" in skills.run("list_timers", {})["result"]
    q = events.subscribe()
    time.sleep(1.6)
    kinds = []
    while not q.empty():
        kinds.append(q.get_nowait())
    assert any(e["type"] == "notify" and "tea" in e["text"] for e in kinds)
    assert skills.run("list_timers", {})["result"] == "No active timers."
    skills.run("set_timer", {"seconds": 100})
    assert "Cancelled 1" in skills.run("cancel_timers", {})["result"]
    assert not skills.run("set_timer", {"seconds": 0})["ok"]


# ---------------------------------------------------------------- calendar
ICS = """BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Standup\\, daily
DTSTART:{t0}
DTEND:{t1}
RRULE:FREQ=DAILY;COUNT=5
END:VEVENT
BEGIN:VEVENT
SUMMARY:Dentist
DTSTART;VALUE=DATE:{d}
LOCATION:Clinic
END:VEVENT
BEGIN:VEVENT
SUMMARY:Old thing
DTSTART:20200101T100000Z
DTEND:20200101T110000Z
END:VEVENT
END:VCALENDAR
"""


def test_calendar_parses_recurring_allday_and_filters_old(tmp_path):
    import datetime as dt
    now = dt.datetime.now(dt.timezone.utc)
    t0 = (now + dt.timedelta(hours=1)).strftime("%Y%m%dT%H%M%SZ")
    t1 = (now + dt.timedelta(hours=2)).strftime("%Y%m%dT%H%M%SZ")
    f = tmp_path / "c.ics"
    f.write_text(ICS.format(t0=t0, t1=t1, d=dt.datetime.now().strftime("%Y%m%d")))
    config.save({"calendar_ics": str(f)})
    r = skills.run("check_calendar", {"days": 3})
    assert r["ok"] and "Standup, daily" in r["result"] and "Dentist" in r["result"] and "Old thing" not in r["result"]
    assert "all day" in r["result"]


def test_calendar_not_configured_message():
    r = skills.run("check_calendar", {})
    assert not r["ok"] and "iCal" in r["error"]


# ---------------------------------------------------------------- mail
class FakeIMAP:
    def __init__(self, host): pass
    def login(self, u, p): assert p == "apppass"
    def select(self, *a, **k): return "OK", [b"2"]
    def search(self, *a): return "OK", [b"1 2"]
    def fetch(self, i, what):
        raw = (b"From: Boss <boss@x.com>\r\nSubject: =?utf-8?q?Budget_review?=\r\nMessage-ID: <m%s@x>\r\n"
               b"Date: Fri, 03 Oct 2026 09:00:00 +0000\r\nContent-Type: text/plain\r\n\r\nPlease send the numbers today." % i)
        return "OK", [(b"1", raw)]
    def logout(self): pass


def test_mail_check_and_reply(monkeypatch):
    sent = []
    class FakeSMTP:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def login(self, u, p): pass
        def send_message(self, m): sent.append(m)
    monkeypatch.setattr(mail.imaplib, "IMAP4_SSL", FakeIMAP)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", FakeSMTP)
    assert "set up" in skills.run("check_mail", {})["error"]
    config.save({"mail": {"address": "me@x.com", "app_password": "apppass"}})
    r = skills.run("check_mail", {"limit": 2})
    assert r["ok"] and "Budget review" in r["result"] and r["mails"][0]["preview"].startswith("Please send")
    r = skills.run("send_reply", {"id": "2", "body": "On it."})
    assert r["ok"] and sent[0]["To"] == "boss@x.com" and sent[0]["Subject"] == "Re: Budget review"


# ---------------------------------------------------------------- system safety
def test_close_app_refuses_self():
    for n in ("paru", "python3", "Electron"):
        assert not skills.run("close_app", {"name": n})["ok"]


def test_unlock_is_honest():
    r = skills.run("unlock_screen", {})
    assert not r["ok"] and "password" in r["error"]


def test_launch_unknown_app_helpful():
    r = skills.run("launch_app", {"name": "zzz-no-such-app-xyz"})
    assert not r["ok"] and "install" in r["error"].lower()


def test_package_name_validation():
    r = system._pkg("install", "vlc; rm -rf /")
    assert not r["ok"]


def test_download_blocks_non_http():
    assert not skills.run("download_file", {"url": "file:///etc/passwd"})["ok"]


def test_open_url_blocks_javascript():
    assert not skills.run("open_url", {"url": "javascript:alert(1)"})["ok"]


def test_tool_exceptions_never_escape():
    r = skills.run("download_file", {"url": "http://127.0.0.1:1/x"})
    assert r["ok"] is False and "error" in r


# ---------------------------------------------------------------- gemini loop
def gemini_transport(script):
    calls = []
    def handler(req):
        body = json.loads(req.content)
        calls.append(body)
        return httpx.Response(200, json=script.pop(0))
    return httpx.MockTransport(handler), calls


def fc(name, args):
    return {"candidates": [{"content": {"role": "model", "parts": [{"functionCall": {"name": name, "args": args}}]}}]}


def txt(t):
    return {"candidates": [{"content": {"role": "model", "parts": [{"text": t}]}}]}


def test_gemini_tool_loop_runs_tool_then_answers():
    config.save({"gemini_key": "k"})
    llm._transport, calls = gemini_transport([fc("set_timer", {"seconds": 120, "label": "pasta"}), txt("Timer set for two minutes.")])
    assert llm.handle("set a pasta timer for 2 minutes", "text") == "Timer set for two minutes."
    fr = calls[1]["contents"][-1]["parts"][0]["functionResponse"]
    assert fr["name"] == "set_timer" and fr["response"]["content"]["ok"] is True
    assert calls[0]["tools"][0]["functionDeclarations"]
    assert [m["role"] for m in db.messages(db.day_key())] == ["user", "assistant"]


def test_risky_tool_requires_confirmation_then_runs(monkeypatch):
    ran = []
    monkeypatch.setitem(skills.REGISTRY["install_app"], "fn", lambda name: ran.append(name) or {"ok": True, "result": f"Installed {name}"})
    config.save({"gemini_key": "k"})
    llm._transport, _ = gemini_transport([fc("install_app", {"name": "vlc"}), txt("Shall I install vlc? Say yes or no.")])
    q = events.subscribe()
    reply = llm.handle("install vlc", "voice")
    assert "install vlc" in reply.lower() and ran == []
    ev = [q.get_nowait() for _ in range(q.qsize())]
    assert any(e["type"] == "confirm" and "vlc" in e["text"] for e in ev)
    # user says yes by voice -> tool runs without another LLM call
    assert llm.handle("yes", "voice") == "Installed vlc" and ran == ["vlc"]


def test_confirmation_denied():
    config.save({"confirm_risky": True})
    r = llm.handle("uninstall vlc", "text")
    assert "Should I uninstall vlc" in r
    assert "won't" in llm.handle("no", "text")


def test_confirm_off_runs_immediately(monkeypatch):
    monkeypatch.setitem(skills.REGISTRY["close_app"], "fn", lambda name: {"ok": True, "result": "Closed " + name})
    config.save({"confirm_risky": False})
    assert llm.handle("close notepad", "text") == "Closed notepad"


def test_gemini_failure_falls_back_to_offline_for_known_commands():
    config.save({"gemini_key": "k"})
    llm._transport = httpx.MockTransport(lambda r: httpx.Response(500, text="boom"))
    assert "Timer set" in llm.handle("set a timer for 1 minute", "text")
    assert "couldn't reach" in llm.handle("tell me about black holes", "text")


def test_bad_api_key_message():
    config.save({"gemini_key": "bad"})
    llm._transport = httpx.MockTransport(lambda r: httpx.Response(400, text='{"error":{"message":"API key not valid"}}'))
    assert "API key was rejected" in llm.handle("hello there friend", "text")


def test_summarize_day_offline_and_gemini():
    db.add_message("user", "check my mail", "voice")
    db.add_message("assistant", "No unread mail.", "voice")
    db.add_message("user", "set a timer for 5 minutes", "text")
    day = db.day_key()
    s = llm.summarize_day(day)
    assert "2 requests" in s and "1 by voice" in s
    config.save({"gemini_key": "k"})
    llm._transport, _ = gemini_transport([txt("You checked mail and set a timer.")])
    assert llm.summarize_day(day) == "You checked mail and set a timer."
    assert "no chats" in llm.summarize_day("2001-01-01")


# ---------------------------------------------------------------- voice
@pytest.mark.parametrize("said", ["Alexi", "alexi, what's the time", "Hey Alexey open chrome", "Alexa check my mail", "hey alexis"])
def test_wake_word_variants(said):
    assert L.find_wake(said, config.load()["wake_words"])[0]


@pytest.mark.parametrize("said", ["hello there", "what is the weather", "alert me later", "lexicon"])
def test_wake_word_no_false_positive(said):
    assert not L.find_wake(said, config.load()["wake_words"])[0]


def test_stop_words():
    sw = config.load()["stop_words"]
    assert L.is_stop("Shut up!", sw) and L.is_stop("ok shut-up now", sw) and not L.is_stop("shut the door", sw)


class FakeASR:
    def __init__(self, texts): self.texts = list(texts)
    def available(self): return True, ""
    def transcribe(self, audio): return self.texts.pop(0)


class NoVoiceID:
    ref = None
    def available(self): return False
    def is_owner(self, a): return True


def speech(sec, amp=6000):
    t = np.arange(int(sec * L.SR)) / L.SR
    return (amp * np.sin(2 * np.pi * 220 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t))).astype(np.int16).tobytes()


def silence(sec):
    return (np.random.randn(int(sec * L.SR)) * 40).astype(np.int16).tobytes()


def test_wake_conversation_and_shut_up_flow(monkeypatch):
    handled = []
    monkeypatch.setattr(llm, "handle", lambda t, ch="text": handled.append((t, ch)) or "ok")
    ls = L.Listener(FakeASR([]), NoVoiceID())
    q = events.subscribe()
    ls.on_text("what is the weather")                 # no wake word -> ignored
    assert ls.state == "idle" and handled == []
    ls.on_text("Alexi")                               # wake only
    assert ls.state == "active" and handled == []
    ls.on_text("open chrome")                         # follow-up in active mode, no wake word needed
    assert handled == [("open chrome", "voice")]
    ls.on_text("shut up")
    assert ls.state == "idle"
    ls.on_text("alexi what time is it")               # wake + command in one go
    assert handled[-1] == ("what time is it", "voice") and ls.state == "active"
    ev = [q.get_nowait() for _ in range(q.qsize())]
    orb = [e["visible"] for e in ev if e["type"] == "orb"]
    assert orb == [True, False, True]


def test_vad_segments_and_pipeline(monkeypatch):
    handled = []
    monkeypatch.setattr(llm, "handle", lambda t, ch="text": handled.append(t) or "ok")
    ls = L.Listener(FakeASR(["alexi open spotify"]), NoVoiceID())
    ls.feed(silence(1.0))
    ls.feed(speech(1.2))
    ls.feed(silence(1.0))
    deadline = time.time() + 3
    while not handled and time.time() < deadline:
        time.sleep(0.05)
    assert handled == ["open spotify"] and ls.state == "active"


def test_vad_ignores_pure_noise_and_muted_audio():
    asr = FakeASR([])
    ls = L.Listener(asr, NoVoiceID())
    ls.feed(silence(3.0))
    ls.speaking(True)
    ls.feed(speech(1.0)); ls.feed(silence(1.0))
    time.sleep(0.3)
    assert ls._q.qsize() == 0 and asr.texts == []


def test_missing_whisper_reports_clearly_instead_of_crashing():
    ok, why = L.Transcriber().available()
    if not ok:
        assert "pip install faster-whisper" in why
        assert L.Transcriber().transcribe(np.zeros(16000, np.float32)) == ""


# ---------------------------------------------------------------- permissions
def test_permissions_block_tools_until_allowed():
    config.save({"permissions": {"apps": False, "files": False, "media": False}})
    r = skills.run("launch_app", {"name": "calc"})
    assert not r["ok"] and "Permissions" in r["error"]
    assert not skills.run("download_file", {"url": "https://x.io/a"})["ok"]
    config.save({"permissions": {"media": True}})          # photo/video consent also unlocks file search
    assert skills.run("find_files", {"query": "zzzzqqq"})["ok"]


def test_mic_permission_gates_background_listening():
    config.save({"permissions": {"microphone": False}})
    ls = L.Listener(FakeASR(["x"]), NoVoiceID())
    ls.feed(silence(0.5)); ls.feed(speech(1.0)); ls.feed(silence(1.0))
    time.sleep(0.2)
    assert ls._q.qsize() == 0


def test_voice_note_push_to_talk(monkeypatch):
    ls = L.Listener(FakeASR(["check my mail"]), NoVoiceID())
    ls.ptt_start()
    ls.feed(speech(1.0))
    assert ls.ptt_stop() == "check my mail"
    ls.ptt_start()
    ls.feed(speech(0.1))
    assert ls.ptt_stop() == ""
