"""Thread-safe pub/sub that fans events out to every connected UI websocket."""
import asyncio, threading

_subs = set()
_loop = None
_lock = threading.Lock()
_last = {}


def bind(loop):
    global _loop
    _loop = loop


def subscribe():
    q = asyncio.Queue(maxsize=200)
    with _lock:
        _subs.add(q)
    return q


def unsubscribe(q):
    with _lock:
        _subs.discard(q)


def publish(type_, **data):
    ev = {"type": type_, **data}
    if type_ in ("orb", "status"):
        _last[type_] = ev

    def _put():
        for q in list(_subs):
            try:
                q.put_nowait(ev)
            except asyncio.QueueFull:
                pass
    if _loop and _loop.is_running():
        _loop.call_soon_threadsafe(_put)
    else:
        try:
            _put()
        except Exception:
            pass
    return ev


def last(type_):
    return _last.get(type_)
