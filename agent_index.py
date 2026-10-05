#!/usr/bin/env python3
"""Prototype: index de transcripts YouTube -> recherche de moments clippables.

Aucune API key, aucun quota YouTube API. Parse les VTT auto-générés par
yt-dlp, reconstruit le flux de mots (dédup des captions roulantes), découpe
en segments horodatés, indexe en SQLite FTS5, cherche par thème.
"""
import re, os, sys, glob, json, sqlite3, time, unicodedata, html

DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.db")
SUBS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "subs")

TS_RE = r"(\d{2}):(\d{2}):(\d{2})\.(\d{3})"
CUE_RE = re.compile(r"^" + TS_RE + r" --> ")
NOISE = re.compile(r"\[[^\]]*\]|♪|\(\s*[^)]*musique[^)]*\)|^\s*$", re.I)


def ms(h, m, s, x):
    return (int(h) * 3600 + int(m) * 60 + int(s)) * 1000 + int(x)


def parse_vtt(path):
    """Renvoie [(mot, ts_ms)] dédupliqué des captions roulantes."""
    raw = open(path, encoding="utf-8", errors="replace").read()
    acc = []          # mots accumulés: (mot, ts)
    cur_ts = 0
    pending = []      # (ts, mot)
    for block in raw.split("\n\n"):
        lines = [l for l in block.strip().split("\n") if l.strip()]
        if not lines:
            continue
        m = CUE_RE.match(lines[0])
        if not m:
            continue
        cur_ts = ms(*m.groups())
        text = " ".join(lines[1:])
        text = re.sub(r"</?c[^>]*>", "", text)      # balises de style
        text = re.sub(r"<" + TS_RE + r">", " ", text)  # timestamps inline -> espaces
        text = text.replace("\n", " ").strip()
        text = html.unescape(text).replace("\xa0", " ")
        text = re.sub(r"\s+", " ", text)
        if not text or NOISE.match(text):
            continue
        toks = [(w, cur_ts) for w in text.split() if w not in ("♪",)]
        if not toks:
            continue
        # overlap: plus long suffixe de acc == préfixe de toks
        a = [w for w, _ in acc[-60:]]
        b = [w for w, _ in toks]
        k = 0
        for cand in range(min(len(a), len(b), 60), 0, -1):
            if a[-cand:] == b[:cand]:
                k = cand
                break
        acc.extend(toks[k:])
    return acc


def build_segments(words, vid):
    """Regroupe les mots en segments ~12-45s, coupés sur ponctuation forte ou pause."""
    segs, cur = [], []
    for i, (w, ts) in enumerate(words):
        cur.append((w, ts))
        nxt_ts = words[i + 1][1] if i + 1 < len(words) else ts
        pause = nxt_ts - ts
        start = cur[0][1]
        dur = (ts - start) / 1000.0
        end_sentence = w.rstrip('"»)]').endswith((".", "!", "?", "…"))
        if dur >= 12 and (end_sentence or pause > 900) or dur >= 45:
            segs.append((cur[0][1], ts + 1500, " ".join(x for x, _ in cur)))
            cur = []
    if cur and (cur[-1][1] - cur[0][1]) > 3000:
        segs.append((cur[0][1], cur[-1][1] + 1500, " ".join(x for x, _ in cur)))
    return [(vid, s, e, t) for s, e, t in segs]


def build():
    vids = {}
    for line in open(os.path.join(os.path.dirname(SUBS), "videos.txt"), encoding="utf-8"):
        p = line.strip().split("|")
        if len(p) >= 3:
            vids[p[0]] = (p[1], int(p[2]) if p[2].isdigit() else 0)
    files = sorted(f for f in glob.glob(os.path.join(SUBS, "*.fr.vtt")) if "-orig" not in f)
    if os.path.exists(DB):
        os.remove(DB)
    con = sqlite3.connect(DB)
    con.executescript("""
        CREATE TABLE videos(id TEXT PRIMARY KEY, title TEXT, dur INT);
        CREATE TABLE segments(id INTEGER PRIMARY KEY, vid TEXT, start INT, end INT, txt TEXT);
        CREATE VIRTUAL TABLE ftxt USING fts5(txt, content='segments', content_rowid='id',
                                            tokenize="unicode61 remove_diacritics 2");
    """)
    t0 = time.time()
    nseg = nw = 0
    for f in files:
        vid = os.path.basename(f).split(".")[0]
        if vid not in vids:
            continue
        words = parse_vtt(f)
        nw += len(words)
        segs = build_segments(words, vid)
        nseg += len(segs)
        con.execute("INSERT OR REPLACE INTO videos VALUES(?,?,?)", (vid, vids[vid][0], vids[vid][1]))
        con.executemany("INSERT INTO segments(vid,start,end,txt) VALUES(?,?,?,?)", segs)
    con.execute("INSERT INTO ftxt(ftxt) VALUES('rebuild')")
    con.commit()
    dt = time.time() - t0
    tot = sum(v[1] for k, v in vids.items() if k in {os.path.basename(f).split('.')[0] for f in files})
    print(json.dumps({
        "videos": len(files), "mots": nw, "segments": nseg,
        "duree_source_min": round(tot / 60),
        "build_s": round(dt, 1),
        "db_mo": round(os.path.getsize(DB) / 1e6, 2),
    }, ensure_ascii=False, indent=1))


def norm(s):
    s = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in s if not unicodedata.combining(c))


STOP = set("le la les de des du un une et ou en a à au aux ce cet cette ces que qui quoi dont où "
           "il elle on nous vous ils elles je tu me te se son sa ses leur leurs est sont être était "
           "pour par avec sans sur dans pas plus mais comme tout tous toute toutes ça cela c'est".split())


def search(q, limit=8):
    terms = [norm(w) for w in re.findall(r"\w+", q) if norm(w) not in STOP and len(w) > 2]
    if not terms:
        return []
    fts = " OR ".join(f'"{t}"' for t in terms)
    con = sqlite3.connect(DB)
    rows = con.execute("""
        SELECT s.vid, v.title, s.start, s.end, s.txt, bm25(ftxt, 1.0) AS sc
        FROM ftxt JOIN segments s ON s.id = ftxt.rowid JOIN videos v ON v.id = s.vid
        WHERE ftxt MATCH ? ORDER BY sc LIMIT ?
    """, (fts, limit * 3)).fetchall()
    # fusion des segments voisins d'une même vidéo (fenêtre = un "moment")
    res = []
    for vid, title, st, en, txt, sc in rows:
        if res and res[-1]["vid"] == vid and st - res[-1]["end_ms"] < 60000:
            r = res[-1]
            r["end_ms"] = max(r["end_ms"], en)
            r["txt"] += " " + txt
            r["hits"] += 1
        else:
            res.append({"vid": vid, "title": title, "start_ms": st, "end_ms": en,
                        "txt": txt, "hits": 1, "sc": sc})
    for r in res:
        r["score"] = r["hits"] * -r["sc"]
    res.sort(key=lambda r: r["score"], reverse=True)
    return res[:limit]


if __name__ == "__main__":
    if sys.argv[1] == "build":
        build()
    else:
        q = " ".join(sys.argv[2:])
        t0 = time.time()
        out = search(q)
        dt = (time.time() - t0) * 1000
        print(f"\n=== requête: « {q} »  ({dt:.0f} ms) ===")
        for r in out:
            s, e = r["start_ms"] // 1000, r["end_ms"] // 1000
            print(f"\n[{s//60}:{s%60:02d} -> {e//60}:{e%60:02d}]  ({e-s}s)  {r['title'][:70]}")
            print(f"   https://youtu.be/{r['vid']}?t={s}")
            print(f"   {r['txt'][:400]}")
