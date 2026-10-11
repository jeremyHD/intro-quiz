"""Fill in youtubeId for each song in data/songs.json.

Searches YouTube for the official "<artist> - Topic" audio upload (studio version, starts at 0s),
falls back to an "official audio" style upload, and skips MVs / live versions.
Songs that already have a youtubeId are left alone, so the script can be re-run safely.
Writes data/review.csv listing every song that was not a confident Topic match.
"""
import csv, json, re, sys, time, unicodedata, urllib.request, urllib.error
import yt_dlp

SONGS = "data/songs.json"
REVIEW = "data/review.csv"
BAD = re.compile(r"\b(mv|m/v|live|cover|karaoke|ktv|lyrics?|remix|reaction)\b|翻唱|現場|演唱會|伴奏|動態歌詞|歌詞版|教學|純音樂", re.I)


def norm(s):
    s = unicodedata.normalize("NFKC", s).lower()
    s = re.sub(r"\(.*?\)|（.*?）|\[.*?\]|【.*?】", "", s)
    return re.sub(r"[\W_]+", "", s)


def clean_title(t):
    # "二十二 (Live)" -> "二十二", "牛頭馬面 (feat. Melo)" -> "牛頭馬面"
    return re.sub(r"\s*[\(（].*?[\)）]", "", t).strip() or t


def main_artist(a):
    return re.split(r"\s*(?:&|,|、|feat\.)\s*", a)[0].strip()


def embeddable(vid):
    url = f"https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v={vid}"
    try:
        urllib.request.urlopen(url, timeout=15).read()
        return True
    except urllib.error.HTTPError:
        return False
    except Exception:
        return True  # network hiccup: don't reject


ydl = yt_dlp.YoutubeDL({"quiet": True, "extract_flat": True, "skip_download": True, "noplaylist": True})


def search(q, n=8):
    for attempt in range(3):
        try:
            return ydl.extract_info(f"ytsearch{n}:{q}", download=False).get("entries") or []
        except Exception as e:
            print("  search error:", e, file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    return []


def pick(song):
    title, artist = clean_title(song["title"]), main_artist(song["artist"])
    nt = norm(title)
    results = search(f"{artist} {title} topic") + search(f"{artist} {title} official audio", 5)
    seen = set()
    best = None
    for e in results:
        vid = e.get("id")
        if not vid or vid in seen:
            continue
        seen.add(vid)
        vt, ch = e.get("title") or "", e.get("channel") or e.get("uploader") or ""
        dur = e.get("duration") or 0
        if BAD.search(vt) or (dur and (dur < 60 or dur > 600)):
            continue
        title_ok = nt and nt in norm(vt)
        if ch.endswith("- Topic") and title_ok:
            score = 3
        elif title_ok and re.search(r"official audio|audio|官方音[檔档]|官方音频", vt, re.I):
            score = 2
        elif title_ok:
            score = 1
        else:
            continue
        if (best is None or score > best[0]) and embeddable(vid):
            best = (score, vid, vt, ch)
            if score == 3:
                break
    return best


def main():
    songs = json.load(open(SONGS, encoding="utf-8"))
    todo = [s for s in songs if not s.get("youtubeId")]
    print(f"{len(todo)} songs to resolve")
    for i, s in enumerate(todo, 1):
        best = pick(s)
        if best:
            s["youtubeId"], s["ytTitle"], s["ytChannel"] = best[1], best[2], best[3]
            s["match"] = {3: "topic", 2: "audio", 1: "other"}[best[0]]
        else:
            s["match"] = "none"
        print(f"[{i}/{len(todo)}] {s['artist']} - {s['title']}: {s['match']} {s.get('youtubeId') or ''}")
        if i % 25 == 0:
            json.dump(songs, open(SONGS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        time.sleep(1)
    json.dump(songs, open(SONGS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    with open(REVIEW, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["match", "artist", "title", "youtubeId", "ytTitle", "ytChannel"])
        for s in songs:
            if s.get("match") != "topic":
                w.writerow([s.get("match"), s["artist"], s["title"], s.get("youtubeId") or "", s.get("ytTitle", ""), s.get("ytChannel", "")])
    counts = {}
    for s in songs:
        counts[s.get("match")] = counts.get(s.get("match"), 0) + 1
    print("summary:", counts)


if __name__ == "__main__":
    main()
