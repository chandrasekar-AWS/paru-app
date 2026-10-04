"""Stand-ins for OpenAI-compatible and Anthropic APIs: accept only the key 'good', record requests, answer with a canned Paru JSON."""
import json, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
REQ = []
ANSWER = {"answer": "Provider says hello.", "action": {"type": "none", "target": ""}, "lang": "en"}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, obj, code=200):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def _auth(self):
        if self.path.startswith("/anthropic"):
            ok = self.headers.get("x-api-key") == "good" and self.headers.get("anthropic-version")
        else:
            ok = self.headers.get("authorization") in ("Bearer good", None) if "/local/" in self.path else self.headers.get("authorization") == "Bearer good"
        if not ok: self._send({"error": {"message": "invalid api key"}}, 401)
        return ok
    def do_GET(self):
        if not self._auth(): return
        if self.path.startswith("/anthropic"): return self._send({"data": [{"id": "claude-opus-4-1"}, {"id": "claude-haiku-4-5-20251001"}, {"id": "claude-sonnet-4-5"}]})
        self._send({"data": [{"id": "text-embedding-3-small"}, {"id": "gpt-4o"}, {"id": "gpt-4o-mini"}, {"id": "whisper-1"}]})
    def do_POST(self):
        if self.path == "/__script":
            ANSWER.update(json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")); return self._send({"ok": True})
        if not self._auth(): return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}"); REQ.append({"path": self.path, "headers": dict(self.headers), "body": body})
        msgs = body.get("messages", []); last = msgs[-1]["content"] if msgs else ""
        out = {"heard": last, "greeting_only": False, **ANSWER}
        if self.path.startswith("/anthropic"): return self._send({"content": [{"type": "text", "text": json.dumps(out)}]})
        self._send({"choices": [{"message": {"content": json.dumps(out)}}]})

def start(port):
    s = ThreadingHTTPServer(("127.0.0.1", port), H); threading.Thread(target=s.serve_forever, daemon=True).start(); return s

if __name__ == "__main__":
    import sys
    start(int(sys.argv[1])); threading.Event().wait()
