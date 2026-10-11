# Build songs.json (Mandarin/Taiwanese-scene favorites) from the Apple Music library export.
import csv,re,json,sys
src=sys.argv[1]
r=list(csv.DictReader(open(src,encoding='utf-8-sig')))
han=re.compile(r'[一-鿿]'); kana=re.compile(r'[぀-ヿ]'); hangul=re.compile(r'[가-힯]')
FOREIGN=['Avril Lavigne','TAEYEON','YOASOBI','理芽','李泳知','朴宰範','藤井風','魔力紅樂團','星野源','比爾威德斯','防彈少年團',
         '松任谷由實','海莉清子','久石讓','Dynamicduo','多米尼克·菲克']
keep,drop,seen=[],[],set()
for x in r:
    if x['Type']!='Favorite': continue
    t,a=x['Track name'],x['Artist name']
    if (t,a) in seen: continue
    seen.add((t,a))
    ok=(han.search(t) or han.search(a)) and not kana.search(t+a+x['Album']) and not hangul.search(t+a+x['Album']) \
       and not any(f in a for f in FOREIGN)
    (keep if ok else drop).append(x)
out=[{"appleId":x['Apple - id'],"title":x['Track name'],"artist":x['Artist name'],"album":x['Album'],"isrc":x['ISRC'],
      "live":bool(re.search(r'\blive\b|現場',x['Track name'],re.I)),"youtubeId":None} for x in keep]
json.dump(out,open('songs.json','w'),ensure_ascii=False,indent=1)
with open('excluded.csv','w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f); w.writerow(['title','artist','album'])
    for x in drop: w.writerow([x['Track name'],x['Artist name'],x['Album']])
print(len(out),'kept,',len(drop),'excluded,',sum(o['live'] for o in out),'live')
