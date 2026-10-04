"""Calendar from any iCal (.ics) feed - Google Calendar's 'secret address in iCal format', Outlook, iCloud, or a local file."""
import re
from datetime import datetime, timedelta, timezone, date
from . import tool
from .. import config


def _load(src):
    if src.startswith(("http://", "https://", "webcal://")):
        import httpx
        return httpx.get(src.replace("webcal://", "https://"), timeout=20, follow_redirects=True).text
    with open(src, encoding="utf-8") as f:
        return f.read()


def _unfold(t):
    return re.sub(r"\r?\n[ \t]", "", t)


def _dt(val, params):
    val = val.strip()
    if "VALUE=DATE" in params or re.fullmatch(r"\d{8}", val):
        d = datetime.strptime(val[:8], "%Y%m%d")
        return d.astimezone(), True
    if val.endswith("Z"):
        return datetime.strptime(val, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).astimezone(), False
    return datetime.strptime(val[:15], "%Y%m%dT%H%M%S").astimezone(), False


def parse_events(text):
    evs = []
    for blk in re.findall(r"BEGIN:VEVENT(.*?)END:VEVENT", _unfold(text), re.S):
        f = {}
        for line in blk.strip().splitlines():
            if ":" not in line:
                continue
            k, v = line.split(":", 1)
            f[k.split(";")[0].upper()] = (k, v)
        if "DTSTART" not in f:
            continue
        try:
            start, allday = _dt(f["DTSTART"][1], f["DTSTART"][0])
            end = _dt(f["DTEND"][1], f["DTEND"][0])[0] if "DTEND" in f else start + timedelta(hours=1)
        except Exception:
            continue
        ev = {"title": f.get("SUMMARY", ("", "(no title)"))[1].replace("\\,", ","), "start": start, "end": end, "allday": allday,
              "location": f.get("LOCATION", ("", ""))[1].replace("\\,", ",")}
        # basic recurrence (DAILY/WEEKLY/MONTHLY/YEARLY) expansion handled by caller via rrule text
        ev["rrule"] = f.get("RRULE", ("", ""))[1]
        evs.append(ev)
    return evs


def _expand(ev, win_start, win_end):
    if not ev["rrule"]:
        if ev["end"] > win_start and ev["start"] < win_end:
            yield ev
        return
    r = dict(p.split("=", 1) for p in ev["rrule"].split(";") if "=" in p)
    step = {"DAILY": timedelta(days=1), "WEEKLY": timedelta(weeks=1)}.get(r.get("FREQ"))
    interval = int(r.get("INTERVAL", 1))
    dur = ev["end"] - ev["start"]
    until = None
    if "UNTIL" in r:
        try:
            until = _dt(r["UNTIL"], "")[0]
        except Exception:
            pass
    count = int(r["COUNT"]) if "COUNT" in r else None
    cur, n = ev["start"], 0
    while cur < win_end and n < 2000:
        if until and cur > until or (count and n >= count):
            break
        if cur + dur > win_start:
            yield {**ev, "start": cur, "end": cur + dur}
        n += 1
        if step:
            cur += step * interval
        elif r.get("FREQ") == "MONTHLY":
            m = cur.month - 1 + interval
            try:
                cur = cur.replace(year=cur.year + m // 12, month=m % 12 + 1)
            except ValueError:
                cur = cur + timedelta(days=30 * interval)
        elif r.get("FREQ") == "YEARLY":
            cur = cur.replace(year=cur.year + interval)
        else:
            break


@tool("Check the calendar. days = how many days ahead to look (1 = today only).", {"days": {"type": "NUMBER"}}, required=[])
def check_calendar(days=1):
    src = config.load()["calendar_ics"]
    if not src:
        return {"ok": False, "error": "Calendar isn't set up. Open Settings -> Calendar and paste your iCal link (Google Calendar: Settings -> Integrate calendar -> Secret address in iCal format)."}
    days = max(1, min(int(days or 1), 31))
    now = datetime.now().astimezone()
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=days)
    out = []
    for ev in parse_events(_load(src)):
        out.extend(_expand(ev, start, end))
    out.sort(key=lambda e: e["start"])
    rows = [{"title": e["title"], "when": e["start"].strftime("%a %d %b") + (" (all day)" if e["allday"] else e["start"].strftime(" %I:%M %p")),
             "location": e["location"]} for e in out[:25]]
    if not rows:
        return {"ok": True, "events": [], "result": "Nothing on your calendar." if days == 1 else f"Nothing in the next {days} days."}
    return {"ok": True, "events": rows, "result": "\n".join(f"{r['when']}: {r['title']}" + (f" @ {r['location']}" if r["location"] else "") for r in rows)}
