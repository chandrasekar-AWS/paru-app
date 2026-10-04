"""Mail over IMAP/SMTP with an app password (Gmail, Outlook, Yahoo...). Credentials stay on this device."""
import email, imaplib, smtplib, ssl
from email.header import decode_header, make_header
from email.message import EmailMessage
from email.utils import parseaddr
from . import tool
from .. import config


def _cfg():
    m = config.load()["mail"]
    if not (m["address"] and m["app_password"]):
        raise RuntimeError("Mail isn't set up yet. Open Settings -> Mail and add your address and an app password.")
    return m


def _h(v):
    try:
        return str(make_header(decode_header(v or "")))
    except Exception:
        return v or ""


def _body(msg):
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and "attachment" not in str(part.get("Content-Disposition")):
                return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
        return ""
    p = msg.get_payload(decode=True)
    return p.decode(msg.get_content_charset() or "utf-8", "replace") if p else ""


@tool("Check the email inbox. Returns the latest messages (sender, subject, date, short preview). unread_only=true for unread.",
      {"limit": {"type": "NUMBER"}, "unread_only": {"type": "BOOLEAN"}}, required=[])
def check_mail(limit=5, unread_only=True):
    m = _cfg()
    limit = max(1, min(int(limit or 5), 15))
    box = imaplib.IMAP4_SSL(m["imap_host"])
    try:
        box.login(m["address"], m["app_password"])
        box.select("INBOX", readonly=True)
        _, data = box.search(None, "UNSEEN" if unread_only else "ALL")
        ids = data[0].split()[-limit:][::-1]
        out = []
        for i in ids:
            _, d = box.fetch(i, "(BODY.PEEK[])")
            msg = email.message_from_bytes(d[0][1])
            out.append({"id": i.decode(), "from": _h(msg["From"]), "subject": _h(msg["Subject"]), "date": msg["Date"],
                        "preview": " ".join(_body(msg).split())[:200]})
    finally:
        try:
            box.logout()
        except Exception:
            pass
    if not out:
        return {"ok": True, "mails": [], "result": "No unread mail." if unread_only else "Inbox is empty."}
    return {"ok": True, "mails": out, "result": "\n".join(f"#{x['id']} from {x['from']}: {x['subject']}" for x in out)}


@tool("Reply to an email by its id (from check_mail) or send a new email if 'to' is given.",
      {"id": {"type": "STRING"}, "body": {"type": "STRING"}, "to": {"type": "STRING"}, "subject": {"type": "STRING"}},
      required=["body"], risky=True)
def send_reply(body, id="", to="", subject=""):
    m = _cfg()
    out = EmailMessage()
    out["From"] = m["address"]
    if id:
        box = imaplib.IMAP4_SSL(m["imap_host"])
        box.login(m["address"], m["app_password"])
        box.select("INBOX", readonly=True)
        _, d = box.fetch(str(id).encode(), "(BODY.PEEK[HEADER])")
        orig = email.message_from_bytes(d[0][1])
        box.logout()
        out["To"] = parseaddr(orig.get("Reply-To") or orig["From"])[1]
        s = _h(orig["Subject"])
        out["Subject"] = s if s.lower().startswith("re:") else "Re: " + s
        if orig["Message-ID"]:
            out["In-Reply-To"] = orig["Message-ID"]
            out["References"] = orig["Message-ID"]
    elif to:
        out["To"] = to
        out["Subject"] = subject or "(no subject)"
    else:
        return {"ok": False, "error": "I need an email id to reply to, or a recipient."}
    out.set_content(body)
    with smtplib.SMTP_SSL(m["smtp_host"], 465, context=ssl.create_default_context()) as s:
        s.login(m["address"], m["app_password"])
        s.send_message(out)
    return {"ok": True, "result": f"Sent to {out['To']}."}
