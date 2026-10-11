# 前奏猜歌

聽前奏猜歌名的小遊戲，題庫以台灣華語流行歌為主。

## 怎麼運作

- `data/songs.json`：題庫，從 Apple Music 收藏匯出後用 `scripts/build_songs.py` 篩出華語歌。
- `scripts/resolve_youtube.py`：幫每首歌找 YouTube 官方音檔（錄音室版，從 0 秒開始），由 GitHub Actions 自動執行，結果寫回 `data/songs.json`，沒把握的歌列在 `data/review.csv`。
- `index.html` / `app.js` / `style.css`：遊戲本體，純前端，用隱藏的 YouTube 播放器只播聲音。

新增歌曲：把歌加進 `data/songs.json`（`youtubeId` 留 `null`）推上去，Actions 會自動補上影片 ID。
