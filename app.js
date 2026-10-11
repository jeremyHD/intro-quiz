// 華語秒猜歌: hear the first fraction of a song, guess the title. Each skip or wrong guess unlocks a longer clip.
const LEVELS = [
  { name: "簡單", stages: [1, 2, 4, 8, 15], mult: 1 },
  { name: "普通", stages: [0.5, 1, 3, 8, 15], mult: 1.5 },
  { name: "困難", stages: [0.1, 0.5, 2, 8, 15], mult: 2 },
  { name: "專家", stages: [0.1, 0.3, 1, 3, 8], mult: 3 },
  { name: "不可能", stages: [0.1, 0.2, 0.5, 1, 2], mult: 5 },
];
const POINTS = [100, 70, 40, 20, 10]; // by attempt the answer was found on, times the level multiplier
const RING = 2 * Math.PI * 56;

const $ = (id) => document.getElementById(id);
const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

let songs = [];
let song = null;      // current answer
let level = Math.min(store.get("level", 0), LEVELS.length - 1);
let attempt = 0;      // index into stages: how many clips are unlocked, minus one
let selected = 0;     // which unlocked clip the play button plays
let done = false;
let player = null;
let playerReady = false;
let clip = null;      // { limit } while a clip is waiting to start or playing
let stopTimer = null;
let raf = null;
let picked = null;    // song chosen from the suggestion list
let activeIdx = -1;

const stages = () => LEVELS[level].stages;
const fmt = (s) => `${s}`;
const norm = (s) => s.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const label = (s) => `${s.title}${s.artist ? " — " + s.artist : ""}`;

function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 1800);
}

// ---------- deck: shuffled order kept across reloads so songs don't repeat until all are played ----------
function nextSong() {
  let deck = store.get("deck", []).filter((id) => songs.some((s) => s.appleId === id));
  if (!deck.length) {
    deck = songs.map((s) => s.appleId);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  const id = deck.shift();
  store.set("deck", deck);
  return songs.find((s) => s.appleId === id);
}

// ---------- stats ----------
const STATS0 = { score: 0, streak: 0, best: 0 };
function renderStats() {
  const st = { ...STATS0, ...store.get("stats2", {}) };
  $("score").textContent = st.score;
  $("streak").textContent = st.streak;
  $("best").textContent = st.best;
}
function record(win) {
  const st = { ...STATS0, ...store.get("stats2", {}) };
  let gained = 0;
  if (win) {
    gained = Math.round(POINTS[attempt] * LEVELS[level].mult);
    st.score += gained;
    st.streak++;
    st.best = Math.max(st.best, st.streak);
  } else st.streak = 0;
  store.set("stats2", st);
  renderStats();
  return gained;
}

// ---------- rendering ----------
function renderTabs() {
  $("tabs").innerHTML = "";
  LEVELS.forEach((l, i) => {
    const b = document.createElement("button");
    b.textContent = l.name;
    b.role = "tab";
    b.className = i === level ? "on" : "";
    b.setAttribute("aria-selected", i === level);
    b.onclick = () => {
      if (i === level) return;
      level = i;
      store.set("level", level);
      renderTabs();
      newRound(song); // same song, fresh attempts at the new level
    };
    $("tabs").appendChild(b);
  });
}

function renderSteps() {
  const st = stages();
  $("steps").innerHTML = "";
  st.forEach((sec, i) => {
    const b = document.createElement("button");
    b.textContent = `${fmt(sec)}s`;
    const open = done || i <= attempt;
    b.disabled = !open || !playerReady;
    b.className = (open ? "open " : "") + (i === selected ? "on" : "");
    b.onclick = () => { selected = i; renderSteps(); play(); };
    $("steps").appendChild(b);
  });
  $("clipLabel").innerHTML = `${fmt(st[selected])}<small>s</small>`;
}

function renderControls() {
  const st = stages();
  const more = attempt < st.length - 1 ? +(st[attempt + 1] - st[attempt]).toFixed(1) : 0;
  $("skipBtn").textContent = more ? `跳過 (+${more}s)` : "放棄";
  const off = done || !playerReady;
  $("input").disabled = off;
  $("skipBtn").disabled = off;
  $("submitBtn").disabled = off || !$("input").value.trim();
  $("playBtn").disabled = !playerReady;
  renderSteps();
}

function addAttempt(text, cls) {
  const li = document.createElement("li");
  li.className = cls;
  const len = document.createElement("span");
  len.className = "len";
  len.textContent = `${fmt(stages()[attempt])}s`;
  const what = document.createElement("span");
  what.className = "what";
  what.textContent = text;
  li.append(len, what);
  $("attempts").appendChild(li);
}

function renderHowto() {
  const st = stages().map((s) => `${s} 秒`).join(" → ");
  $("howtoText").textContent =
    `按下播放，只會聽到 ${stages()[0]} 秒的前奏。在搜尋框輸入歌名或歌手，選出答案送出。` +
    `猜錯或跳過，就會解鎖更長的片段：${st}。越早猜中、難度越高，得分越多。猜完可以把同一首歌傳給朋友挑戰。`;
}

// ---------- round ----------
function newRound(same) {
  stop();
  song = same || nextSong();
  attempt = 0;
  selected = 0;
  done = false;
  picked = null;
  $("attempts").innerHTML = "";
  $("result").hidden = true;
  $("guessArea").hidden = false;
  $("input").value = "";
  hideSuggest();
  renderHowto();
  renderControls();
  $("hint").textContent = playerReady ? "按播放聽前奏" : "播放器載入中…";
  if (playerReady) player.cueVideoById({ videoId: song.youtubeId, startSeconds: 0 });
}

function advance() {
  if (attempt >= stages().length - 1) return finish(false);
  attempt++;
  selected = attempt;
  renderControls();
  play();
}

function skip() {
  if (done) return;
  addAttempt("— 跳過 —", "skipped");
  advance();
}

function submit() {
  if (done) return;
  const guess = picked || findExact($("input").value);
  if (!guess) {
    toast("從清單選一首歌再送出");
    return;
  }
  $("input").value = "";
  picked = null;
  hideSuggest();
  // Same title by the same artist counts, even if it's a different entry (e.g. duplicate releases).
  const right = guess.appleId === song.appleId ||
    (norm(guess.title) === norm(song.title) && norm(guess.artist) === norm(song.artist));
  if (right) {
    addAttempt(`✓ ${label(guess)}`, "right");
    finish(true);
  } else {
    addAttempt(`✗ ${label(guess)}`, "wrong");
    advance();
  }
}

function finish(win) {
  done = true;
  const gained = record(win);
  selected = stages().length - 1;
  renderControls();
  $("guessArea").hidden = true;
  $("result").hidden = false;
  const v = $("verdict");
  v.textContent = win ? `答對了！只聽了 ${stages()[attempt]} 秒，+${gained} 分` : "沒猜到，答案是";
  v.className = "verdict" + (win ? " good" : "");
  const art = $("ansArt");
  art.hidden = false;
  art.onerror = () => {
    // Apple artwork missing -> YouTube thumbnail (art tracks use the cover) -> no image.
    art.onerror = () => { art.hidden = true; };
    art.src = `https://i.ytimg.com/vi/${song.youtubeId}/hqdefault.jpg`;
  };
  art.src = song.artwork || `https://i.ytimg.com/vi/${song.youtubeId}/hqdefault.jpg`;
  $("ansTitle").textContent = song.title;
  $("ansArtist").textContent = song.year ? `${song.artist} · ${song.year}` : song.artist;
  $("ansAlbum").textContent = song.album || "";
  $("ytLink").href = `https://www.youtube.com/watch?v=${song.youtubeId}`;
  $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });
  play();
}

// ---------- playback ----------
// The clip timer starts when YouTube reports PLAYING, so buffering doesn't eat into short clips.
function play() {
  if (!playerReady) return;
  stop();
  clip = { limit: stages()[selected] };
  $("hint").textContent = "";
  player.seekTo(0, true);
  player.playVideo();
}

function startClip() {
  if (!clip || clip.started) return;
  clip.started = performance.now() - (player.getCurrentTime() || 0) * 1000;
  const ms = clip.limit * 1000;
  stopTimer = setTimeout(() => { player.pauseVideo(); stop(); }, Math.max(0, clip.started + ms - performance.now()));
  $("playBtn").classList.add("playing");
  const tick = () => {
    if (!clip) return;
    const p = Math.min((performance.now() - clip.started) / ms, 1);
    $("ringFill").style.strokeDashoffset = RING * (1 - p);
    raf = requestAnimationFrame(tick);
  };
  tick();
}

function stop() {
  clearTimeout(stopTimer);
  cancelAnimationFrame(raf);
  clip = null;
  $("playBtn").classList.remove("playing");
  $("ringFill").style.strokeDashoffset = RING;
}

function initPlayer() {
  if (player) return;
  player = new YT.Player("yt", {
    width: 200,
    height: 200,
    playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
    events: {
      onReady() {
        playerReady = true;
        if (song) player.cueVideoById({ videoId: song.youtubeId, startSeconds: 0 });
        renderControls();
        if (!done) $("hint").textContent = "按播放聽前奏";
      },
      onStateChange(e) {
        if (e.data === YT.PlayerState.PLAYING) startClip();
      },
      onError(e) {
        // 100: removed, 101/150: embedding disabled. Drop the song for this session and move on.
        console.warn("YouTube error", e.data, song);
        songs = songs.filter((s) => s !== song);
        toast("這首播不了，換下一首");
        newRound();
      },
    },
  });
}

// app.js loads before the API script, but cover the case where the API is already there (cached).
if (window.YT && YT.Player) initPlayer();
else window.onYouTubeIframeAPIReady = initPlayer;

setTimeout(() => {
  if (!playerReady) $("hint").textContent = "YouTube 播放器載不出來，試試重新整理或暫停廣告阻擋外掛";
}, 15000);

// ---------- search ----------
function findExact(text) {
  const q = norm(text);
  if (!q) return null;
  return songs.find((s) => norm(s.title) === q || norm(label(s)) === q) || null;
}

function search(text) {
  const q = norm(text);
  if (!q) return [];
  const hits = [];
  for (const s of songs) {
    const t = norm(s.title), a = norm(s.artist);
    let score = -1;
    if (t.startsWith(q)) score = 0;
    else if (t.includes(q)) score = 1;
    else if (a.includes(q)) score = 2;
    if (score >= 0) hits.push([score, s]);
  }
  hits.sort((x, y) => x[0] - y[0] || x[1].title.length - y[1].title.length);
  // Hide duplicates of the same title + artist.
  const seen = new Set();
  return hits.map((h) => h[1]).filter((s) => {
    const k = norm(s.title) + "|" + norm(s.artist);
    return seen.has(k) ? false : seen.add(k);
  }).slice(0, 30);
}

function showSuggest(list) {
  const ul = $("suggest");
  activeIdx = -1;
  if (!list.length) return hideSuggest();
  ul.innerHTML = "";
  list.forEach((s) => {
    const li = document.createElement("li");
    li.textContent = s.title;
    const small = document.createElement("small");
    small.textContent = s.artist;
    li.appendChild(small);
    li.onmousedown = (e) => { e.preventDefault(); choose(s); };
    ul.appendChild(li);
  });
  ul.hidden = false;
  ul._list = list;
}
function hideSuggest() { $("suggest").hidden = true; activeIdx = -1; }
function choose(s) {
  picked = s;
  $("input").value = label(s);
  hideSuggest();
  renderControls();
}

$("input").addEventListener("input", (e) => {
  picked = null;
  showSuggest(search(e.target.value));
  renderControls();
});
$("input").addEventListener("keydown", (e) => {
  const ul = $("suggest");
  const items = [...ul.children];
  if (!ul.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    activeIdx = (activeIdx + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle("active", i === activeIdx));
    items[activeIdx].scrollIntoView({ block: "nearest" });
  } else if (e.key === "Enter" && !e.isComposing) {
    e.preventDefault();
    if (!ul.hidden && activeIdx >= 0) choose(ul._list[activeIdx]);
    else submit();
  } else if (e.key === "Escape") hideSuggest();
});
$("input").addEventListener("blur", () => setTimeout(hideSuggest, 100));

// ---------- share: a link that opens the same song at the same level ----------
async function share() {
  const url = new URL(location.href.split("?")[0]);
  url.searchParams.set("s", song.appleId);
  url.searchParams.set("d", level);
  const text = `這首前奏你幾秒猜得出來？`;
  try {
    if (navigator.share) return await navigator.share({ title: "華語秒猜歌", text, url: url.href });
    await navigator.clipboard.writeText(`${text} ${url.href}`);
    toast("已複製挑戰連結");
  } catch (e) {
    if (e.name !== "AbortError") prompt("複製這個連結傳給朋友", url.href);
  }
}

$("playBtn").onclick = play;
$("skipBtn").onclick = skip;
$("submitBtn").onclick = submit;
$("shareBtn").onclick = share;
$("nextBtn").onclick = () => { if (playerReady) player.pauseVideo(); newRound(); };
document.addEventListener("keydown", (e) => {
  if (done && e.key === "Enter" && document.activeElement.tagName !== "BUTTON") { e.preventDefault(); $("nextBtn").click(); }
});

// ---------- boot ----------
fetch("data/songs.json")
  .then((r) => r.json())
  .then((all) => {
    // Only songs matched to official studio audio; "other" matches may be covers or MVs.
    songs = all.filter((s) => s.youtubeId && ["art", "topic", "audio"].includes(s.match));
    const params = new URLSearchParams(location.search);
    const shared = songs.find((s) => s.appleId === params.get("s"));
    if (shared && LEVELS[params.get("d")]) level = +params.get("d");
    if (shared) history.replaceState(null, "", location.pathname);
    renderTabs();
    renderStats();
    newRound(shared);
  })
  .catch(() => { $("hint").textContent = "題庫載入失敗"; });
