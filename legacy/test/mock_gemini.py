"""A tiny stand-in for the Gemini API, used by the tests (the real one needs a key and the internet).
It answers generateContent with a canned JSON that looks like what agent.py asks for, and counts the calls."""
import json, threading, hashlib, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CALLS = []          # (model, system_text_head, has_audio)
SCRIPT = {"answer": "It is half past ten.", "action": {"type": "none", "target": ""}, "lang": "en", "delay": 0.0}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

    def do_GET(self):
        if self.path.startswith("/v1beta/models"):
            return self._send({"models": [{"name": "models/gemini-2.5-flash-lite", "supportedGenerationMethods": ["generateContent"]},
                                          {"name": "models/gemini-2.5-flash", "supportedGenerationMethods": ["generateContent"]}]})
        self._send({}, 404)

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/__script":
            SCRIPT.update(body); return self._send({"ok": True})
        model = self.path.split("/models/")[-1].split(":")[0]
        parts = body["contents"][0]["parts"]; has_audio = any("inline_data" in p for p in parts)
        sysd = body.get("systemInstruction", {}).get("parts", [{}])[0].get("text", "")
        CALLS.append({"model": model, "audio": has_audio, "wake_gate": "must start by saying" in sysd or "The owner must start" in sysd})
        time.sleep(SCRIPT.get("delay", 0))
        if SCRIPT.get("status"):
            return self._send({"error": {"message": "quota"}}, SCRIPT["status"])
        out = {"heard": SCRIPT.get("heard", "what time is it"), "lang": SCRIPT["lang"], "greeting_only": False,
               "answer": SCRIPT["answer"], "action": SCRIPT["action"], "add_task": "", "due": ""}
        if has_audio is False:           # plain-text calls (reports etc.)
            out = {"answer": SCRIPT["answer"], "add_task": "", "due": ""}
        self._send({"candidates": [{"content": {"parts": [{"text": json.dumps(out)}]}}]})


def start(port=9100):
    srv = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 9100
    start(port); print("mock gemini on", port); threading.Event().wait()
