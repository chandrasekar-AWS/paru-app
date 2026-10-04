"""Local-only storage. Everything lives under ~/.paru (override with PARU_HOME)."""
import json, os, threading
from pathlib import Path

HOME = Path(os.environ.get("PARU_HOME", Path.home() / ".paru"))
HOME.mkdir(parents=True, exist_ok=True)
DOWNLOADS = HOME / "downloads"
DOWNLOADS.mkdir(exist_ok=True)
SETTINGS_FILE = HOME / "settings.json"

DEFAULTS = {
    "name": "",                      # how Paru greets you
    "onboarded": False,              # login + permissions + voice setup finished
    "login_provider": "",
    "theme": "dark",
    "language": "auto",
    "wake_words": ["alexi", "alexey", "alexy", "aleksi", "alexie", "alexei", "alexis"],
    "stop_words": ["shut up", "shutup", "be quiet", "stop listening", "go quiet"],
    "orb_enabled": True,
    "orb_size": 150,
    "listen_in_background": True,
    "only_my_voice": True,
    "confirm_risky": True,           # ask before install/uninstall/close/send/update/lock...
    "voice": "en-US-AriaNeural",     # edge-tts voice; browser voice used as fallback
    "speak_replies": True,
    "autostart": True,
    "gemini_key": "",
    "gemini_model": "gemini-flash-latest",
    "thinking": "fast",              # fast (thinking turned down) | smart (model thinks longer, slower)
    "fast_commands": True,           # timers/time/lock/open-app run instantly without the AI
    "whisper_model": "base",         # tiny | base | small
    "mail": {"address": "", "app_password": "", "imap_host": "imap.gmail.com", "smtp_host": "smtp.gmail.com"},
    "calendar_ics": "",              # secret iCal URL or a local .ics path
    "oauth": {"google_client_id": "", "github_client_id": "", "apple_client_id": ""},
    "permissions": {"microphone": False, "speaker": False, "media": False, "files": False, "apps": False},
}

_lock = threading.Lock()


def _merge(base, over):
    out = dict(base)
    for k, v in over.items():
        out[k] = _merge(base[k], v) if isinstance(v, dict) and isinstance(base.get(k), dict) else v
    return out


def load():
    with _lock:
        if SETTINGS_FILE.exists():
            try:
                return _merge(DEFAULTS, json.loads(SETTINGS_FILE.read_text("utf-8")))
            except Exception:
                pass
        return json.loads(json.dumps(DEFAULTS))


def save(patch: dict):
    cur = load()
    new = _merge(cur, patch)
    with _lock:
        SETTINGS_FILE.write_text(json.dumps(new, indent=2), "utf-8")
        try:
            os.chmod(SETTINGS_FILE, 0o600)
        except Exception:
            pass
    return new


SECRET_PATHS = [("gemini_key",), ("mail", "app_password")]


def public(s: dict):
    """Settings safe to send to the UI (secrets masked)."""
    s = json.loads(json.dumps(s))
    for p in SECRET_PATHS:
        d = s
        for k in p[:-1]:
            d = d[k]
        d[p[-1]] = "••••••••" if d.get(p[-1]) else ""
    return s
