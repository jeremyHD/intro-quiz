// 前奏猜歌: hear the first seconds of a song, guess the title. Each skip or wrong guess unlocks more of the intro.
const STAGES = [1, 2, 4, 7, 11, 15]; // seconds unlocked per attempt
const MAX = STAGES[STAGES.length - 1];

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
let attempt = 0;      // index into STAGES
let done = false;
let player = null;
let playerReady = false;
let stopTimer = null;
let picked = null;    // song chosen from the suggestion list
let activeIdx = -1;

const norm = (s) => s.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
const label = (s) => `${s.title}${s.artist ? " — " + s.artist : ""}`;

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
function renderStats() {
  const st = store.get("stats", { streak: 0, wins: 0, played: 0 });
  $("streak").textContent = st.streak;
  $("wins").textContent = st.wins;
  $("played").textContent = st.played;
}
function record(win) {
  const st = store.get("stats", { streak: 0, wins: 0, played: 0 });
  st.played++;
  if (win) { st.wins++; st.streak++; } else st.streak = 0;
  store.set("stats", st);
  renderStats();
}

// ---------- round ----------
function newRound() {
  song = nextSong();
  attempt = 0;
  done = false;
  picked = null;
  $("slots").innerHTML = STAGES.map(() => "<li></li>").join("");
  $("result").hidden = true;
  $("guessArea").hidden = false;
  $("input").value = "";
  hideSuggest();
  updateStage();
  $("hint").textContent = "按播放聽前奏";
  if (playerReady) player.cueVideoById({ videoId: song.youtubeId, startSeconds: 0 });
}

function limit() { return done ? MAX : STAGES[attempt]; }

function updateStage() {
  [...$("slots").children].forEach((li, i) => li.classList.toggle("current", !done && i === attempt));
  $("barAllowed").style.width = `${(limit() / MAX) * 100}%`;
  $("barProgress").style.width = "0";
  $("limitLabel").textContent = limit() < MAX ? `${limit()}s` : "";
  const more = attempt < STAGES.length - 1 ? STAGES[attempt + 1] - STAGES[attempt] : 0;
  $("skipSec").textContent = more;
  const off = done || !playerReady;
  $("input").disabled = off;
  $("skipBtn").disabled = off;
  $("submitBtn").disabled = off;
  $("playBtn").disabled = !playerReady;
}

function mark(text, cls) {
  const li = $("slots").children[attempt];
  li.textContent = text;
  li.className = cls;
}

function advance() {
  if (attempt >= STAGES.length - 1) return finish(false);
  attempt++;
  updateStage();
  play();
}

function skip() {
  if (done) return;
  mark(`跳過（${STAGES[attempt]}s）`, "skipped");
  advance();
}

function submit() {
  if (done) return;
  const guess = picked || findExact($("input").value);
  if (!guess) {
    $("hint").textContent = "從清單選一首歌再送出";
    return;
  }
  $("input").value = "";
  picked = null;
  hideSuggest();
  // Same title by the same artist counts, even if it's a different entry (e.g. duplicate releases).
  const right = guess.appleId === song.appleId ||
    (norm(guess.title) === norm(song.title) && norm(guess.artist) === norm(song.artist));
  if (right) {
    mark(`✓ ${label(guess)}`, "right");
    finish(true);
  } else {
    mark(`✗ ${label(guess)}`, "wrong");
    advance();
  }
}

function finish(win) {
  done = true;
  record(win);
  updateStage();
  $("guessArea").hidden = true;
  $("result").hidden = false;
  const v = $("verdict");
  v.textContent = win ? `答對了！只聽了 ${STAGES[attempt]} 秒` : "沒猜到，答案是";
  v.className = "verdict " + (win ? "good" : "bad");
  $("ansTitle").textContent = song.title;
  $("ansArtist").textContent = song.artist;
  $("ansAlbum").textContent = song.album ? `《${song.album}》` : "";
  play();
}

// ---------- playback ----------
function play() {
  if (!playerReady) return;
  clearInterval(stopTimer);
  player.seekTo(0, true);
  player.playVideo();
  $("hint").textContent = "";
  const lim = limit();
  stopTimer = setInterval(() => {
    const t = player.getCurrentTime() || 0;
    $("barProgress").style.width = `${Math.min(t / MAX, 1) * 100}%`;
    if (t >= lim) {
      player.pauseVideo();
      clearInterval(stopTimer);
    }
  }, 50);
}

window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player("yt", {
    width: 200,
    height: 200,
    playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
    events: {
      onReady() {
        playerReady = true;
        if (song) player.cueVideoById({ videoId: song.youtubeId, startSeconds: 0 });
        updateStage();
      },
      onError(e) {
        // 100: removed, 101/150: embedding disabled. Drop the song for this session and move on.
        console.warn("YouTube error", e.data, song);
        songs = songs.filter((s) => s !== song);
        $("hint").textContent = "這首播不了，換下一首";
        newRound();
      },
    },
  });
};

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
}

$("input").addEventListener("input", (e) => {
  picked = null;
  showSuggest(search(e.target.value));
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

$("playBtn").onclick = play;
$("skipBtn").onclick = skip;
$("submitBtn").onclick = submit;
$("nextBtn").onclick = () => { if (playerReady) player.pauseVideo(); clearInterval(stopTimer); newRound(); };

// ---------- boot ----------
fetch("data/songs.json")
  .then((r) => r.json())
  .then((all) => {
    // Only songs matched to official studio audio; "other" matches may be covers or MVs.
    songs = all.filter((s) => s.youtubeId && ["art", "topic", "audio"].includes(s.match));
    renderStats();
    newRound();
  })
  .catch(() => { $("hint").textContent = "題庫載入失敗"; });
