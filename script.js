// ===== 設定 =====
const BATCH_SIZE = 48; // 一度に描画する枚数(スクロールで追加読み込み)

// ===== 状態 =====
let allItems = [];
let filteredItems = [];
let renderedCount = 0;
let currentTag = "all";
let currentYear = "all";
let lightboxIndex = -1;

// ===== 要素 =====
const gridEl = document.getElementById("grid");
const spinesEl = document.getElementById("spines");
const tagFiltersEl = document.getElementById("tagFilters");
const resultCountEl = document.getElementById("resultCount");
const sentinelEl = document.getElementById("sentinel");
const emptyStateEl = document.getElementById("emptyState");

const lightboxEl = document.getElementById("lightbox");
const lbImg = document.getElementById("lbImg");
const lbDate = document.getElementById("lbDate");
const lbTag = document.getElementById("lbTag");

// ===== データ読み込み =====
fetch("gallery_data.json")
  .then((res) => res.json())
  .then((data) => {
    allItems = data.filter((item) => !item.hidden);
    buildYearSpines();
    applyFilters();
    openFromUrlIfPresent();
  })
  .catch((err) => {
    gridEl.innerHTML = `<p style="color:#9A9186;font-family:monospace;">gallery_data.json を読み込めませんでした。</p>`;
    console.error(err);
  });

// URLに ?id=画像ID が付いている場合、その画像を自動でライトボックス表示する
// (いいねスプレッドシートなどから直接開けるようにするためのリンク機能)
function openFromUrlIfPresent() {
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get("id");
  if (!targetId) return;

  const index = allItems.findIndex((item) => item.id === targetId);
  if (index === -1) return; // 非表示中、または存在しないIDの場合は何もしない

  openLightbox(index);
}

// タグの並び順(小さいほど先に表示)。misc(その他)は常に最後。
const TAG_RANK = { analog: 0, copic: 1, digital: 2 };

function sortRank(item) {
  if (item.misc) return 3;
  return TAG_RANK[item.tag] ?? 2;
}

// 画像がどの背表紙(年 or その他 or 不明)に属するかを判定
function getGroupKey(item) {
  if (item.misc) return "misc";
  return item.year || "unknown";
}

// ===== 年の背表紙ナビを生成 =====
function buildYearSpines() {
  const counts = {};
  allItems.forEach((item) => {
    const key = getGroupKey(item);
    counts[key] = (counts[key] || 0) + 1;
  });

  const years = Object.keys(counts)
    .filter((k) => k !== "unknown" && k !== "misc")
    .sort((a, b) => b.localeCompare(a));
  if (counts["unknown"]) years.push("unknown");
  if (counts["misc"]) years.push("misc"); // 「その他」は一番下に固定

  // デフォルトの表示年を決定(2026年があればそれを初期選択、なければ「すべて」)
  const defaultYear = "2026";
  if (counts[defaultYear]) {
    currentYear = defaultYear;
  }

  const allBtn = makeSpineButton("all", `すべて`, allItems.length, currentYear === "all");
  spinesEl.appendChild(allBtn);

  years.forEach((key) => {
    const label = key === "unknown" ? "不明" : key === "misc" ? "その他" : key + "年";
    spinesEl.appendChild(makeSpineButton(key, label, counts[key], currentYear === key));
  });

  // モバイル用トグルボタンの初期ラベルを反映
  const toggleLabelEl = document.getElementById("shelfToggleLabel");
  if (toggleLabelEl) {
    toggleLabelEl.textContent =
      currentYear === "all" ? "すべて" :
      currentYear === "unknown" ? "不明" :
      currentYear === "misc" ? "その他" : currentYear + "年";
  }
}

function makeSpineButton(value, label, count, isActive) {
  const btn = document.createElement("button");
  btn.className = "spine" + (isActive ? " is-active" : "");
  btn.dataset.year = value;
  btn.innerHTML = `<span>${label}</span><span class="n">${count}</span>`;
  btn.addEventListener("click", () => {
    currentYear = value;
    document
      .querySelectorAll(".spine")
      .forEach((el) => el.classList.toggle("is-active", el.dataset.year === value));
    applyFilters();

    // モバイル用トグルボタンのラベルを更新して閉じる
    const toggleLabel = document.getElementById("shelfToggleLabel");
    const toggleBtn = document.getElementById("shelfToggle");
    const spinesNav = document.getElementById("spines");
    if (toggleLabel) toggleLabel.textContent = label;
    if (spinesNav) spinesNav.classList.remove("is-open");
    if (toggleBtn) toggleBtn.setAttribute("aria-expanded", "false");
  });
  return btn;
}

const shelfToggleBtn = document.getElementById("shelfToggle");
if (shelfToggleBtn) {
  shelfToggleBtn.addEventListener("click", () => {
    const spinesNav = document.getElementById("spines");
    const isOpen = spinesNav.classList.toggle("is-open");
    shelfToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
}

// ===== タグフィルター =====
tagFiltersEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  currentTag = btn.dataset.tag;
  document
    .querySelectorAll(".chip")
    .forEach((el) => el.classList.toggle("is-active", el === btn));
  applyFilters();
});

// ===== フィルター適用 =====
function isRealYear(key) {
  return key !== "unknown" && key !== "misc" && key !== "all";
}

function applyFilters() {
  filteredItems = allItems.filter((item) => {
    const tagOk = currentTag === "all" || item.tag === currentTag;
    const key = getGroupKey(item);
    const yearOk = currentYear === "all" || key === currentYear;
    return tagOk && yearOk;
  });

  // アナログ > コピック > デジタル > その他 の順に並べ、各グループ内は日付の新しい順
  filteredItems.sort((a, b) => {
    const rankDiff = sortRank(a) - sortRank(b);
    if (rankDiff !== 0) return rankDiff;
    return (b.date || "0000-00-00").localeCompare(a.date || "0000-00-00");
  });

  renderedCount = 0;
  gridEl.innerHTML = "";
  resultCountEl.textContent = `${filteredItems.length}件`;
  emptyStateEl.hidden = filteredItems.length > 0;

  renderNextBatch();
}

// ===== グリッド描画(バッチ単位) =====
function renderNextBatch() {
  const next = filteredItems.slice(renderedCount, renderedCount + BATCH_SIZE);
  const frag = document.createDocumentFragment();

  next.forEach((item) => {
    const globalIndex = allItems.indexOf(item);
    const tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.index = globalIndex;

    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = item.thumb;
    img.alt = item.date ? `${item.date}の作品` : "作品";
    img.addEventListener("load", () => img.classList.add("is-loaded"));

    const badge = document.createElement("span");
    badge.className = "tile-badge";
    badge.textContent = item.tag === "analog" ? "A" : item.tag === "copic" ? "C" : "D";

    tile.appendChild(img);
    tile.appendChild(badge);
    tile.addEventListener("click", () => openLightbox(globalIndex));

    frag.appendChild(tile);
  });

  gridEl.appendChild(frag);
  renderedCount += next.length;
}

// ===== 無限スクロール =====
const io = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting && renderedCount < filteredItems.length) {
    renderNextBatch();
  }
});
io.observe(sentinelEl);

// ===== いいね機能(Google Apps Script経由) =====
const LIKE_API_URL = "https://script.google.com/macros/s/AKfycbyz76dW1NZX_bW38_8-sbyq5x3fOKZyaQPm7lXa-hs2MbemIzc0A9sqSHFQYEEoGA/exec";

function getLikedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem("likedItems") || "[]"));
  } catch {
    return new Set();
  }
}

function saveLikedSet(set) {
  localStorage.setItem("likedItems", JSON.stringify([...set]));
}

async function likeRequest(id, action) {
  const url = `${LIKE_API_URL}?id=${encodeURIComponent(id)}&action=${action}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("like api error");
  return res.json();
}

let likeRefreshTimer = null;

async function refreshLikeUI(item) {
  const likeBtn = document.getElementById("lbLike");
  const countEl = document.getElementById("lbLikeCount");
  const liked = getLikedSet().has(item.id);
  likeBtn.classList.toggle("is-liked", liked);

  // 連続スワイプ中は毎回通信しない。同じ画像に少し留まった時だけ取得する。
  if (likeRefreshTimer) clearTimeout(likeRefreshTimer);
  const requestedId = item.id;
  likeRefreshTimer = setTimeout(async () => {
    countEl.textContent = "…";
    try {
      const data = await likeRequest(requestedId, "get");
      console.log("[いいね] get結果:", data);
      // タイマー発火までの間にさらに別の画像へ移動していたら、古い結果は反映しない
      const currentItem = allItems[lightboxIndex];
      if (currentItem && currentItem.id === requestedId) {
        countEl.textContent = data.count ?? "0";
      }
    } catch (err) {
      console.error("[いいね] 取得エラー:", err);
      const currentItem = allItems[lightboxIndex];
      if (currentItem && currentItem.id === requestedId) {
        countEl.textContent = "-";
      }
    }
  }, 300);
}

async function toggleLike(item) {
  const likedSet = getLikedSet();
  const likeBtn = document.getElementById("lbLike");
  const countEl = document.getElementById("lbLikeCount");

  // 連打で押した感触を出すための小さなポップアニメーション
  likeBtn.classList.remove("pop");
  void likeBtn.offsetWidth; // 再生し直すためのリフロー
  likeBtn.classList.add("pop");

  // 取り消し(アンいいね)は行わず、押すたびに必ず+1する(連打しても数が減らないようにするため)
  likedSet.add(item.id);
  saveLikedSet(likedSet);
  likeBtn.classList.add("is-liked");

  try {
    const data = await likeRequest(item.id, "up");
    console.log("[いいね] 更新結果:", data);
    countEl.textContent = data.count ?? "0";
  } catch (err) {
    console.error("[いいね] 更新エラー:", err);
    // 連打を許可しているので、通信エラーのたびにアラートを出すとうるさい。ログのみに留める。
  }
}

document.getElementById("lbLike").addEventListener("click", () => {
  const item = allItems[lightboxIndex];
  if (item) toggleLike(item);
});

// ===== ライトボックス =====
function openLightbox(globalIndex) {
  lightboxIndex = globalIndex;
  showLightboxItem();
  lightboxEl.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  const item = allItems[lightboxIndex];
  lightboxEl.hidden = true;
  document.body.style.overflow = "";

  // ライトボックス内で年をまたいで移動していた場合、閉じた時にグリッド側の年も合わせる
  if (item) {
    const key = getGroupKey(item);
    if (isRealYear(currentYear) && isRealYear(key) && key !== currentYear) {
      currentYear = key;
      document
        .querySelectorAll(".spine")
        .forEach((el) => el.classList.toggle("is-active", el.dataset.year === key));
      const toggleLabel = document.getElementById("shelfToggleLabel");
      if (toggleLabel) toggleLabel.textContent = key + "年";
      applyFilters();
    }
  }
}

function showLightboxItem() {
  const item = allItems[lightboxIndex];
  if (!item) return;
  lbImg.src = item.full;
  lbImg.alt = item.date ? `${item.date}の作品` : "作品";
  lbDate.textContent = item.date || "日付不明";
  lbTag.textContent = item.tag === "analog" ? "アナログ" : item.tag === "copic" ? "コピック" : "デジタル";
  refreshLikeUI(item);
  preloadNeighborImages();
}

// 前後の画像をあらかじめ裏で読み込んでおき、スワイプ/次へ・前への表示を速くする
function preloadNeighborImages() {
  const navItems = getLightboxNavItems();
  const visibleIndexes = navItems.map((it) => allItems.indexOf(it));
  const pos = visibleIndexes.indexOf(lightboxIndex);
  if (pos === -1 || visibleIndexes.length < 2) return;

  const prevPos = (pos - 1 + visibleIndexes.length) % visibleIndexes.length;
  const nextPos = (pos + 1) % visibleIndexes.length;

  [prevPos, nextPos].forEach((p) => {
    const item = allItems[visibleIndexes[p]];
    if (item && item.full) {
      const img = new Image();
      img.src = item.full;
    }
  });
}

// ライトボックスの「次へ/前へ」専用の並び順リストを作る。
// 実年を選んでいる時だけ、その年→過去の年…と続けて移動できるようにする
// (グリッド自体は選んだ年だけに絞ったまま変えない)
function getLightboxNavItems() {
  if (currentYear === "all" || !isRealYear(currentYear)) {
    return filteredItems;
  }
  const items = allItems.filter((item) => {
    const tagOk = currentTag === "all" || item.tag === currentTag;
    const key = getGroupKey(item);
    return tagOk && isRealYear(key) && key <= currentYear;
  });
  items.sort((a, b) => {
    const yearDiff = (b.year || "0000").localeCompare(a.year || "0000");
    if (yearDiff !== 0) return yearDiff;
    const rankDiff = sortRank(a) - sortRank(b);
    if (rankDiff !== 0) return rankDiff;
    return (b.date || "0000-00-00").localeCompare(a.date || "0000-00-00");
  });
  return items;
}

function stepLightbox(delta) {
  const navItems = getLightboxNavItems();
  const visibleIndexes = navItems.map((it) => allItems.indexOf(it));
  const pos = visibleIndexes.indexOf(lightboxIndex);
  if (pos === -1) return;
  const nextPos = (pos + delta + visibleIndexes.length) % visibleIndexes.length;
  lightboxIndex = visibleIndexes[nextPos];
  showLightboxItem();
}

document.getElementById("lbClose").addEventListener("click", closeLightbox);
document.getElementById("lbPrev").addEventListener("click", () => stepLightbox(-1));
document.getElementById("lbNext").addEventListener("click", () => stepLightbox(1));

lightboxEl.addEventListener("click", (e) => {
  if (e.target === lightboxEl) closeLightbox();
});

document.addEventListener("keydown", (e) => {
  if (lightboxEl.hidden) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft") stepLightbox(-1);
  if (e.key === "ArrowRight") stepLightbox(1);
});

// ===== スマホのスワイプで画像送り =====
let touchStartX = 0;
let touchStartY = 0;

lightboxEl.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  },
  { passive: true }
);

lightboxEl.addEventListener(
  "touchend",
  (e) => {
    if (!touchStartX && !touchStartY) return;
    const touch = e.changedTouches[0];
    const diffX = touch.clientX - touchStartX;
    const diffY = touch.clientY - touchStartY;
    const SWIPE_THRESHOLD = 50; // これ以上横に動いたらスワイプとみなす

    // 横方向の動きが縦方向より大きい時だけスワイプとして扱う(縦スクロールと誤認しないように)
    if (Math.abs(diffX) > SWIPE_THRESHOLD && Math.abs(diffX) > Math.abs(diffY)) {
      if (diffX < 0) {
        stepLightbox(1); // 左スワイプ -> 次の画像へ
      } else {
        stepLightbox(-1); // 右スワイプ -> 前の画像へ
      }
    }
    touchStartX = 0;
    touchStartY = 0;
  },
  { passive: true }
);
