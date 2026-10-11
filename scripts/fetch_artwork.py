"""Add album artwork and release year to data/songs.json from the iTunes lookup API.

Uses each song's Apple Music id (from the library export). Songs that already have
"artwork" are skipped, so re-runs only fetch what is missing.
"""
import json, time, urllib.request

SONGS = "data/songs.json"

songs = json.load(open(SONGS, encoding="utf-8"))
todo = [s for s in songs if "artwork" not in s and s.get("appleId", "").isdigit()]
print(f"{len(todo)} songs need artwork")
for i in range(0, len(todo), 150):
    batch = todo[i:i + 150]
    ids = ",".join(s["appleId"] for s in batch)
    url = f"https://itunes.apple.com/lookup?id={ids}&country=tw&entity=song"
    for attempt in range(3):
        try:
            data = json.load(urllib.request.urlopen(url, timeout=30))
            break
        except Exception as e:
            print("  lookup error:", e)
            time.sleep(10 * (attempt + 1))
    else:
        continue
    found = {str(r.get("trackId")): r for r in data.get("results", []) if r.get("wrapperType") == "track"}
    for s in batch:
        r = found.get(s["appleId"])
        s["artwork"] = r["artworkUrl100"].replace("100x100bb", "600x600bb") if r and r.get("artworkUrl100") else None
        s["year"] = int(r["releaseDate"][:4]) if r and r.get("releaseDate") else None
    time.sleep(3)
json.dump(songs, open(SONGS, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("with artwork:", sum(1 for s in songs if s.get("artwork")), "of", len(songs))
