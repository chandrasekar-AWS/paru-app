"""The brain: Gemini function-calling loop with an offline rule-based fallback.

Never raises to the caller: any failure becomes a short, honest reply.
"""
import json, re, threading, time, uuid
from . import config, db, events, skills

_transport = None          # tests inject an httpx transport
_pending = {}              # confirmation id -> {tool,args,desc,ts}
_plock = threading.Lock()
MAX_ROUNDS = 6

SYSTEM = """You are Paru, a fast personal AI assistant and agent running on the user's own device (Windows, Linux, macOS or Android).
You can act through tools: mail, calendar, timers, launching/closing/installing apps, locking the screen, browser, web search, downloads, uploads, typing into apps.
Rules:
- Use tools whenever the user asks you to DO something; never pretend to have done something you did not do.
- Reply in the same language the user used (English, Tamil, Hindi, etc.). Be warm, direct and brief: 1-3 short sentences. No markdown, no emoji, no lists unless the user asks - your reply may be spoken aloud.
- If a tool fails, say plainly what failed and what the user can do.
- Risky tools (install, uninstall, close, send, update, lock, download, upload, call, typing) may ask the user for approval first; if a tool says awaiting_confirmation, tell the user what you are about to do and ask them to say yes or no.
- For summaries of mail or calendar, give the key points (who, what, when), not every field.
Today: {now}. User's name: {name}. Operating system: {os}."""


# ------------------------------------------------------------------ confirmations
def _describe(name, args):
    a = ", ".join(f"{v}" for v in (args or {}).values())
    verbs = {"install_app": "install", "uninstall_app": "uninstall", "close_app": "close", "lock_screen": "lock the screen",
             "update_system": "update the system", "send_reply": "send this email", "download_file": "download",
             "upload_file": "upload", "make_call": "call", "type_text": "type text into the active window",
             "press_keys": "press keys in the active window"}
    v = verbs.get(name, name.replace("_", " "))
    return f"{v} {a}".strip() if name not in ("lock_screen", "update_system") else v


def _call_tool(name, args, s):
    if skills.is_risky(name) and s.get("confirm_risky", True):
        cid = uuid.uuid4().hex[:8]
        desc = _describe(name, args)
        with _plock:
            _pending[cid] = {"tool": name, "args": args, "desc": desc, "ts": time.time()}
        events.publish("confirm", id=cid, text=f"Allow Paru to {desc}?", tool=name)
        return {"ok": False, "awaiting_confirmation": True, "action": desc}
    return skills.run(name, args)


def pending():
    now = time.time()
    with _plock:
        for k in [k for k, v in _pending.items() if now - v["ts"] > 600]:
            _pending.pop(k, None)
        return dict(_pending)


def confirm(cid, approve):
    with _plock:
        p = _pending.pop(cid, None)
    if not p:
        return "That request has expired."
    if not approve:
        msg = f"Okay, I won't {p['desc']}."
    else:
        res = skills.run(p["tool"], p["args"])
        msg = _speakable(p["tool"], res)
    db.add_message("assistant", msg, "text")
    events.publish("message", role="assistant", content=msg, channel="text")
    events.publish("confirm_done", id=cid)
    return msg


def _speakable(tool, res):
    if res.get("ok"):
        return str(res.get("result") or "Done.")[:600]
    return "That didn't work: " + str(res.get("error") or "unknown error")[:300]


YES = re.compile(r"^\s*(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|confirm|allow|please do|ஆம்|ஆமாம்|haan|ha|हाँ|हां)\b", re.I)
NO = re.compile(r"^\s*(no|nope|nah|cancel|don'?t|do not|stop|never ?mind|deny|வேண்டாம்|இல்லை|nahi|नहीं)\b", re.I)


# ------------------------------------------------------------------ gemini
def _gemini(contents, s):
    import httpx
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{s['gemini_model']}:generateContent"
    import platform
    sysmsg = SYSTEM.format(now=time.strftime("%A %d %B %Y %I:%M %p"), name=s.get("name") or "there", os=platform.system())
    body = {"systemInstruction": {"parts": [{"text": sysmsg}]}, "contents": contents,
            "tools": [{"functionDeclarations": skills.declarations()}], "generationConfig": {"temperature": 0.4}}
    with httpx.Client(timeout=45, transport=_transport) as c:
        r = c.post(url, headers={"x-goog-api-key": s["gemini_key"]}, json=body)
    if r.status_code == 429:
        raise RuntimeError("Gemini rate limit reached. Try again in a minute.")
    if r.status_code in (400, 403) and "API key" in r.text:
        raise RuntimeError("Your Gemini API key was rejected. Check it in Settings -> AI.")
    r.raise_for_status()
    return r.json()


def _run_gemini(text, s):
    hist = db.recent(12)
    contents = [{"role": "user" if m["role"] == "user" else "model", "parts": [{"text": m["content"]}]} for m in hist]
    if not contents or contents[-1]["role"] != "user" or contents[-1]["parts"][0]["text"] != text:
        contents.append({"role": "user", "parts": [{"text": text}]})
    # Gemini requires the first turn to be a user turn and strict alternation
    merged = []
    for c in contents:
        if merged and merged[-1]["role"] == c["role"]:
            merged[-1]["parts"][0]["text"] += "\n" + c["parts"][0]["text"]
        else:
            merged.append(c)
    while merged and merged[0]["role"] != "user":
        merged.pop(0)
    contents = merged
    waiting = False
    for _ in range(MAX_ROUNDS):
        data = _gemini(contents, s)
        cands = data.get("candidates") or []
        if not cands:
            fb = data.get("promptFeedback", {}).get("blockReason")
            return "I can't help with that request." if fb else "I didn't get an answer from the model. Please try again."
        content = cands[0].get("content") or {"role": "model", "parts": []}
        parts = content.get("parts") or []
        calls = [p["functionCall"] for p in parts if "functionCall" in p]
        if not calls:
            txt = " ".join(p.get("text", "") for p in parts).strip()
            if waiting and not txt:
                txt = "Waiting for your approval. Say yes or no."
            return txt or "Done."
        contents.append({"role": "model", "parts": parts})
        resp_parts = []
        for fc in calls:
            res = _call_tool(fc["name"], fc.get("args") or {}, s)
            waiting = waiting or bool(res.get("awaiting_confirmation"))
            slim = {k: v for k, v in res.items() if k != "trace"}
            resp_parts.append({"functionResponse": {"name": fc["name"], "response": {"content": slim}}})
        contents.append({"role": "user", "parts": resp_parts})
    return "That took too many steps. Could you break it into smaller parts?"


# ------------------------------------------------------------------ offline fallback
_UNITS = {"s": 1, "sec": 1, "second": 1, "m": 60, "min": 60, "minute": 60, "h": 3600, "hr": 3600, "hour": 3600}


def route_offline(t):
    """Very small intent router so core commands work with no API key / no internet."""
    low = t.lower().strip().rstrip(".!?")
    m = re.search(r"(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b", low)
    if "timer" in low and m:
        return "set_timer", {"seconds": float(m.group(1)) * _UNITS[m.group(2).rstrip("s")] if m.group(2).rstrip("s") in _UNITS else 60}
    if re.search(r"\b(cancel|stop|clear) (all )?(my )?timers?\b", low):
        return "cancel_timers", {}
    if re.search(r"\b(list|show|what).*timers?\b", low):
        return "list_timers", {}
    if re.search(r"\b(mail|e-?mail|inbox)\b", low) and re.search(r"\b(check|read|any|new|unread|show|open)\b", low):
        return "check_mail", {}
    if re.search(r"\b(calendar|schedule|agenda|meetings?)\b", low):
        return "check_calendar", {"days": 7 if re.search(r"week|7 days", low) else 1}
    if re.search(r"\b(what'?s the |what is the |tell me the )?(time|date|day)\b", low) and len(low) < 40:
        return "get_time", {}
    if re.search(r"^(please )?(lock)( my| the)?( screen| computer| pc| laptop| device)?$", low):
        return "lock_screen", {}
    if re.search(r"^(please )?unlock\b", low):
        return "unlock_screen", {}
    if m := re.match(r"^(?:please )?(?:uninstall|remove)\s+(.+)$", low):
        return "uninstall_app", {"name": m.group(1)}
    if m := re.match(r"^(?:please )?install\s+(.+)$", low):
        return "install_app", {"name": m.group(1)}
    if re.match(r"^(?:please )?update (?:the |my )?(?:system|computer|pc|apps?|everything)$", low):
        return "update_system", {}
    if m := re.match(r"^(?:please )?(?:close|quit|exit|kill)\s+(.+)$", low):
        return "close_app", {"name": m.group(1)}
    if m := re.match(r"^(?:please )?download\s+(https?://\S+)", t.strip(), re.I):
        return "download_file", {"url": m.group(1)}
    if m := re.match(r"^(?:please )?call\s+([+\d][\d\s\-]{2,})$", low):
        return "make_call", {"number": m.group(1)}
    if m := re.match(r"^(?:please )?(?:open|go to|visit)\s+((?:https?://)?[\w\-]+(?:\.[\w\-]+)+\S*)$", low):
        return "open_url", {"url": m.group(1)}
    if m := re.match(r"^(?:please )?(?:search|google|look up|find)(?: for| on the web| the web for)?\s+(.+)$", low):
        return "web_search", {"query": m.group(1)}
    if m := re.match(r"^(?:please )?(?:open|launch|start|run)\s+(.+)$", low):
        return "launch_app", {"name": m.group(1)}
    return None


def _run_offline(text, s):
    r = route_offline(text)
    if not r:
        return ("I can do things like open apps, set timers, check mail and calendar, search the web and lock your screen. "
                "For open conversation, add a free Gemini API key in Settings -> AI.")
    name, args = r
    res = _call_tool(name, args, s)
    if res.get("awaiting_confirmation"):
        return f"Should I {res['action']}? Say yes or no."
    if name == "web_search" and res.get("ok"):
        return "Here's what I found: " + "; ".join(i["title"] for i in res["results"][:3])
    return _speakable(name, res)


# ------------------------------------------------------------------ public API
def handle(text, channel="text"):
    """Process one user message end-to-end. Returns the reply text."""
    text = (text or "").strip()
    if not text:
        return ""
    s = config.load()
    db.add_message("user", text, channel)
    events.publish("message", role="user", content=text, channel=channel)
    events.publish("thinking", on=True)
    try:
        pend = pending()
        if pend and (YES.match(text) or NO.match(text)) and len(text) < 40:
            cid = max(pend, key=lambda k: pend[k]["ts"])
            reply = confirm(cid, bool(YES.match(text)))
            events.publish("thinking", on=False)
            return reply
        try:
            reply = _run_gemini(text, s) if s.get("gemini_key") else _run_offline(text, s)
        except Exception as e:
            fallback = route_offline(text)
            if fallback:
                reply = _run_offline(text, s)
            else:
                msg = str(e) if isinstance(e, RuntimeError) else "I couldn't reach the AI service. Check your internet connection."
                reply = msg
    finally:
        events.publish("thinking", on=False)
    reply = reply or "Done."
    db.add_message("assistant", reply, channel)
    events.publish("message", role="assistant", content=reply, channel=channel, speak=(channel == "voice") or None)
    return reply


def summarize_day(day):
    msgs = db.messages(day)
    if not msgs:
        return "There are no chats on that day."
    s = config.load()
    transcript = "\n".join(f"{'User' if m['role'] == 'user' else 'Paru'}: {m['content']}" for m in msgs)[-12000:]
    if s.get("gemini_key"):
        try:
            import httpx
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{s['gemini_model']}:generateContent"
            body = {"contents": [{"role": "user", "parts": [{"text":
                    "Summarize this day of conversations between a user and their assistant, as if telling the user out loud what happened. "
                    "Plain spoken sentences, no markdown or lists, under 120 words, same language as the user.\n\n" + transcript}]}]}
            with httpx.Client(timeout=45, transport=_transport) as c:
                r = c.post(url, headers={"x-goog-api-key": s["gemini_key"]}, json=body)
            r.raise_for_status()
            parts = r.json()["candidates"][0]["content"]["parts"]
            txt = " ".join(p.get("text", "") for p in parts).strip()
            if txt:
                return txt
        except Exception:
            pass
    users = [m["content"] for m in msgs if m["role"] == "user"]
    voice = sum(1 for m in msgs if m["role"] == "user" and m["channel"] == "voice")
    shown = "; ".join(u[:80] for u in users[:6])
    return (f"On this day you sent {len(users)} request{'s' if len(users) != 1 else ''} "
            f"({voice} by voice). You asked: {shown}." + (" And more." if len(users) > 6 else ""))
