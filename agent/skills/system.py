"""Apps, lock, install/uninstall/update, calls and UI automation for Windows, Linux and macOS."""
import os, platform, shutil, subprocess, sys, glob, configparser
from . import tool

OS = platform.system()  # Windows | Linux | Darwin
SELF_NAMES = ("paru", "python", "electron", "uvicorn")


def _run(cmd, timeout=60, shell=False):
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, shell=shell)
    out = (p.stdout or "") + (p.stderr or "")
    return p.returncode, out.strip()[-1200:]


def _desktop_entries():
    dirs = ["/usr/share/applications", "/usr/local/share/applications", os.path.expanduser("~/.local/share/applications"),
            "/var/lib/flatpak/exports/share/applications", os.path.expanduser("~/.local/share/flatpak/exports/share/applications"),
            "/var/lib/snapd/desktop/applications"]
    for d in dirs:
        for f in glob.glob(os.path.join(d, "*.desktop")):
            cp = configparser.RawConfigParser(strict=False, interpolation=None)
            try:
                cp.read(f, encoding="utf-8")
                e = cp["Desktop Entry"]
                if e.get("NoDisplay", "false").lower() == "true":
                    continue
                yield f, e.get("Name", ""), e.get("Exec", ""), e.get("GenericName", ""), e.get("Comment", "")
            except Exception:
                continue


def find_linux_app(name):
    n = name.lower().strip()
    best = None
    for f, nm, ex, gn, cm in _desktop_entries():
        base = os.path.basename(f)[:-8].lower()
        score = 0
        if n == nm.lower() or n == base:
            score = 100
        elif n in nm.lower() or n in base:
            score = 60
        elif n in gn.lower():
            score = 30
        if score and (not best or score > best[0]):
            best = (score, f, nm, ex)
    return best


@tool("Open/launch an application by name (e.g. 'chrome', 'spotify', 'calculator', 'terminal').",
      {"name": {"type": "STRING", "description": "App name"}})
def launch_app(name):
    if OS == "Windows":
        alias = {"calculator": "calc", "notepad": "notepad", "paint": "mspaint", "explorer": "explorer", "files": "explorer",
                 "terminal": "wt", "cmd": "cmd", "settings": "ms-settings:", "chrome": "chrome", "edge": "msedge"}
        target = alias.get(name.lower(), name)
        subprocess.Popen(f'start "" "{target}"', shell=True)
        return {"ok": True, "result": f"Launching {name}"}
    if OS == "Darwin":
        rc, out = _run(["open", "-a", name])
        return {"ok": rc == 0, "result": out or f"Launching {name}"}
    hit = find_linux_app(name)
    if hit:
        _, f, nm, ex = hit
        if shutil.which("gtk-launch"):
            subprocess.Popen(["gtk-launch", os.path.basename(f)[:-8]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        else:
            cmd = [a for a in ex.split() if not a.startswith("%")]
            subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return {"ok": True, "result": f"Launching {nm}"}
    exe = shutil.which(name) or shutil.which(name.lower().replace(" ", "-"))
    if exe:
        subprocess.Popen([exe], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return {"ok": True, "result": f"Launching {name}"}
    return {"ok": False, "error": f"I couldn't find an app called '{name}'. Ask me to install it."}


@tool("Close/quit a running application by name.", {"name": {"type": "STRING", "description": "App name"}}, risky=True)
def close_app(name):
    n = name.lower().strip()
    if not n or any(s in n for s in SELF_NAMES):
        return {"ok": False, "error": "I won't close myself or the system runtime."}
    if OS == "Windows":
        rc, out = _run(["taskkill", "/IM", n if n.endswith(".exe") else n + ".exe"])
    elif OS == "Darwin":
        rc, out = _run(["osascript", "-e", f'quit app "{name}"'])
    else:
        hit = find_linux_app(n)
        proc = (hit[3].split()[0].split("/")[-1] if hit and hit[3] else n)
        rc, out = _run(["pkill", "-x", "-i", proc[:15]])
        if rc != 0:
            rc, out = _run(["pkill", "-i", "-f", f"(^|/){n}( |$)"])
    return {"ok": rc == 0, "result": out or f"Closed {name}", "error": None if rc == 0 else f"{name} doesn't seem to be running"}


@tool("Lock the screen/computer now.", risky=True)
def lock_screen():
    if OS == "Windows":
        _run(["rundll32.exe", "user32.dll,LockWorkStation"])
    elif OS == "Darwin":
        _run(["pmset", "displaysleepnow"])
    else:
        for c in (["loginctl", "lock-session"], ["xdg-screensaver", "lock"], ["gnome-screensaver-command", "-l"]):
            if shutil.which(c[0]) and _run(c)[0] == 0:
                break
        else:
            return {"ok": False, "error": "No screen locker found (tried loginctl, xdg-screensaver)."}
    return {"ok": True, "result": "Screen locked. For safety I can lock but never unlock - unlock with your password or fingerprint."}


@tool("Unlock the device. Operating systems do not allow apps to unlock, so this explains the options.")
def unlock_screen():
    return {"ok": False, "error": "Operating systems block apps from unlocking the screen (it would defeat the lock). "
                                  "Use your password/fingerprint/Windows Hello. I can wake the display though."}


def _pkg_cmd(action, pkg):
    if OS == "Windows":
        return {"install": ["winget", "install", "-e", "--accept-source-agreements", "--accept-package-agreements", pkg],
                "uninstall": ["winget", "uninstall", "-e", pkg], "update": ["winget", "upgrade", "--all", "--accept-source-agreements"]}[action]
    if OS == "Darwin":
        return {"install": ["brew", "install", pkg], "uninstall": ["brew", "uninstall", pkg], "update": ["brew", "upgrade"]}[action]
    sudo = ["pkexec"] if shutil.which("pkexec") else ["sudo", "-n"]
    if shutil.which("pacman"):
        flag = {"install": ["-S", "--noconfirm", "--needed"], "uninstall": ["-Rns", "--noconfirm"], "update": ["-Syu", "--noconfirm"]}[action]
        return sudo + ["pacman"] + flag + ([pkg] if action != "update" else [])
    if shutil.which("apt-get"):
        a = {"install": ["install", "-y"], "uninstall": ["remove", "-y"], "update": ["upgrade", "-y"]}[action]
        return sudo + ["apt-get"] + a + ([pkg] if action != "update" else [])
    if shutil.which("dnf"):
        a = {"install": ["install", "-y"], "uninstall": ["remove", "-y"], "update": ["upgrade", "-y"]}[action]
        return sudo + ["dnf"] + a + ([pkg] if action != "update" else [])
    return None


def _pkg(action, pkg=""):
    cmd = _pkg_cmd(action, pkg)
    if not cmd:
        return {"ok": False, "error": "No supported package manager (winget, brew, pacman, apt, dnf) found."}
    if action != "update" and not pkg.replace("-", "").replace("_", "").replace(".", "").replace("+", "").isalnum():
        return {"ok": False, "error": "Invalid package name."}
    rc, out = _run(cmd, timeout=900)
    return {"ok": rc == 0, "result": out[-500:] or "done", "error": None if rc == 0 else out[-300:]}


@tool("Install an application/package by name using the system package manager.", {"name": {"type": "STRING"}}, risky=True)
def install_app(name):
    return _pkg("install", name)


@tool("Uninstall an application/package by name.", {"name": {"type": "STRING"}}, risky=True)
def uninstall_app(name):
    return _pkg("uninstall", name)


@tool("Update the system and installed apps/packages.", risky=True)
def update_system():
    return _pkg("update")


@tool("Start a phone call to a number (opens the default calling app / phone link).",
      {"number": {"type": "STRING"}}, risky=True)
def make_call(number):
    num = "".join(c for c in number if c.isdigit() or c == "+")
    if len(num) < 3:
        return {"ok": False, "error": "That doesn't look like a phone number."}
    import webbrowser
    webbrowser.open(f"tel:{num}")
    return {"ok": True, "result": f"Opened the calling app for {num}. Desktops need Phone Link / KDE Connect to place the call."}


def _have_pyautogui():
    try:
        import pyautogui  # noqa
        return True
    except Exception:
        return False


@tool("Type text into the currently focused window (use to operate inside apps).", {"text": {"type": "STRING"}}, risky=True)
def type_text(text):
    if _have_pyautogui():
        import pyautogui
        pyautogui.write(text, interval=0.01)
        return {"ok": True, "result": "Typed."}
    if OS == "Linux":
        for c in (["wtype", text], ["ydotool", "type", text], ["xdotool", "type", "--delay", "10", text]):
            if shutil.which(c[0]):
                return {"ok": _run(c)[0] == 0, "result": "Typed."}
    return {"ok": False, "error": "Install 'pyautogui' (or wtype/xdotool on Linux) to control other apps."}


@tool("Press a keyboard shortcut in the focused window, e.g. 'ctrl+s', 'enter', 'alt+tab'.", {"keys": {"type": "STRING"}}, risky=True)
def press_keys(keys):
    parts = [k.strip().lower() for k in keys.replace(" ", "").split("+") if k.strip()]
    if _have_pyautogui():
        import pyautogui
        pyautogui.hotkey(*parts)
        return {"ok": True, "result": f"Pressed {keys}."}
    if OS == "Linux" and shutil.which("xdotool"):
        return {"ok": _run(["xdotool", "key", "+".join(parts)])[0] == 0, "result": f"Pressed {keys}."}
    if OS == "Linux" and shutil.which("wtype"):
        mods = [m for m in parts[:-1]]
        cmd = ["wtype"] + sum([["-M", m] for m in mods], []) + ["-k", parts[-1]] + sum([["-m", m] for m in mods], [])
        return {"ok": _run(cmd)[0] == 0, "result": f"Pressed {keys}."}
    return {"ok": False, "error": "Install 'pyautogui' (or wtype/xdotool on Linux) to control other apps."}


@tool("Get the current date, time and the OS name.")
def get_time():
    import datetime
    n = datetime.datetime.now().astimezone()
    return {"ok": True, "result": n.strftime("%A, %d %B %Y, %I:%M %p %Z"), "os": OS}
