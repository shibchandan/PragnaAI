const API = window.location.origin.startsWith("http") ? window.location.origin : "http://127.0.0.1:8080";
const DOC_PREFIX = "doc-";
const DIMS = 16;
const COL = {
  cs: "#49d6ff",
  math: "#ff7aa2",
  food: "#ffbf5a",
  sports: "#73f0aa",
  doc: "#b7ff8a",
  default: "#8ea9c6"
};
const CATEGORY_LABEL = {
  cs: "CS / Algorithms",
  math: "Mathematics",
  food: "Food / Cooking",
  sports: "Sports / Games",
  doc: "Document chunk"
};
const DIM_COL = [
  "#49d6ff", "#49d6ff", "#49d6ff", "#49d6ff",
  "#ff7aa2", "#ff7aa2", "#ff7aa2", "#ff7aa2",
  "#ffbf5a", "#ffbf5a", "#ffbf5a", "#ffbf5a",
  "#73f0aa", "#73f0aa", "#73f0aa", "#73f0aa"
];
const KW = {
  cs: ["algorithm", "data", "tree", "graph", "array", "linked", "hash", "stack", "queue", "sort", "binary", "dynamic", "programming", "recursion", "complexity", "pointer", "node", "search", "insert", "bfs", "dfs", "heap", "trie"],
  math: ["calculus", "matrix", "probability", "theorem", "integral", "derivative", "linear", "algebra", "equation", "function", "prime", "modular", "combinatorics", "permutation", "eigenvalue", "statistics", "proof"],
  food: ["food", "pizza", "sushi", "ramen", "pasta", "recipe", "cook", "eat", "restaurant", "dish", "ingredient", "flavor", "spice", "noodle", "bread", "croissant", "taco", "fish", "rice", "soup"],
  sports: ["sport", "basketball", "football", "tennis", "chess", "swim", "game", "play", "score", "team", "athlete", "competition", "match", "tournament", "olympic", "dribble", "tackle", "serve"]
};

let demoItems = [];
let docItems = [];
let allItems = [];
let scenePoints = [];
let projectedPoints = [];
let hoverItem = null;
let hoverProjection = null;
let hitIds = new Set();
let queryPoint = null;
let searchResults = [];
let selAlgo = "hnsw";
let sceneExtent = 1;
let rotationX = -0.42;
let rotationY = 0.84;
let zoom = 1.15;
let dragging = false;
let lastPointer = null;
let autoSpin = true;

const sc = document.getElementById("scatter");
const ctx = sc.getContext("2d");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function switchTab(name, button) {
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn === button));
  document.querySelectorAll(".pane").forEach((pane) => pane.classList.toggle("active", pane.id === `pane-${name}`));
  if (name === "docs") loadDocList();
}

function setAlgo(button) {
  document.querySelectorAll(".algo-pill").forEach((pill) => pill.classList.remove("active"));
  button.classList.add("active");
  selAlgo = button.dataset.algo;
  document.getElementById("heroAlgo").textContent = button.textContent;
  document.getElementById("queryMeta").textContent = `The active search strategy is ${button.textContent}.`;
}

function textToEmbedding(text) {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  const score = { cs: 0, math: 0, food: 0, sports: 0 };
  for (const word of words) {
    for (const [category, keywords] of Object.entries(KW)) {
      for (const keyword of keywords) {
        if (word.includes(keyword) || keyword.startsWith(word)) {
          score[category] += 0.35;
          break;
        }
      }
    }
  }
  const peak = Math.max(...Object.values(score), 0.01);
  const emb = new Array(DIMS).fill(0.08);
  const normalized = (value) => Math.min((value / peak) * 0.88, 0.94);
  const jitter = () => (Math.random() - 0.5) * 0.04;
  const fill = (index, value) => {
    if (value < 0.01) return;
    const base = normalized(value);
    emb[index] = Math.max(0.05, base + jitter());
    emb[index + 1] = Math.max(0.05, base + jitter());
    emb[index + 2] = Math.max(0.05, base * 0.92 + jitter());
    emb[index + 3] = Math.max(0.05, base * 0.87 + jitter());
  };
  fill(0, score.cs);
  fill(4, score.math);
  fill(8, score.food);
  fill(12, score.sports);
  return emb;
}

function toDocVisualItem(doc) {
  return {
    id: `${DOC_PREFIX}${doc.id}`,
    sourceDocId: doc.id,
    metadata: doc.title,
    category: "doc",
    embedding: textToEmbedding(`${doc.title} ${doc.preview || ""}`),
    preview: doc.preview || "",
    words: doc.words || 0
  };
}

async function fetchStoredDocs() {
  const res = await fetch(`${API}/doc/list`);
  if (!res.ok) throw new Error("Could not load document list.");
  return await res.json();
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function normalize(vec) {
  const mag = Math.sqrt(dot(vec, vec));
  if (mag < 1e-10) return vec.map(() => 0);
  return vec.map((value) => value / mag);
}

function orthogonalize(vec, basis) {
  let out = vec.slice();
  for (const axis of basis) {
    const factor = dot(out, axis);
    out = out.map((value, idx) => value - factor * axis[idx]);
  }
  return out;
}

function powerIter(centered, basis) {
  const dims = centered[0].length;
  let vector = normalize(new Array(dims).fill(0).map(() => Math.random() - 0.5));
  vector = normalize(orthogonalize(vector, basis));
  if (dot(vector, vector) < 1e-10) {
    vector = new Array(dims).fill(0);
    if (dims > 0) vector[0] = 1;
  }

  for (let iter = 0; iter < 220; iter++) {
    const next = new Array(dims).fill(0);
    for (const row of centered) {
      const projection = dot(row, vector);
      for (let i = 0; i < dims; i++) next[i] += row[i] * projection;
    }
    const ortho = orthogonalize(next, basis);
    const normalized = normalize(ortho);
    const drift = normalized.reduce((sum, value, idx) => sum + Math.abs(value - vector[idx]), 0);
    vector = normalized;
    if (drift < 1e-8) break;
  }
  return vector;
}

function pca3D(embeddings) {
  const n = embeddings.length;
  if (n === 0) return [];
  if (n === 1) return [[0, 0, 0]];

  const dims = embeddings[0].length;
  const mean = new Array(dims).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dims; i++) mean[i] += emb[i] / n;
  }
  const centered = embeddings.map((emb) => emb.map((value, idx) => value - mean[idx]));
  const pc1 = powerIter(centered, []);
  const pc2 = powerIter(centered, [pc1]);
  const pc3 = powerIter(centered, [pc1, pc2]);
  return centered.map((row) => [dot(row, pc1), dot(row, pc2), dot(row, pc3)]);
}

function rebuildProjection() {
  allItems = [...demoItems, ...docItems];
  if (!allItems.length) {
    scenePoints = [];
    sceneExtent = 1;
    updateTopStats();
    updateSceneCopy();
    return;
  }

  const coords = pca3D(allItems.map((item) => item.embedding));
  scenePoints = allItems.map((item, idx) => ({
    x: coords[idx][0],
    y: coords[idx][1],
    z: coords[idx][2],
    item
  }));
  sceneExtent = Math.max(
    1,
    ...scenePoints.map((point) => Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)))
  );
  updateTopStats();
  updateSceneCopy();
}

function updateTopStats() {
  const label = `${demoItems.length} demo vectors - ${docItems.length} doc projections - ${DIMS} dims`;
  document.getElementById("statsLabel").textContent = label;
  document.getElementById("sceneCount").textContent = String(allItems.length);
  document.getElementById("highlightCount").textContent = String(hitIds.size);
}

function updateSceneCopy() {
  const title = document.getElementById("sceneTitle");
  const body = document.getElementById("sceneBody");
  const tag = document.getElementById("sceneTag");

  if (hoverItem) {
    title.textContent = hoverItem.metadata;
    body.textContent = `${CATEGORY_LABEL[hoverItem.category] || hoverItem.category} point. Hover highlights let you inspect exact semantic labels without leaving the 3D view.`;
    tag.textContent = hoverItem.category === "doc" ? "Document projection" : "Semantic point";
    return;
  }

  if (queryPoint && hitIds.size) {
    title.textContent = "Active query neighborhood";
    body.textContent = `${hitIds.size} nearby points are highlighted around the latest query anchor. Search results on the right stay in sync with the 3D view.`;
    tag.textContent = "Query in focus";
    return;
  }

  title.textContent = "Semantic landscape";
  body.textContent = "Drag to orbit. Scroll to zoom. Demo vectors, documents, and active query neighborhoods all live in the same coordinate space.";
  tag.textContent = "Live retrieval scene";
}

function resetView() {
  rotationX = -0.42;
  rotationY = 0.84;
  zoom = 1.15;
  document.getElementById("cameraState").textContent = `${zoom.toFixed(2)}x`;
}

function toggleSpin() {
  autoSpin = !autoSpin;
  document.getElementById("spinBtn").textContent = autoSpin ? "Pause spin" : "Resume spin";
}

function resizeCanvas() {
  const rect = sc.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  sc.width = Math.max(1, Math.floor(rect.width * dpr));
  sc.height = Math.max(1, Math.floor(rect.height * dpr));
  sc.style.width = `${rect.width}px`;
  sc.style.height = `${rect.height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function rotatePoint(point) {
  const ny = point.y / sceneExtent;
  const nx = point.x / sceneExtent;
  const nz = point.z / sceneExtent;
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);

  let rx = nx * cosY - nz * sinY;
  let rz = nx * sinY + nz * cosY;
  let ry = ny * cosX - rz * sinX;
  rz = ny * sinX + rz * cosX;
  return { x: rx, y: ry, z: rz };
}

function projectPoint(point, width, height) {
  const rotated = rotatePoint(point);
  const camera = 3.3 / zoom;
  const perspective = camera / (camera - rotated.z);
  const radius = Math.min(width, height) * 0.31;
  return {
    x: width * 0.5 + rotated.x * radius * perspective,
    y: height * 0.54 + rotated.y * radius * perspective * 0.86,
    z: rotated.z,
    size: Math.max(3.5, 7 * perspective),
    alpha: Math.min(1, Math.max(0.22, 0.28 + (rotated.z + 1.2) * 0.36)),
    perspective,
    item: point.item,
    world: point
  };
}

function projectWorldPoint(world, width, height) {
  return projectPoint(world, width, height);
}

function drawWirePoint(point, width, height) {
  const projected = projectWorldPoint(point, width, height);
  return projected;
}

function drawSceneGrid(width, height) {
  ctx.save();
  ctx.lineWidth = 1;
  for (let y = -0.72; y <= 0.72; y += 0.24) {
    ctx.beginPath();
    let started = false;
    for (let x = -1.1; x <= 1.1; x += 0.05) {
      const p = drawWirePoint({ x, y, z: -1.05, item: {} }, width, height);
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.strokeStyle = "rgba(118, 151, 187, 0.08)";
    ctx.stroke();
  }

  for (let x = -1.1; x <= 1.1; x += 0.22) {
    ctx.beginPath();
    let started = false;
    for (let y = -0.72; y <= 0.72; y += 0.05) {
      const p = drawWirePoint({ x, y, z: -1.05, item: {} }, width, height);
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else {
        ctx.lineTo(p.x, p.y);
      }
    }
    ctx.strokeStyle = "rgba(118, 151, 187, 0.06)";
    ctx.stroke();
  }
  ctx.restore();
}

function drawAxes(width, height) {
  const origin = drawWirePoint({ x: 0, y: 0, z: 0, item: {} }, width, height);
  const axisX = drawWirePoint({ x: 1.1, y: 0, z: 0, item: {} }, width, height);
  const axisY = drawWirePoint({ x: 0, y: 1.1, z: 0, item: {} }, width, height);
  const axisZ = drawWirePoint({ x: 0, y: 0, z: 1.1, item: {} }, width, height);

  ctx.save();
  ctx.lineWidth = 1.4;

  ctx.strokeStyle = "rgba(73, 214, 255, 0.45)";
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(axisX.x, axisX.y);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 122, 162, 0.38)";
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(axisY.x, axisY.y);
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 191, 90, 0.34)";
  ctx.beginPath();
  ctx.moveTo(origin.x, origin.y);
  ctx.lineTo(axisZ.x, axisZ.y);
  ctx.stroke();

  ctx.fillStyle = "rgba(212, 231, 255, 0.72)";
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillText("PC1", axisX.x + 8, axisX.y);
  ctx.fillText("PC2", axisY.x + 8, axisY.y);
  ctx.fillText("PC3", axisZ.x + 8, axisZ.y);
  ctx.restore();
}

function drawQueryConnections(width, height) {
  if (!queryPoint || !hitIds.size) return;
  const queryProjection = projectWorldPoint(queryPoint, width, height);
  for (const point of scenePoints) {
    if (!hitIds.has(point.item.id)) continue;
    const target = projectWorldPoint(point, width, height);
    ctx.save();
    ctx.strokeStyle = "rgba(73, 214, 255, 0.16)";
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 8]);
    ctx.beginPath();
    ctx.moveTo(queryProjection.x, queryProjection.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.restore();
  }
}

function drawQueryAnchor(width, height) {
  if (!queryPoint) return;
  const point = projectWorldPoint(queryPoint, width, height);
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
  ctx.shadowBlur = 24;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const radius = i % 2 === 0 ? 12 : 5.5;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPoints(width, height) {
  projectedPoints = scenePoints.map((point) => projectPoint(point, width, height));
  projectedPoints.sort((a, b) => a.z - b.z);

  for (const projected of projectedPoints) {
    const category = projected.item.category;
    const color = COL[category] || COL.default;
    const hit = hitIds.has(projected.item.id);
    const hovered = hoverItem && hoverItem.id === projected.item.id;
    const size = projected.size + (hit ? 2.2 : 0) + (hovered ? 1.5 : 0);

    const glow = ctx.createRadialGradient(projected.x, projected.y, 0, projected.x, projected.y, size * 4);
    glow.addColorStop(0, `${color}dd`);
    glow.addColorStop(0.55, `${color}55`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, size * 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.globalAlpha = projected.alpha;
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();

    if (hit || hovered) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, size + 6 + Math.sin(Date.now() / 250) * 1.4, 0, Math.PI * 2);
      ctx.strokeStyle = hit ? `${color}99` : `${color}77`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawFrame() {
  const width = sc.clientWidth;
  const height = sc.clientHeight;
  ctx.clearRect(0, 0, width, height);

  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "rgba(7, 13, 22, 0.94)");
  background.addColorStop(1, "rgba(4, 9, 15, 1)");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  const halo = ctx.createRadialGradient(width * 0.25, height * 0.18, 0, width * 0.25, height * 0.18, width * 0.42);
  halo.addColorStop(0, "rgba(73, 214, 255, 0.09)");
  halo.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);

  drawSceneGrid(width, height);
  drawAxes(width, height);
  drawQueryConnections(width, height);
  drawPoints(width, height);
  drawQueryAnchor(width, height);

  document.getElementById("cameraState").textContent = `${zoom.toFixed(2)}x`;
  document.getElementById("highlightCount").textContent = String(hitIds.size);
  document.getElementById("sceneCount").textContent = String(allItems.length);

  if (autoSpin && !dragging) rotationY += 0.0022;
  requestAnimationFrame(drawFrame);
}

function showHoverCard(x, y, item) {
  const card = document.getElementById("hoverCard");
  document.getElementById("hoverKind").textContent = CATEGORY_LABEL[item.category] || item.category;
  document.getElementById("hoverTitle").textContent = item.metadata;
  card.style.display = "block";
  card.style.left = `${x + 16}px`;
  card.style.top = `${y + 16}px`;
}

function hideHoverCard() {
  document.getElementById("hoverCard").style.display = "none";
}

function updateHoverState(clientX, clientY) {
  const rect = sc.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let best = null;
  let distance = 24;
  for (const point of projectedPoints) {
    const d = Math.hypot(point.x - x, point.y - y);
    if (d < distance) {
      distance = d;
      best = point;
    }
  }

  if (best) {
    hoverItem = best.item;
    hoverProjection = best;
    showHoverCard(clientX, clientY, best.item);
  } else {
    hoverItem = null;
    hoverProjection = null;
    hideHoverCard();
  }
  updateSceneCopy();
}

sc.addEventListener("mousedown", (event) => {
  dragging = true;
  lastPointer = { x: event.clientX, y: event.clientY };
});

window.addEventListener("mouseup", () => {
  dragging = false;
  lastPointer = null;
});

window.addEventListener("mousemove", (event) => {
  if (dragging && lastPointer) {
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    rotationY += dx * 0.0085;
    rotationX += dy * 0.006;
    rotationX = Math.max(-1.2, Math.min(1.2, rotationX));
    lastPointer = { x: event.clientX, y: event.clientY };
    hideHoverCard();
    hoverItem = null;
    updateSceneCopy();
    return;
  }

  if (event.target === sc) updateHoverState(event.clientX, event.clientY);
});

sc.addEventListener("mouseleave", () => {
  if (!dragging) {
    hoverItem = null;
    hoverProjection = null;
    hideHoverCard();
    updateSceneCopy();
  }
});

sc.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoom += event.deltaY > 0 ? -0.08 : 0.08;
  zoom = Math.max(0.72, Math.min(1.9, zoom));
}, { passive: false });

function renderEmbeddingProfile(embedding) {
  const profile = document.getElementById("embeddingProfile");
  profile.innerHTML = embedding.map((value, idx) => {
    const color = DIM_COL[idx];
    const height = Math.max(6, Math.round(value * 92));
    return `
      <div class="profile-bar">
        <div class="rail">
          <div class="fill" style="height:${height}px;background:${color};color:${color};"></div>
        </div>
        <span>${idx + 1}</span>
      </div>`;
  }).join("");
}

function renderSearchResults(results) {
  const target = document.getElementById("results");
  if (!results.length) {
    target.innerHTML = '<div class="empty-state">No search results yet. Try a concept like "sushi" or "dynamic programming".</div>';
    return;
  }

  target.innerHTML = results.map((result, idx) => {
    const color = COL[result.category] || COL.default;
    return `
      <div class="result-card">
        <div class="result-rank">Nearest #${idx + 1}</div>
        <div class="result-title">${escapeHtml(result.metadata)}</div>
        <div class="result-foot">
          <span class="badge-soft" style="border-color:${color}44;color:${color};background:${color}14;">${escapeHtml((CATEGORY_LABEL[result.category] || result.category).toUpperCase())}</span>
          <span class="distance">dist ${Number(result.distance).toFixed(5)}</span>
          <button class="delete-btn" onclick="deleteItem(${result.id})">Delete</button>
        </div>
      </div>`;
  }).join("");
}

function renderBenchmarks(data) {
  const bars = document.getElementById("benchBars");
  const rows = [
    { label: "Brute force", value: data.bruteforceUs, color: "#ff7aa2" },
    { label: "KD-tree", value: data.kdtreeUs, color: "#49d6ff" },
    { label: "HNSW", value: data.hnswUs, color: "#73f0aa" }
  ];
  const peak = Math.max(1, ...rows.map((row) => row.value));
  bars.innerHTML = rows.map((row) => {
    const width = Math.max(6, Math.round((row.value / peak) * 100));
    const display = row.value < 1000 ? `${row.value} us` : `${(row.value / 1000).toFixed(2)} ms`;
    return `
      <div class="benchmark-row">
        <div class="benchmark-head">
          <strong>${row.label}</strong>
          <span>${display}</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%;background:${row.color};"></div>
        </div>
      </div>`;
  }).join("");
}

function renderHnswLayers(data) {
  const container = document.getElementById("layers");
  const peak = Math.max(1, ...(data.nodesPerLayer || [1]));
  container.innerHTML = data.nodesPerLayer.map((count, idx) => {
    const edges = data.edgesPerLayer[idx] || 0;
    const width = Math.max(6, Math.round((count / peak) * 100));
    return `
      <div class="layer-row">
        <div class="layer-head">
          <strong>Layer L${idx}</strong>
          <span>${count} nodes - ${edges} edges</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${width}%;background:linear-gradient(90deg, #49d6ff, #73f0aa);"></div>
        </div>
      </div>`;
  }).join("");
}

async function loadItems() {
  try {
    const [itemsRes, docs] = await Promise.all([
      fetch(`${API}/items`),
      fetchStoredDocs().catch(() => [])
    ]);
    demoItems = await itemsRes.json();
    docItems = docs.map(toDocVisualItem);
    rebuildProjection();
  } catch (error) {
    console.error(error);
  }
}

async function loadHNSW() {
  try {
    const res = await fetch(`${API}/hnsw-info`);
    const data = await res.json();
    renderHnswLayers(data);
  } catch (error) {
    console.error(error);
  }
}

async function runSearch() {
  const text = document.getElementById("qInput").value.trim();
  if (!text) return;

  const embedding = textToEmbedding(text);
  renderEmbeddingProfile(embedding);

  const k = parseInt(document.getElementById("kSlider").value, 10);
  const metric = document.getElementById("metric").value;

  try {
    const res = await fetch(`${API}/search?v=${embedding.join(",")}&k=${k}&metric=${metric}&algo=${selAlgo}`);
    const data = await res.json();
    searchResults = data.results || [];
    hitIds = new Set(searchResults.map((item) => item.id));

    const latency = data.latencyUs || 0;
    document.getElementById("latBig").textContent = latency < 1000 ? `${latency} us` : `${(latency / 1000).toFixed(2)} ms`;
    document.getElementById("latSub").textContent = `${selAlgo.toUpperCase()} - ${metric} - top ${k}`;
    document.getElementById("queryMode").textContent = text;
    document.getElementById("queryMeta").textContent = `${searchResults.length} demo neighbors highlighted in the 3D field.`;

    if (searchResults.length) {
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let sw = 0;
      for (let idx = 0; idx < Math.min(4, searchResults.length); idx++) {
        const point = scenePoints.find((entry) => entry.item.id === searchResults[idx].id);
        if (!point) continue;
        const weight = 1 / (idx + 1);
        sx += point.x * weight;
        sy += point.y * weight;
        sz += point.z * weight;
        sw += weight;
      }
      queryPoint = sw ? { x: sx / sw, y: sy / sw, z: sz / sw, item: { id: "query" } } : null;
    } else {
      queryPoint = null;
    }

    renderSearchResults(searchResults);
    updateSceneCopy();
    updateTopStats();
  } catch (error) {
    console.error(error);
    alert("Could not reach the local server. Make sure db.exe is running on port 8080.");
  }
}

async function runBenchmark() {
  const text = document.getElementById("qInput").value.trim() || "binary tree algorithm";
  const embedding = textToEmbedding(text);
  const metric = document.getElementById("metric").value;
  try {
    const res = await fetch(`${API}/benchmark?v=${embedding.join(",")}&k=5&metric=${metric}`);
    const data = await res.json();
    renderBenchmarks(data);
  } catch (error) {
    console.error(error);
  }
}

async function addVector() {
  const meta = document.getElementById("addMeta").value.trim();
  const category = document.getElementById("addCat").value;
  if (!meta) return;
  const embedding = textToEmbedding(`${meta} ${category}`);
  try {
    await fetch(`${API}/insert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: meta, category, embedding })
    });
    document.getElementById("addMeta").value = "";
    await loadItems();
    await loadHNSW();
  } catch (error) {
    console.error(error);
  }
}

async function deleteItem(id) {
  try {
    await fetch(`${API}/delete/${id}`, { method: "DELETE" });
    searchResults = searchResults.filter((item) => item.id !== id);
    hitIds.delete(id);
    renderSearchResults(searchResults);
    await loadItems();
    await loadHNSW();
  } catch (error) {
    console.error(error);
  }
}

async function checkOllamaStatus() {
  try {
    const res = await fetch(`${API}/status`);
    const data = await res.json();
    const badge = document.getElementById("ollamaBadge");
    const panel = document.getElementById("ollamaStatus");
    document.getElementById("heroGrounding").textContent = data.ollamaAvailable ? "Online" : "Offline";

    if (data.ollamaAvailable) {
      badge.textContent = "Ollama online";
      badge.className = "pill ok";
      panel.innerHTML = `
        <strong>Local models are available.</strong>
        <p>Embedding model: <code>${escapeHtml(data.embedModel)}</code></p>
        <p>Generation model: <code>${escapeHtml(data.genModel)}</code></p>
        <p>Document chunks: <code>${data.docCount}</code> - inferred dimensions: <code>${data.docDims || "pending first insert"}</code></p>`;
    } else {
      badge.textContent = "Ollama offline";
      badge.className = "pill err";
      panel.innerHTML = `
        <strong>Ollama is not reachable.</strong>
        <p>Install Ollama, run <code>ollama pull nomic-embed-text</code>, <code>ollama pull llama3.2</code>, then start <code>ollama serve</code>.</p>`;
    }
  } catch (error) {
    console.error(error);
  }
}

async function loadDocList() {
  try {
    const docs = await fetchStoredDocs();
    const list = document.getElementById("docList");
    document.getElementById("docCountLabel").textContent = docs.length;
    if (!docs.length) {
      list.innerHTML = '<div class="empty-state">No documents yet. Add one above to populate the semantic field.</div>';
      return;
    }
    list.innerHTML = docs.map((doc) => `
      <div class="doc-card">
        <div class="doc-meta">${doc.words} words</div>
        <div class="doc-title">${escapeHtml(doc.title)}</div>
        <div class="doc-preview">${escapeHtml(doc.preview)}</div>
        <div class="doc-foot">
          <span class="badge-soft">Projected in 3D field</span>
          <button class="delete-btn" onclick="deleteDoc(${doc.id})">Delete</button>
        </div>
      </div>`).join("");
  } catch (error) {
    console.error(error);
  }
}

async function insertDocument() {
  const title = document.getElementById("docTitle").value.trim();
  const text = document.getElementById("docText").value.trim();
  const button = document.getElementById("insertDocBtn");
  const status = document.getElementById("insertStatus");
  if (!title || !text) {
    status.textContent = "Please add both a title and some text.";
    return;
  }

  button.disabled = true;
  button.textContent = "Embedding...";
  status.textContent = "Calling Ollama to embed document chunks...";

  try {
    const res = await fetch(`${API}/doc/insert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, text })
    });
    const data = await res.json();
    if (data.error) {
      status.textContent = data.error;
    } else {
      status.textContent = `Inserted ${data.chunks} chunk(s) with ${data.dims} dimensions.`;
      document.getElementById("docTitle").value = "";
      document.getElementById("docText").value = "";
      await loadItems();
      await loadDocList();
      await checkOllamaStatus();
    }
  } catch (error) {
    status.textContent = "Could not insert the document. Check the local server and Ollama.";
    console.error(error);
  }

  button.disabled = false;
  button.textContent = "Embed and insert";
}

async function deleteDoc(id) {
  try {
    await fetch(`${API}/doc/delete/${id}`, { method: "DELETE" });
    await loadItems();
    await loadDocList();
    await checkOllamaStatus();
  } catch (error) {
    console.error(error);
  }
}

function removeChatEmpty() {
  const empty = document.getElementById("chatEmpty");
  if (empty) empty.remove();
}

function appendThinking(history) {
  const node = document.createElement("div");
  node.className = "thinking";
  node.innerHTML = '<div class="spinner"></div><span>Retrieving context and generating an answer...</span>';
  history.appendChild(node);
  history.scrollTop = history.scrollHeight;
  return node;
}

async function updateRagHighlights(question, k) {
  try {
    const res = await fetch(`${API}/doc/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, k })
    });
    const data = await res.json();
    if (data.contexts && data.contexts.length) {
      hitIds = new Set();
      let sx = 0;
      let sy = 0;
      let sz = 0;
      let sw = 0;
      data.contexts.forEach((context, idx) => {
        const point = scenePoints.find((entry) => entry.item.sourceDocId === context.id);
        if (!point) return;
        hitIds.add(point.item.id);
        const weight = 1 / (idx + 1);
        sx += point.x * weight;
        sy += point.y * weight;
        sz += point.z * weight;
        sw += weight;
      });
      queryPoint = sw ? { x: sx / sw, y: sy / sw, z: sz / sw, item: { id: "query" } } : null;
      updateTopStats();
      updateSceneCopy();
      return;
    }
  } catch (error) {
    console.error(error);
  }

  hitIds = new Set();
  updateTopStats();
  updateSceneCopy();
}

function buildContextHtml(messageId, contexts) {
  if (!contexts.length) return "";
  return `
    <div class="ctx-wrap">
      <div class="ctx-label">Retrieved chunks (${contexts.length})</div>
      <div class="ctx-chip-row">
        ${contexts.map((context, idx) => {
          const panelId = `${messageId}-ctx-${idx}`;
          return `
            <button class="ctx-chip" onclick="toggleCtx('${panelId}')">Chunk ${idx + 1} - ${Number(context.distance).toFixed(3)}</button>
            <div class="ctx-panel" id="${panelId}">${escapeHtml(context.text)}</div>`;
        }).join("")}
      </div>
    </div>`;
}

async function askAI() {
  const question = document.getElementById("ragQuestion").value.trim();
  if (!question) return;
  const k = parseInt(document.getElementById("ragK").value, 10);
  const button = document.getElementById("askBtn");
  const history = document.getElementById("chatHistory");
  removeChatEmpty();

  button.disabled = true;
  button.textContent = "Thinking...";

  const q = document.createElement("div");
  q.className = "chat-q";
  q.textContent = question;
  history.appendChild(q);

  const thinking = appendThinking(history);
  updateRagHighlights(question, k);

  try {
    const res = await fetch(`${API}/doc/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, k })
    });
    const data = await res.json();
    thinking.remove();

    const card = document.createElement("div");
    card.className = "chat-card";

    if (data.error) {
      card.innerHTML = `
        <div class="chat-meta">Error</div>
        <div class="chat-answer">${escapeHtml(data.error)}</div>`;
    } else {
      const messageId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const metaLabel = data.grounded === false ? "No doc match" : `Grounded answer - ${escapeHtml(data.model || "local model")}`;
      card.innerHTML = `
        <div class="chat-meta">${metaLabel}</div>
        <div class="chat-answer">${escapeHtml(data.answer)}</div>
        ${buildContextHtml(messageId, data.contexts || [])}`;
    }

    history.appendChild(card);
  } catch (error) {
    thinking.remove();
    const card = document.createElement("div");
    card.className = "chat-card";
    card.innerHTML = `
      <div class="chat-meta">Error</div>
      <div class="chat-answer">Could not reach the local RAG endpoint. Make sure the backend is running.</div>`;
    history.appendChild(card);
    console.error(error);
  }

  document.getElementById("ragQuestion").value = "";
  button.disabled = false;
  button.textContent = "Ask AI";
  history.scrollTop = history.scrollHeight;
}

function toggleCtx(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  panel.style.display = panel.style.display === "block" ? "none" : "block";
}

document.getElementById("qInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter") runSearch();
});

document.getElementById("ragQuestion").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.ctrlKey) askAI();
});

document.getElementById("kSlider").addEventListener("input", (event) => {
  document.getElementById("kLabel").textContent = event.target.value;
});

window.addEventListener("resize", resizeCanvas);

resizeCanvas();
renderEmbeddingProfile(new Array(DIMS).fill(0.08));
drawFrame();
loadItems().then(loadHNSW);
loadDocList();
checkOllamaStatus();
