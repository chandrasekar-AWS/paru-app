"""Timers persisted in SQLite, so they survive restarts. A background thread fires them."""
import threading, time
from . import tool
from .. import db, events

_started = False


def _fmt(sec):
    sec = int(round(sec))
    h, r = divmod(sec, 3600)
    m, s = divmod(r, 60)
    return " ".join(x for x in (f"{h} hour{'s' if h != 1 else ''}" if h else "", f"{m} minute{'s' if m != 1 else ''}" if m else "",
                                f"{s} second{'s' if s != 1 else ''}" if s and not h else "") if x) or "0 seconds"


@tool("Set a countdown timer. seconds = total duration in seconds (convert minutes/hours yourself).",
      {"seconds": {"type": "NUMBER"}, "label": {"type": "STRING"}}, required=["seconds"])
def set_timer(seconds, label=""):
    seconds = float(seconds)
    if seconds <= 0 or seconds > 7 * 86400:
        return {"ok": False, "error": "Timer must be between 1 second and 7 days."}
    c = db.conn()
    cur = c.execute("INSERT INTO timers(label,due) VALUES(?,?)", (label or "", time.time() + seconds))
    c.commit()
    start()
    return {"ok": True, "result": f"Timer set for {_fmt(seconds)}" + (f" ({label})" if label else ""), "id": cur.lastrowid}


@tool("List active timers.")
def list_timers():
    rows = db.conn().execute("SELECT id,label,due FROM timers WHERE fired=0 ORDER BY due").fetchall()
    now = time.time()
    return {"ok": True, "timers": [{"id": r["id"], "label": r["label"], "remaining": _fmt(max(0, r["due"] - now))} for r in rows],
            "result": "No active timers." if not rows else "; ".join(f"{_fmt(max(0, r['due'] - now))} left" + (f" ({r['label']})" if r["label"] else "") for r in rows)}


@tool("Cancel all active timers.")
def cancel_timers():
    c = db.conn()
    n = c.execute("UPDATE timers SET fired=1 WHERE fired=0").rowcount
    c.commit()
    return {"ok": True, "result": f"Cancelled {n} timer(s)."}


def _loop():
    while True:
        try:
            now = time.time()
            rows = db.conn().execute("SELECT id,label FROM timers WHERE fired=0 AND due<=?", (now,)).fetchall()
            for r in rows:
                db.conn().execute("UPDATE timers SET fired=1 WHERE id=?", (r["id"],))
                db.conn().commit()
                msg = f"Your timer is done{(': ' + r['label']) if r['label'] else ''}."
                db.add_message("assistant", msg, "text")
                events.publish("notify", title="Timer", text=msg, speak=True)
        except Exception:
            pass
        time.sleep(0.5)


def start():
    global _started
    if not _started:
        _started = True
        threading.Thread(target=_loop, daemon=True, name="timers").start()
