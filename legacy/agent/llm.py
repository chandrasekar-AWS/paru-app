"""Talk to any AI provider with the person's own key.

kinds:  gemini     Google Gemini (agent.py has its own, richer client for it)
        openai     OpenAI and every "OpenAI-compatible" service (OpenRouter, Groq, DeepSeek, Mistral, xAI, Together, Ollama, LM Studio, custom)
        anthropic  Claude

verify() makes a real, free call (list models) so a wrong / fake key is caught before it is saved.
chat() takes Gemini-style `contents` (what the rest of the agent produces) and converts them.
"""
import re, json

PROVIDERS = {
    "gemini":     {"name": "Google Gemini",          "kind": "gemini",    "base": "https://generativelanguage.googleapis.com/v1beta", "prefix": r"^AIza", "link": "https://aistudio.google.com/apikey", "hears": True},
    "openai":     {"name": "OpenAI (ChatGPT)",       "kind": "openai",    "base": "https://api.openai.com/v1", "prefix": r"^sk-(proj-|svcacct-)?[A-Za-z0-9_-]{20,}$", "link": "https://platform.openai.com/api-keys",
                   "prefer": [r"^gpt-4o-mini$", r"^gpt-4\.1-mini$", r"^gpt-5-mini$", r"^gpt-4o$", r"^gpt-4\.1$", r"^gpt-3\.5-turbo$"]},
    "anthropic":  {"name": "Anthropic (Claude)",     "kind": "anthropic", "base": "https://api.anthropic.com/v1", "prefix": r"^sk-ant-", "link": "https://console.anthropic.com/settings/keys",
                   "prefer": [r"haiku", r"sonnet", r"opus"]},
    "openrouter": {"name": "OpenRouter (any model)", "kind": "openai",    "base": "https://openrouter.ai/api/v1", "prefix": r"^sk-or-", "link": "https://openrouter.ai/keys",
                   "prefer": [r"^google/gemini-2\.5-flash$", r"^openai/gpt-4o-mini$", r"^anthropic/claude-.*haiku", r"^meta-llama/.*instruct"]},
    "groq":       {"name": "Groq",                   "kind": "openai",    "base": "https://api.groq.com/openai/v1", "prefix": r"^gsk_", "link": "https://console.groq.com/keys",
                   "prefer": [r"^llama-3\.3-70b-versatile$", r"^llama-3\.1-8b-instant$", r"llama"]},
    "deepseek":   {"name": "DeepSeek",               "kind": "openai",    "base": "https://api.deepseek.com/v1", "prefix": r"^sk-[a-f0-9]{32}$", "link": "https://platform.deepseek.com/api_keys", "prefer": [r"^deepseek-chat$"]},
    "mistral":    {"name": "Mistral",                "kind": "openai",    "base": "https://api.mistral.ai/v1", "prefix": r"^$", "link": "https://console.mistral.ai/api-keys", "prefer": [r"^mistral-small-latest$", r"small", r"large"]},
    "xai":        {"name": "xAI (Grok)",             "kind": "openai",    "base": "https://api.x.ai/v1", "prefix": r"^xai-", "link": "https://console.x.ai", "prefer": [r"mini", r"grok"]},
    "together":   {"name": "Together AI",            "kind": "openai",    "base": "https://api.together.xyz/v1", "prefix": r"^$", "link": "https://api.together.ai/settings/api-keys", "prefer": [r"Llama-3.*Instruct-Turbo", r"Instruct"]},
    "ollama":     {"name": "Ollama (on this computer, free)", "kind": "openai", "base": "http://127.0.0.1:11434/v1", "prefix": r"^$", "link": "https://ollama.com", "keyless": True, "prefer": [r"llama3", r"qwen", r"gemma", r"mistral"]},
    "lmstudio":   {"name": "LM Studio (on this computer)",    "kind": "openai", "base": "http://127.0.0.1:1234/v1", "prefix": r"^$", "link": "https://lmstudio.ai", "keyless": True, "prefer": [r"."]},
    "custom":     {"name": "Other (OpenAI-compatible address)", "kind": "openai", "base": "", "prefix": r"^$", "link": "", "prefer": [r"."]},
}


def catalog():
    return [{"id": k, "name": v["name"], "base": v["base"], "keyless": bool(v.get("keyless")), "link": v["link"], "hears": bool(v.get("hears"))} for k, v in PROVIDERS.items()]


def detect(key):
    """Guess the provider from the shape of a key. Several share the plain 'sk-' shape, so this is only a hint."""
    k = (key or "").strip()
    for pid in ("anthropic", "openrouter", "groq", "xai", "gemini", "deepseek", "openai"):
        if re.match(PROVIDERS[pid]["prefix"], k):
            return pid
    return ""


def keyless(pid):
    return bool(PROVIDERS.get(pid, {}).get("keyless"))


def _headers(cfg):
    p = PROVIDERS[cfg["id"]]
    if p["kind"] == "anthropic":
        return {"x-api-key": cfg["key"], "anthropic-version": "2023-06-01", "content-type": "application/json"}
    h = {"content-type": "application/json"}
    if cfg.get("key"):
        h["authorization"] = "Bearer " + cfg["key"]
    if cfg["id"] == "openrouter":
        h["x-title"] = "Paru"
    return h


def _base(cfg):
    return (cfg.get("base") or PROVIDERS[cfg["id"]]["base"]).rstrip("/")


def pick_model(pid, names):
    for pat in PROVIDERS[pid].get("prefer", []):
        hit = sorted([n for n in names if re.search(pat, n) and not re.search(r"embed|whisper|tts|image|moderation|audio|realtime|vision-preview|guard", n)], reverse=True)
        if hit:
            return hit[0]
    return names[0] if names else ""


async def verify(http, cfg):
    """-> {ok, error, models[:30], model}. Never raises."""
    pid = cfg.get("id", "")
    if pid not in PROVIDERS:
        return {"ok": False, "error": "Unknown provider."}
    p = PROVIDERS[pid]
    key = (cfg.get("key") or "").strip()
    if not key and not p.get("keyless"):
        return {"ok": False, "error": "Paste your key first."}
    cfg = {**cfg, "key": key}
    if pid == "custom" and not cfg.get("base"):
        return {"ok": False, "error": "Enter the address (for example https://my-server/v1)."}
    try:
        if p["kind"] == "gemini":
            r = await http.get(_base(cfg) + "/models", params={"pageSize": 100}, headers={"x-goog-api-key": key}, timeout=15)
        else:
            r = await http.get(_base(cfg) + "/models", headers=_headers(cfg), timeout=15)
    except Exception as e:
        where = "your computer's " + p["name"] if p.get("keyless") else p["name"]
        return {"ok": False, "error": f"Could not reach {where}. " + ("Is it running? " if p.get("keyless") else "Check the internet. ") + str(e)[:80], "network": True}
    if r.status_code in (401, 403) or (r.status_code == 400 and "API key" in r.text):
        return {"ok": False, "error": f"{p['name']} says this key is not valid."}
    if r.status_code == 404 and pid == "custom":
        return {"ok": False, "error": "That address did not answer like an OpenAI-compatible API (no /models)."}
    if r.status_code == 429:
        return {"ok": True, "models": [], "model": cfg.get("model", ""), "note": "Key accepted (rate limit reached right now)."}
    if r.status_code != 200:
        return {"ok": False, "error": f"{p['name']} answered {r.status_code}: {r.text[:120]}"}
    try:
        d = r.json()
        if p["kind"] == "gemini":
            names = [m["name"].split("/")[-1] for m in d.get("models", []) if "generateContent" in m.get("supportedGenerationMethods", [])]
        else:
            names = [m.get("id") or m.get("name") for m in d.get("data", d.get("models", []))]
            names = [n for n in names if n]
    except Exception:
        names = []
    return {"ok": True, "models": names[:30], "model": cfg.get("model") or (pick_model(pid, names) if p["kind"] != "gemini" else "")}


def _to_messages(contents):
    """Gemini-style contents -> [{role, content}] with consecutive same-role messages merged (Anthropic requires alternation)."""
    out = []
    for c in contents:
        role = "assistant" if c.get("role") == "model" else "user"
        text = "\n".join(p["text"] for p in c.get("parts", []) if "text" in p).strip()
        if not text:
            continue
        if out and out[-1]["role"] == role:
            out[-1]["content"] += "\n" + text
        else:
            out.append({"role": role, "content": text})
    if not out or out[0]["role"] != "user":
        out.insert(0, {"role": "user", "content": "(start)"})
    return out


async def chat(http, cfg, contents, system="", as_json=True, fast=False):
    pid = cfg["id"]; p = PROVIDERS[pid]
    model = cfg.get("model")
    if not model:                                                   # choose once, remember
        v = await verify(http, cfg)
        if not v["ok"]:
            raise RuntimeError(v["error"])
        model = cfg["model"] = v.get("model") or ""
        if not model:
            raise RuntimeError("No model available for this key.")
    msgs = _to_messages(contents)
    sysx = (system or "") + ("\nReturn ONLY one JSON object, no markdown fences." if as_json else "")
    maxt = 600 if fast else 1500
    try:
        if p["kind"] == "anthropic":
            r = await http.post(_base(cfg) + "/messages", headers=_headers(cfg), timeout=40 if not fast else 25,
                                json={"model": model, "max_tokens": maxt, "system": sysx.strip(), "messages": msgs, "temperature": 0.3 if as_json else 0.5})
            if r.status_code == 200:
                return "".join(b.get("text", "") for b in r.json().get("content", []))
        else:
            body = {"model": model, "messages": ([{"role": "system", "content": sysx.strip()}] if sysx.strip() else []) + msgs, "max_tokens": maxt, "temperature": 0.3 if as_json else 0.5}
            if as_json and pid in ("openai", "openrouter", "groq", "deepseek", "mistral", "xai", "together"):
                body["response_format"] = {"type": "json_object"}
            r = await http.post(_base(cfg) + "/chat/completions", headers=_headers(cfg), json=body, timeout=40 if not fast else 25)
            if r.status_code == 400 and "response_format" in body and re.search(r"response_format|json", r.text, re.I):      # some models refuse JSON mode: ask in words instead
                body.pop("response_format"); r = await http.post(_base(cfg) + "/chat/completions", headers=_headers(cfg), json=body, timeout=40)
            if r.status_code == 400 and "max_tokens" in r.text and "max_completion_tokens" in r.text:                       # newer OpenAI models rename it
                body["max_completion_tokens"] = body.pop("max_tokens"); r = await http.post(_base(cfg) + "/chat/completions", headers=_headers(cfg), json=body, timeout=40)
            if r.status_code == 200:
                return r.json()["choices"][0]["message"]["content"] or ""
    except Exception as e:
        raise RuntimeError("network: " + str(e)[:120])
    if r.status_code in (401, 403):
        raise RuntimeError(f"{p['name']} rejected the key (401). Open Paru, Settings, AI key.")
    if r.status_code == 429:
        raise RuntimeError(f"{p['name']} is busy or the limit is reached (429).")
    raise RuntimeError(f"{p['name']} {r.status_code}: {r.text[:160]}")
