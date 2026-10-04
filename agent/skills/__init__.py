"""Skill registry. Each skill is a plain function exposed to the LLM as a tool.

risky=True skills ask for confirmation first (Settings -> "Ask before risky actions").
Importing a skill module must never fail: optional libraries are imported lazily inside functions.
"""
import inspect, importlib, traceback

REGISTRY = {}

# tool -> the permission switch (Settings -> Permissions) that must be on
NEEDS = {"launch_app": "apps", "close_app": "apps", "install_app": "apps", "uninstall_app": "apps", "update_system": "apps",
         "make_call": "apps", "type_text": "apps", "press_keys": "apps", "lock_screen": "apps",
         "find_files": "files", "upload_file": "files", "download_file": "files"}
PERM_LABEL = {"apps": "Apps", "files": "Files"}


def tool(description, params=None, risky=False, required=None):
    def deco(fn):
        REGISTRY[fn.__name__] = {"fn": fn, "description": description, "params": params or {},
                                 "required": required if required is not None else list((params or {}).keys()),
                                 "risky": risky}
        return fn
    return deco


def declarations():
    """Gemini functionDeclarations."""
    out = []
    for name, t in REGISTRY.items():
        d = {"name": name, "description": t["description"]}
        if t["params"]:
            d["parameters"] = {"type": "OBJECT",
                               "properties": {k: dict(v) for k, v in t["params"].items()},
                               "required": t["required"]}
        out.append(d)
    return out


def is_risky(name):
    return REGISTRY.get(name, {}).get("risky", False)


def run(name, args):
    t = REGISTRY.get(name)
    if not t:
        return {"ok": False, "error": f"unknown tool {name}"}
    need = NEEDS.get(name)
    if need:
        from .. import config
        perms = config.load()["permissions"]
        if not (perms.get(need) or (name == "find_files" and perms.get("media"))):
            return {"ok": False, "error": f"Paru doesn't have permission for {PERM_LABEL[need]}. Turn it on in Settings -> Permissions."}
    try:
        sig = inspect.signature(t["fn"])
        clean = {k: v for k, v in (args or {}).items() if k in sig.parameters}
        res = t["fn"](**clean)
        return res if isinstance(res, dict) else {"ok": True, "result": res}
    except Exception as e:  # tools must never crash the agent
        friendly = isinstance(e, (RuntimeError, ValueError, FileNotFoundError, PermissionError))
        return {"ok": False, "error": str(e) if friendly else f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-400:]}


def load_all():
    for m in ("system", "timers", "browser", "mail", "agenda"):
        importlib.import_module(f"{__name__}.{m}")
    return REGISTRY
