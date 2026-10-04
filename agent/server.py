"""Paru engine: FastAPI on 127.0.0.1 only. Serves the UI and the agent API/WebSocket.

Start:  python -m agent.server --port 8765
Every optional capability (speech recognition, neural voices, speaker ID, UI automation) is imported lazily,
so a missing package can never stop the engine from starting - it is reported in /api/status instead.
"""
import argparse, asyncio, json, os, platform, secrets, sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Response
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import config, db, events, llm, oauth, skills, tts
from .listener import Listener
from .skills import timers

UI_DIR = Path(os.environ.get("PARU_UI", Path(__file__).resolve().parent.parent / "ui"))
TOKEN = os.environ.get("PARU_TOKEN") or secrets.token_urlsafe(24)
PORT = 8765
listener: Listener = None
ALLOWED_HOSTS = ("127.0.0.1", "localhost", "[::1]")


@asynccontextmanager
async def lifespan(app):
    global listener
    events.bind(asyncio.get_running_loop())
    skills.load_all()
    timers.start()
    listener = Listener()
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


def _host_ok(host_header: str) -> bool:
    h = (host_header or "").strip().lower()
    if h.startswith("["):                      # [::1]:8765
        h = h.split("]")[0] + "]"
    else:
        h = h.split(":")[0]
    return h in ALLOWED_HOSTS


@app.middleware("http")
async def guard(request: Request, call_next):
    # block DNS-rebinding and drive-by requests from web pages: local Host only, token on every /api call
    if not _host_ok(request.headers.get("host", "")):
        return JSONResponse({"error": "forbidden host"}, status_code=403)
    p = request.url.path
    if p.startswith("/api/") and p != "/api/health" and not p.startswith("/api/oauth/google/callback"):
        if request.headers.get("x-paru-token") != TOKEN and request.query_params.get("token") != TOKEN:
            return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await call_next(request)


def _status():
    ok_asr, why = listener.asr.available() if listener else (False, "starting")
    return {"os": platform.system(), "asr": {"ok": ok_asr, "reason": why},
            "voice_id": {"ok": listener.vid.available(), "enrolled": listener.vid.ref is not None} if listener else {"ok": False},
            "neural_tts": tts.available(), "llm": bool(config.load()["gemini_key"]),
            "listener": listener.state if listener else "off", "tools": sorted(skills.REGISTRY),
            "pending": [{"id": k, "text": f"Allow Paru to {v['desc']}?"} for k, v in llm.pending().items()]}


@app.get("/api/health")
def health():
    return {"ok": True, "app": "paru"}


@app.get("/api/status")
def status():
    return _status()


@app.get("/api/settings")
def get_settings():
    return config.public(config.load())


@app.post("/api/settings")
async def set_settings(request: Request):
    patch = await request.json()
    # never let the UI overwrite a stored secret with its masked placeholder
    def strip(d):
        return {k: strip(v) if isinstance(v, dict) else v for k, v in d.items() if v != "••••••••"}
    new = config.save(strip(patch))
    events.publish("settings", settings=config.public(new))
    return config.public(new)


@app.post("/api/chat")
async def chat(request: Request):
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "empty message"}, status_code=400)
    reply = await run_in_threadpool(llm.handle, text, body.get("channel", "text"))
    return {"reply": reply}


@app.post("/api/confirm")
async def confirm(request: Request):
    b = await request.json()
    reply = await run_in_threadpool(llm.confirm, b.get("id", ""), bool(b.get("approve")))
    return {"reply": reply}


@app.get("/api/history")
def history():
    return db.days()


@app.get("/api/history/{day}")
def history_day(day: str):
    return db.messages(day)


@app.delete("/api/history/{day}")
def history_delete(day: str):
    db.delete_day(day)
    return {"ok": True}


@app.delete("/api/history")
def history_clear():
    db.clear_all()
    return {"ok": True}


@app.post("/api/summarize/{day}")
async def summarize(day: str):
    return {"summary": await run_in_threadpool(llm.summarize_day, day)}


@app.get("/api/tts")
async def tts_endpoint(text: str, voice: str = ""):
    try:
        audio = await tts.synth(text, voice or config.load()["voice"])
        return Response(audio, media_type="audio/mpeg")
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=501)


@app.get("/api/voices")
async def voices():
    return [{"id": i, "label": l} for i, l in await tts.voices()]


@app.post("/api/login/local")
async def login_local(request: Request):
    b = await request.json()
    name = (b.get("name") or "").strip()[:40]
    if not name:
        return JSONResponse({"error": "Please enter a name."}, status_code=400)
    config.save({"name": name, "login_provider": b.get("provider", "local")})
    return {"ok": True}


@app.post("/api/oauth/{provider}/start")
async def oauth_start(provider: str):
    return await run_in_threadpool(oauth.start, provider, PORT)


@app.get("/api/oauth/{provider}/poll")
async def oauth_poll(provider: str):
    res = await run_in_threadpool(oauth.poll, provider)
    if res.get("status") == "ok":
        config.save({"name": res["name"], "login_provider": provider})
    return res


@app.get("/api/oauth/google/callback")
async def google_cb(code: str = "", state: str = ""):
    ok, err = await run_in_threadpool(oauth.google_callback, code, state)
    msg = "Signed in. You can close this tab and go back to Paru." if ok else f"Sign-in failed: {err}"
    return HTMLResponse(f"<body style='font-family:sans-serif;background:#0b0818;color:#fff;text-align:center;padding-top:20vh'><h2>{msg}</h2></body>")


@app.post("/api/test/gemini")
async def test_gemini():
    s = config.load()
    if not s["gemini_key"]:
        return {"ok": False, "error": "No API key saved yet."}
    try:
        import time as _t
        t0 = _t.time()
        data = await run_in_threadpool(llm._gemini, [{"role": "user", "parts": [{"text": "Reply with the single word: ready"}]}], s)
        ms = int((_t.time() - t0) * 1000)
        return {"ok": True, "reply": f"Replied in {ms} ms ({s['gemini_model']})"}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


@app.post("/api/test/mail")
async def test_mail():
    res = await run_in_threadpool(skills.run, "check_mail", {"limit": 1, "unread_only": False})
    return {"ok": bool(res.get("ok")), "error": res.get("error"), "result": res.get("result")}


@app.post("/api/test/calendar")
async def test_calendar():
    res = await run_in_threadpool(skills.run, "check_calendar", {"days": 7})
    return {"ok": bool(res.get("ok")), "error": res.get("error"), "result": res.get("result")}


@app.post("/api/listen/{action}")
def listen(action: str):
    if action == "activate":
        listener.activate()
    elif action == "deactivate":
        listener.deactivate()
    else:
        return JSONResponse({"error": "unknown action"}, status_code=404)
    return {"state": listener.state}


def _voice_note():
    ok, why = listener.asr.available()
    if not ok:
        listener.ptt_stop()
        events.publish("notice", level="error", text=why)
        return
    try:
        text = listener.ptt_stop()
    except Exception as e:
        events.publish("notice", level="error", text=f"Couldn't transcribe that: {e}")
        return
    if not text:
        events.publish("notice", level="info", text="I didn't catch anything. Hold the mic and speak.")
        return
    llm.handle(text, "voice")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    if ws.query_params.get("token") != TOKEN or not _host_ok(ws.headers.get("host", "")):
        await ws.close(code=4401)
        return
    await ws.accept()
    q = events.subscribe()
    await ws.send_json({"type": "hello", "status": _status()})
    if events.last("orb"):
        await ws.send_json(events.last("orb"))

    async def sender():
        while True:
            await ws.send_json(await q.get())

    async def receiver():
        while True:
            m = await ws.receive()
            if m.get("type") == "websocket.disconnect":
                return
            if m.get("bytes"):
                listener.feed(m["bytes"])
                continue
            try:
                d = json.loads(m.get("text") or "{}")
            except Exception:
                continue
            t = d.get("type")
            if t == "chat" and d.get("text"):
                asyncio.create_task(run_in_threadpool(llm.handle, d["text"], d.get("channel", "text")))
            elif t == "speaking":
                listener.speaking(bool(d.get("on")))
            elif t == "enroll_start":
                listener.enroll_start()
            elif t == "enroll_stop":
                try:
                    await run_in_threadpool(listener.enroll_stop)
                    await ws.send_json({"type": "enrolled", "ok": True})
                except Exception as e:
                    await ws.send_json({"type": "enrolled", "ok": False, "error": str(e)})
            elif t == "ptt_start":
                listener.ptt_start()
            elif t == "ptt_stop":
                asyncio.create_task(run_in_threadpool(_voice_note))
            elif t == "activate":
                listener.activate()
            elif t == "deactivate":
                listener.deactivate()

    tasks = [asyncio.create_task(sender()), asyncio.create_task(receiver())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    finally:
        for t in tasks:
            t.cancel()
        events.unsubscribe(q)


@app.get("/", response_class=HTMLResponse)
@app.get("/index.html", response_class=HTMLResponse)
def index():
    return (UI_DIR / "index.html").read_text("utf-8").replace("__PARU_TOKEN__", TOKEN)


@app.get("/orb.html", response_class=HTMLResponse)
def orb_page():
    return (UI_DIR / "orb.html").read_text("utf-8").replace("__PARU_TOKEN__", TOKEN)


app.mount("/", StaticFiles(directory=str(UI_DIR)), name="ui")


def main():
    global PORT
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    PORT = a.port
    import uvicorn
    print(f"PARU_READY port={PORT}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
