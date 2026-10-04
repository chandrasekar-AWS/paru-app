"""SQLite store: chat + voice messages grouped by local calendar day (12:00am-11:59pm)."""
import sqlite3, threading, time
from datetime import datetime
from . import config

_lock = threading.RLock()
_conn = None


def conn():
    global _conn
    with _lock:
        if _conn is None:
            _conn = sqlite3.connect(config.HOME / "paru.db", check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.executescript("""
            CREATE TABLE IF NOT EXISTS messages(
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, day TEXT NOT NULL,
                role TEXT NOT NULL, channel TEXT NOT NULL, content TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS idx_day ON messages(day);
            CREATE TABLE IF NOT EXISTS timers(
                id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT, due REAL NOT NULL, fired INTEGER DEFAULT 0);
            """)
        return _conn


def reset_for_tests():
    global _conn
    with _lock:
        if _conn:
            _conn.close()
        _conn = None


def day_key(ts=None):
    return datetime.fromtimestamp(ts or time.time()).strftime("%Y-%m-%d")


def add_message(role, content, channel="text", ts=None):
    ts = ts or time.time()
    with _lock:
        c = conn()
        cur = c.execute("INSERT INTO messages(ts,day,role,channel,content) VALUES(?,?,?,?,?)",
                        (ts, day_key(ts), role, channel, content))
        c.commit()
        return cur.lastrowid


def days():
    with _lock:
        rows = conn().execute(
            "SELECT day, COUNT(*) n, SUM(channel='voice') v, MAX(ts) last FROM messages GROUP BY day ORDER BY day DESC").fetchall()
    return [{"day": r["day"], "label": datetime.strptime(r["day"], "%Y-%m-%d").strftime("%d-%m-%Y"),
             "count": r["n"], "voice": r["v"] or 0, "text": r["n"] - (r["v"] or 0)} for r in rows]


def messages(day):
    with _lock:
        rows = conn().execute("SELECT id,ts,role,channel,content FROM messages WHERE day=? ORDER BY ts,id", (day,)).fetchall()
    return [dict(r) for r in rows]


def recent(n=12):
    with _lock:
        rows = conn().execute("SELECT role,content FROM messages WHERE day=? ORDER BY ts DESC,id DESC LIMIT ?",
                              (day_key(), n)).fetchall()
    return [dict(r) for r in reversed(rows)]


def delete_day(day):
    with _lock:
        conn().execute("DELETE FROM messages WHERE day=?", (day,))
        conn().commit()


def clear_all():
    with _lock:
        conn().execute("DELETE FROM messages")
        conn().commit()
