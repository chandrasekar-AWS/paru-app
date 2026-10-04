"""Browser, web search, download and upload."""
import os, re, html, urllib.parse, webbrowser
from . import tool
from .. import config


def _client(**kw):
    import httpx
    return httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 Paru"}, **kw)


@tool("Open a website or URL in the default browser.", {"url": {"type": "STRING"}})
def open_url(url):
    url = url.strip()
    if re.match(r"^[a-z][a-z0-9+.\-]*:(?!\d)", url, re.I) and not url.lower().startswith(("http://", "https://")):
        return {"ok": False, "error": "Only http/https links can be opened."}
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    webbrowser.open(url)
    return {"ok": True, "result": f"Opened {url}"}


@tool("Search the web and return the top results (title, link, snippet). Use for facts, news, research.",
      {"query": {"type": "STRING"}})
def web_search(query):
    with _client() as c:
        r = c.post("https://html.duckduckgo.com/html/", data={"q": query})
    items = []
    for m in re.finditer(r'class="result__a" href="([^"]+)"[^>]*>(.*?)</a>.*?class="result__snippet"[^>]*>(.*?)</a>', r.text, re.S):
        link, title, snip = m.groups()
        if "uddg=" in link:
            link = urllib.parse.unquote(link.split("uddg=")[1].split("&")[0])
        clean = lambda s: html.unescape(re.sub(r"<.*?>", "", s)).strip()
        items.append({"title": clean(title), "link": link, "snippet": clean(snip)})
        if len(items) >= 5:
            break
    if not items:
        return {"ok": False, "error": "No results (search engine unreachable or blocked)."}
    return {"ok": True, "results": items, "result": "\n".join(f"{i['title']} - {i['snippet']}" for i in items)}


@tool("Open a search results page for the query in the browser.", {"query": {"type": "STRING"}})
def browser_search(query):
    webbrowser.open("https://www.google.com/search?q=" + urllib.parse.quote(query))
    return {"ok": True, "result": f"Searching for {query}"}


@tool("Download a file from a URL into the Paru downloads folder.", {"url": {"type": "STRING"}, "filename": {"type": "STRING"}},
      required=["url"], risky=True)
def download_file(url, filename=""):
    if not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "Only http/https downloads are allowed."}
    name = os.path.basename(filename or urllib.parse.urlparse(url).path) or "download"
    name = re.sub(r"[^\w.\- ]", "_", name)
    dest = config.DOWNLOADS / name
    with _client() as c, c.stream("GET", url) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(65536):
                f.write(chunk)
    return {"ok": True, "result": f"Downloaded to {dest}", "path": str(dest), "bytes": dest.stat().st_size}


@tool("Upload a local file to a URL with an HTTP POST (multipart form).", {"path": {"type": "STRING"}, "url": {"type": "STRING"}}, risky=True)
def upload_file(path, url):
    p = os.path.expanduser(path)
    if not os.path.isfile(p):
        return {"ok": False, "error": f"File not found: {path}"}
    with _client() as c, open(p, "rb") as f:
        r = c.post(url, files={"file": (os.path.basename(p), f)})
    return {"ok": r.status_code < 400, "result": f"Upload finished with HTTP {r.status_code}"}


@tool("Find files by name under the home folder (max 20 results).", {"query": {"type": "STRING"}})
def find_files(query):
    q = query.lower()
    out = []
    for root, dirs, files in os.walk(os.path.expanduser("~")):
        dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "venv", "__pycache__")]
        for fn in files:
            if q in fn.lower():
                out.append(os.path.join(root, fn))
                if len(out) >= 20:
                    return {"ok": True, "files": out, "result": "\n".join(out)}
    return {"ok": True, "files": out, "result": "\n".join(out) or "No matching files."}
