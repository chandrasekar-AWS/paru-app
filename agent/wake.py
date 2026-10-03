"""Decide what a short transcript means: wake up, be quiet, or turn off.

Pure Python, no dependencies, so it is easy to test. The transcript comes from the local recognizer (asr.py).

Why this is not a plain string compare: "Paru" is not an English word, so a speech recognizer writes it as
Paru / Peru / Para / Pero / Parro ... The matcher therefore compares the *shape* of the word (consonant
skeleton P-vowel-R-vowel) instead of its spelling, and it also learns how the recognizer writes the name
for YOUR voice (see learn()).

classify(text, session) returns one of:
  {"kind": "wake", "rest": "..."}   greeting + name (rest = whatever was said after the name)
  {"kind": "stop"}                  "shut up", "stop", "be quiet" ...  -> hide the orb, keep listening for the wake word
  {"kind": "off"}                   "turn off Paru", "go to sleep"      -> stop listening completely
  {"kind": "weak"}                  looks like a greeting but the name is unclear (optionally verified by the cloud)
  {"kind": "none"}                  anything else
`session` is True while the orb is open: then "shut up" works without the name.
"""
import json, os, re
from difflib import SequenceMatcher

GREET = {"a", "hello", "hallo", "hullo", "helo", "hi", "hey", "hay", "hai", "ok", "okay", "okey", "k", "yo", "oh", "so", "uh", "um", "and", "hmm"}
STRICT_BARE = {"paru", "paroo", "parou", "paaru", "baru", "paro"}          # allowed without a greeting ("Paru, what's the time?")
NAME_REF = "paru"

# ------------------------------------------------------------------ helpers


def toks(text):
    t = (text or "").lower().replace("’", "'").replace("‘", "'")
    t = re.sub(r"[^a-z0-9'\s]", " ", t)
    w = [x.strip("'") for x in t.split() if x.strip("'")]
    out, i = [], 0
    while i < len(w):
        if w[i] in ("a", "the", "uh") and i + 1 < len(w) and w[i + 1] in ("low", "lo", "loo"):
            out.append("hello"); i += 2; continue                    # "a low Peru" = "hello Paru"
        if w[i].startswith("hyper") and len(w[i]) <= 8:
            out += ["hi", "pero"]; i += 1; continue                   # "Hyperoo" = "hi Paru"
        if w[i] in ("herro", "hullo", "hellow", "hallow"):
            out.append("hello"); i += 1; continue
        out.append(w[i]); i += 1
    return out


def skel(w):
    """Consonant skeleton: paru / peru / para / parro / parroo / pharu -> 'pVrV'."""
    w = re.sub(r"[^a-z]", "", w.lower()).replace("ph", "p").replace("h", "")
    w = re.sub(r"[aeiouy]+", "V", w)
    return re.sub(r"([^V])\1+", r"\1", w)


def name_like(w):
    """Does this single word sound like the assistant's name?"""
    s = skel(w)
    return bool(re.fullmatch(r"[pb]Vr(V)?[td]?", s)) and len(w) >= 3 and w not in {"pair", "pour", "poor", "pure", "bear", "bore", "beer", "pear", "par", "bar", "part", "port", "bird", "bart", "bert", "burt", "pert", "perd", "bard", "board", "bored", "poured", "pored", "pared"}


def sim(a, b):
    return SequenceMatcher(None, a, b).ratio()


FILL = {"ok", "okay", "uh", "um", "so", "and", "oh", "hmm"}


def pk(s):
    """Rough sound key, so 'Jarvis' / 'Jervis' / 'Jarves' (and b/p, d/t, g/k, c/k, v/f confusions) compare as close."""
    s = re.sub(r"[^a-z]", "", s.lower())
    for a, b in (("ph", "f"), ("ck", "k"), ("kn", "n"), ("wr", "r"), ("wh", "w"), ("gh", ""), ("tch", "ch")):
        s = s.replace(a, b)
    s = re.sub(r"c(?=[eiy])", "s", s)
    s = s.translate(str.maketrans({"c": "k", "q": "k", "z": "s", "v": "f", "w": "f", "b": "p", "d": "t", "g": "k", "h": ""}))
    s = re.sub(r"[aeiouy]+", "a", s)
    return re.sub(r"(.)\1+", r"\1", s)


def cons(w):
    return pk(w).replace("a", "")


def tok_score(a, b):
    """One word against one word: letters, or (when there are enough consonants to be meaningful) the consonant skeleton."""
    raw = sim(a, b)
    ca, cb = cons(a), cons(b)
    return max(raw, 0.97 * sim(ca, cb)) if min(len(ca), len(cb)) >= 2 else raw


def score(seg, v):
    """How well do these transcript words match the phrase? Word by word: the LAST word (the name) must match strongly,
    the greeting before it only loosely (recognisers turn 'hey' into 'hay', 'a', 'hi'). A different number of words
    only counts when the letters are practically identical ('good bye' = 'goodbye')."""
    if not seg or not v:
        return 0.0
    if len(seg) != len(v):
        return 0.95 * sim("".join(seg), "".join(v))
    sc = [tok_score(x, y) for x, y in zip(seg, v)]
    if sc[-1] < 0.75 or any(x < 0.3 for x in sc[:-1]):
        return 0.0
    return (sum(sc[:-1]) * 0.5 + sc[-1] * 2) / (0.5 * (len(sc) - 1) + 2)


def thr(tokens):
    last = len(tokens[-1]) if tokens else 0
    n = len("".join(tokens))
    return 0.82 if last >= 6 and n >= 8 else 0.88 if last >= 4 else 0.93


class Wake:
    def __init__(self, path=None):
        self.path = path
        self.aliases = set()          # normalized name spellings learned from the user's own voice (Paru default phrase)
        self.wake_phrase, self.off_phrase = "hey paru", "turn off paru"
        self.wake_variants, self.off_variants = [], []       # token lists: the typed phrase + how the recogniser wrote it for this person
        if path and os.path.exists(path):
            try:
                d = json.load(open(path, encoding="utf-8"))
                self.aliases = set(d.get("aliases", []))
                self.wake_phrase = d.get("wake", self.wake_phrase); self.off_phrase = d.get("off", self.off_phrase)
                self.wake_variants = [list(v) for v in d.get("wake_variants", [])]; self.off_variants = [list(v) for v in d.get("off_variants", [])]
            except Exception:
                pass
        self._refresh()

    # ---- phrases chosen by the person
    def _refresh(self):
        wt, ot = toks(self.wake_phrase), toks(self.off_phrase)
        self.name = wt[-1] if wt else "paru"
        self.custom = self.name not in {"paru", "peru", "paroo", "baru"}
        for lst, base in ((self.wake_variants, wt), (self.off_variants, ot)):
            if base and base not in lst:
                lst.insert(0, base)

    def configure(self, wake=None, off=None):
        if wake and toks(wake):
            if toks(wake) != toks(self.wake_phrase):
                self.wake_variants = []; self.aliases = set()
            self.wake_phrase = wake.strip()
        if off and toks(off):
            if toks(off) != toks(self.off_phrase):
                self.off_variants = []
            self.off_phrase = off.strip()
        self._refresh(); self._save()

    def learn_phrase(self, kind, transcripts):
        """Remember how the recogniser wrote the phrase for this voice. Garbage (too different) is not kept."""
        target = toks(self.wake_phrase if kind == "wake" else self.off_phrase); lst = self.wake_variants if kind == "wake" else self.off_variants; added = []
        for t in transcripts:
            x = toks(t)
            if x and x not in lst and 0.55 <= score(x, target) < 1.0 and len(x) <= len(target) + 1:
                lst.append(x); added.append(" ".join(x))
        if kind == "wake" and not self.custom:
            added += self.learn(transcripts)
        self._save()
        return added

    def _prefix(self, X, variants):
        """Does the transcript START with one of the phrase variants? -> (tokens used, best score)."""
        best, used = 0.0, 0
        for v in variants:
            n = len(v)
            for s0 in (0, 1):
                if s0 and (not X or X[0] not in FILL or (v and v[0] in FILL)):
                    continue
                for L in sorted({max(1, n - 1), n, n + 1}):
                    seg = X[s0:s0 + L]
                    if not seg or len(seg) < L:
                        continue
                    sc = score(seg, v)
                    if sc > best:
                        best = sc
                    if sc >= thr(v):
                        used = max(used, s0 + L)
        return used, best

    # ---- learning: the user says "hello Paru" a few times, we remember how it was written
    def learn(self, transcripts):
        added = []
        for t in transcripts:
            w = toks(t)
            if len(w) >= 2 and w[0] in GREET:
                a = "".join(w[1:3]) if len(w) > 2 and len(w[1]) <= 3 and len(w[2]) <= 3 else w[1]
                if a and not name_like(a) and a not in self.aliases and a not in {"there", "everyone", "again"}:
                    self.aliases.add(a); added.append(a)
        self._save()
        return added

    def forget(self):
        self.aliases = set(); self.wake_variants = []; self.off_variants = []; self._refresh(); self._save()

    def _save(self):
        if self.path:
            try:
                json.dump({"aliases": sorted(self.aliases), "wake": self.wake_phrase, "off": self.off_phrase,
                           "wake_variants": self.wake_variants, "off_variants": self.off_variants}, open(self.path, "w", encoding="utf-8"))
            except Exception:
                pass

    # ---- word tests
    def is_name(self, w, bare=False):
        w = w.lower()
        if self.custom:
            return w in self.aliases or score([w], [self.name]) >= max(0.8, thr([self.name]))
        if bare:
            return w in STRICT_BARE or w in self.aliases
        return name_like(w) or w in self.aliases or w == NAME_REF or (w in {"par", "per", "pur"} and not bare)

    def _name_at(self, t, i, bare=False):
        """How many tokens starting at i form the name (0 = no name here). Handles 'pa ru' written as two words."""
        if i < len(t) and self.is_name(t[i], bare):
            return 1
        if i + 1 < len(t) and len(t[i]) <= 3 and len(t[i + 1]) <= 3:
            j = t[i] + t[i + 1]
            if self.is_name(j, bare):
                return 2
        return 0

    @staticmethod
    def _strip_garbled_name(t):
        """'shut up peril' / 'turn off power roo': a leftover that sounds a little like the name is the name."""
        t = list(t)
        for _ in range(2):
            if len(t) >= 2 and sim(t[-1], "paru") >= 0.4 and t[-1] not in {"up", "off", "down", "quiet", "stop", "enough"}:
                t.pop()
            elif len(t) >= 2 and t[-1] in {"roo", "ru", "rue", "lou"}:
                t.pop()
        if len(t) >= 2 and t[0] in {"hurry", "harry", "haru", "hero", "herro", "per", "or"} and t[1] in {"turn", "switch", "shut"}:
            t = t[1:]                                    # "Paru, turn off" written as "Hurry turn off"
        return t

    # ---- main entry
    def classify(self, text, session=False):
        t = toks(text)
        if not t:
            return {"kind": "none"}
        s = " ".join(t)
        n_off, b_off = self._prefix(t, self.off_variants) if self.off_variants else (0, 0)
        n_w, b_w = self._prefix(t, self.wake_variants) if (self.custom and not session) else (0, 0)
        if n_off and (len(t) - n_off) <= 2 and not (n_w and b_w >= b_off):
            return {"kind": "off"}                                     # the person's own "turn off" phrase, in any state
        if self.custom and not session:                                # a wake phrase the person chose
            if n_w:
                return {"kind": "wake", "rest": " ".join(t[n_w:])}
            if b_w >= 0.62 and len(t) <= 4:
                return {"kind": "weak"}
            return {"kind": "none"}
        # --- turn off (needs the name unless the orb is open)
        has_name = any(self.is_name(w) for w in t)
        t2 = [w for w in t if not self.is_name(w)]
        t2 = self._strip_garbled_name(t2)
        if has_name or session:
            cands = [" ".join(t2)]
            if session:
                cands.append(" ".join(w for w in t2 if w != "power"))      # the recognizer often writes "turn Paru off" as "turn power off"
            if any(OFF_RE.match(c) for c in cands):
                return {"kind": "off"}
        s_noname = " ".join(t2)
        if session and STOP_RE.match(s_noname if s_noname else s):
            return {"kind": "stop"}
        if session:
            return {"kind": "none"}

        # --- wake: [fillers] greeting [name] [rest...]
        i = 0
        while i < len(t) and i < 3 and t[i] in GREET:
            i += 1
        n = self._name_at(t, i, bare=(i == 0))
        if n:
            return {"kind": "wake", "rest": " ".join(t[i + n:])}
        # the greeting is sometimes swallowed: "Okay, Parroo" -> check the first 4 tokens for a name after any greeting-like word
        for j in range(1, min(len(t), 4)):
            if t[j - 1] in GREET and self._name_at(t, j) and all(w in GREET for w in t[: j]):
                return {"kind": "wake", "rest": " ".join(t[j + self._name_at(t, j):])}
        # greeting but unclear name: short phrase starting with a greeting word, name slot is not an ordinary word
        if t[0] in GREET and 2 <= len(t) <= 3 and t[0] not in {"so", "uh", "um", "and", "hmm", "oh", "k"} and t[1] not in COMMON and \
                (max(sim("".join(t[1:]), "paru"), sim("".join(t[1:]), "peru")) >= 0.4 or re.fullmatch(r"[kthdgcb]Vr(V)?[ltd]?", skel(t[1]))):
            return {"kind": "weak"}
        return {"kind": "none"}


# words that follow a greeting in ordinary conversation: these never count as a weak wake
COMMON = set("""there everyone everybody all guys friend friends again world sir madam mom dad mum man bro buddy you
folks team class people honey darling dear boss doc sweetie love babe baby""".split())

NAME_FILLER = r"(?:ok|okay|please|just|now|hey|hello|hi|yes|so|and|well)"
STOP_RE = re.compile(
    r"^(?:" + NAME_FILLER + r"\s+)*(?:"
    r"shut\s?up|get\s+up|stop(?:\s+(?:it|talking|that|now|please|speaking))*|(?:be|he|we)\s+quiet|quiet(?:\s+please)?|silence|enough|"
    r"that'?s\s+(?:enough|all)|that\s+is\s+(?:enough|all)|go\s+away|dismiss|cancel|never\s?mind|hush|shush|"
    r"bye(?:\s+bye)?|goodbye|good\s?night|thank\s+you\s+that'?s\s+all|okay\s+stop"
    r")(?:\s+(?:please|now|it|up|thanks|thank\s+you))*$")
OFF_RE = re.compile(
    r"^(?:" + NAME_FILLER + r"\s+)*(?:"
    r"(?:turn|switch|shut|power)\s+(?:it\s+|yourself\s+)?(?:off|down)|"
    r"(?:turn|switch)\s+(?:off|down)\s+(?:yourself|please)?|(?:turn|switch)\s+return\s+off|"
    r"go\s+to\s+sleep|sleep|stop\s+listening|exit|quit|go\s+offline|go\s+off|disable|deactivate|"
    r"(?:turn|switch)\s+off\s+listening"
    r")(?:\s+(?:please|now|it|thanks|thank\s+you))*$")
