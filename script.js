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
    allItems = data;
    buildYearSpines();
    applyFilters();
  })
  .catch((err) => {
    gridEl.innerHTML = `<p style="color:#9A9186;font-family:monospace;">gallery_data.json を読み込めませんでした。</p>`;
    console.error(err);
  });

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

  const allBtn = makeSpineButton("all", `すべて`, allItems.length, true);
  spinesEl.appendChild(allBtn);

  years.forEach((key) => {
    const label = key === "unknown" ? "不明" : key === "misc" ? "その他" : key + "年";
    spinesEl.appendChild(makeSpineButton(key, label, counts[key], false));
  });
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
  });
  return btn;
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
function applyFilters() {
  filteredItems = allItems.filter((item) => {
    const tagOk = currentTag === "all" || item.tag === currentTag;
    const yearOk = currentYear === "all" || getGroupKey(item) === currentYear;
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

// ===== ライトボックス =====
function openLightbox(globalIndex) {
  lightboxIndex = globalIndex;
  showLightboxItem();
  lightboxEl.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  lightboxEl.hidden = true;
  document.body.style.overflow = "";
}

function showLightboxItem() {
  const item = allItems[lightboxIndex];
  if (!item) return;
  lbImg.src = item.full;
  lbImg.alt = item.date ? `${item.date}の作品` : "作品";
  lbDate.textContent = item.date || "日付不明";
  lbTag.textContent = item.tag === "analog" ? "アナログ" : item.tag === "copic" ? "コピック" : "デジタル";
}

function stepLightbox(delta) {
  // 現在のフィルター条件内で前後移動する
  const visibleIndexes = filteredItems.map((it) => allItems.indexOf(it));
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
