"""Sign-in. GitHub uses the device flow (needs only a client id). Google uses loopback + PKCE.
Apple needs a paid developer account and a hosted callback, so it is reported as unavailable instead of faked.
Nothing is sent anywhere except the provider itself; the profile name is stored in ~/.paru only."""
import base64, hashlib, secrets, time, urllib.parse
import httpx
from . import config

_transport = None
_state = {}


def _client():
    return httpx.Client(timeout=20, transport=_transport, headers={"Accept": "application/json"})


def start(provider, port):
    s = config.load()["oauth"]
    if provider == "apple":
        return {"ok": False, "error": "Sign in with Apple needs an Apple Developer account and a hosted callback URL, which a local-only app can't provide. Use Google, GitHub or a local profile."}
    if provider == "github":
        cid = s["github_client_id"]
        if not cid:
            return {"ok": False, "error": "Add your GitHub OAuth app client id in Settings -> Accounts first (GitHub -> Settings -> Developer settings -> OAuth Apps, enable Device Flow)."}
        with _client() as c:
            r = c.post("https://github.com/login/device/code", data={"client_id": cid, "scope": "read:user"})
        d = r.json()
        if "device_code" not in d:
            return {"ok": False, "error": d.get("error_description") or "GitHub rejected the client id."}
        _state["github"] = {"device_code": d["device_code"], "interval": d.get("interval", 5), "exp": time.time() + d["expires_in"]}
        return {"ok": True, "flow": "device", "user_code": d["user_code"], "url": d["verification_uri"]}
    if provider == "google":
        cid = s["google_client_id"]
        if not cid:
            return {"ok": False, "error": "Add your Google OAuth client id (type: Desktop app) in Settings -> Accounts first."}
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        st = secrets.token_urlsafe(16)
        redirect = f"http://127.0.0.1:{port}/api/oauth/google/callback"
        _state["google"] = {"verifier": verifier, "state": st, "redirect": redirect, "result": None}
        q = urllib.parse.urlencode({"client_id": cid, "redirect_uri": redirect, "response_type": "code", "scope": "openid email profile",
                                    "code_challenge": challenge, "code_challenge_method": "S256", "state": st})
        return {"ok": True, "flow": "browser", "url": "https://accounts.google.com/o/oauth2/v2/auth?" + q}
    return {"ok": False, "error": "Unknown provider."}


def poll(provider):
    if provider == "github":
        st = _state.get("github")
        if not st or time.time() > st["exp"]:
            return {"status": "error", "error": "Code expired. Start again."}
        s = config.load()["oauth"]
        with _client() as c:
            r = c.post("https://github.com/login/oauth/access_token", data={
                "client_id": s["github_client_id"], "device_code": st["device_code"],
                "grant_type": "urn:ietf:params:oauth:grant-type:device_code"}).json()
            if "access_token" in r:
                u = c.get("https://api.github.com/user", headers={"Authorization": "Bearer " + r["access_token"]}).json()
                _state.pop("github", None)
                return {"status": "ok", "name": u.get("name") or u.get("login") or "GitHub user"}
        err = r.get("error")
        if err in ("authorization_pending", "slow_down"):
            return {"status": "pending"}
        return {"status": "error", "error": r.get("error_description") or err or "Sign-in failed."}
    if provider == "google":
        st = _state.get("google")
        if st and st.get("result"):
            res, st["result"] = st["result"], None
            return res
        return {"status": "pending"}
    return {"status": "error", "error": "Unknown provider."}


def google_callback(code, state):
    st = _state.get("google")
    if not st or state != st["state"]:
        return False, "Invalid sign-in state. Please try again."
    s = config.load()["oauth"]
    data = {"client_id": s["google_client_id"], "code": code, "code_verifier": st["verifier"],
            "redirect_uri": st["redirect"], "grant_type": "authorization_code"}
    if s.get("google_client_secret"):
        data["client_secret"] = s["google_client_secret"]
    with _client() as c:
        t = c.post("https://oauth2.googleapis.com/token", data=data).json()
        if "access_token" not in t:
            st["result"] = {"status": "error", "error": t.get("error_description") or "Google sign-in failed."}
            return False, st["result"]["error"]
        u = c.get("https://www.googleapis.com/oauth2/v3/userinfo", headers={"Authorization": "Bearer " + t["access_token"]}).json()
    st["result"] = {"status": "ok", "name": u.get("given_name") or u.get("name") or u.get("email", "Google user")}
    return True, ""
