import React, { useState, useEffect } from 'react';
import PcaCanvas from './components/PcaCanvas';
import { pca3D } from './utils/pca';

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

export default function App() {
  const pcaCanvasRef = React.useRef(null);
  // Tabs & Settings
  const [activeTab, setActiveTab] = useState('search');
  const [selAlgo, setSelAlgo] = useState('hnsw');
  const [metric, setMetric] = useState('cosine');
  const [k, setK] = useState(5);

  // Data
  const [demoItems, setDemoItems] = useState([]);
  const [docItems, setDocItems] = useState([]);
  const [storedDocs, setStoredDocs] = useState([]);
  const [hnswLayers, setHnswLayers] = useState(null);
  const [ollamaStatus, setOllamaStatus] = useState(null);

  // 3D PCA Coordinates
  const [scenePoints, setScenePoints] = useState([]);
  const [sceneExtent, setSceneExtent] = useState(1);
  const [queryPoint, setQueryPoint] = useState(null);
  const [hitIds, setHitIds] = useState(new Set());
  const [hoverItem, setHoverItem] = useState(null);

  // Interaction controls
  const [cameraZoom, setCameraZoom] = useState(1.15);
  const [autoSpin, setAutoSpin] = useState(true);

  // Forms
  const [qInput, setQInput] = useState('');
  const [addMeta, setAddMeta] = useState('');
  const [addCat, setAddCat] = useState('cs');
  const [docTitle, setDocTitle] = useState('');
  const [docText, setDocText] = useState('');
  const [ragQuestion, setRagQuestion] = useState('');
  const [ragK, setRagK] = useState(3);

  // API Status states
  const [isEmbedding, setIsEmbedding] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [docInsertStatus, setDocInsertStatus] = useState('Document chunks will appear as green points in the 3D field.');
  const [searchLatency, setSearchLatency] = useState('--');
  const [searchQueryMode, setSearchQueryMode] = useState('Ready');
  const [searchQueryMeta, setSearchQueryMeta] = useState('The next search will update the 3D anchor and result neighborhood.');
  const [searchResults, setSearchResults] = useState([]);
  const [benchData, setBenchData] = useState(null);
  const [embeddingProfile, setEmbeddingProfile] = useState(new Array(DIMS).fill(0.08));
  const [ragHistory, setRagHistory] = useState([]);

  // Fetch document preview list
  const fetchStoredDocs = async () => {
    try {
      const res = await fetch(`${API}/doc/list`);
      if (!res.ok) throw new Error("Could not load document list.");
      const data = await res.json();
      setStoredDocs(data);
      return data;
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  const toDocVisualItem = (doc) => {
    return {
      id: `${DOC_PREFIX}${doc.id}`,
      sourceDocId: doc.id,
      metadata: doc.title,
      category: "doc",
      embedding: textToEmbedding(`${doc.title} ${doc.preview || ""}`),
      preview: doc.preview || "",
      words: doc.words || 0
    };
  };

  const loadItems = async () => {
    try {
      const itemsRes = await fetch(`${API}/items`);
      const demo = await itemsRes.json();
      setDemoItems(demo);

      const docs = await fetchStoredDocs();
      setDocItems(docs.map(toDocVisualItem));
    } catch (error) {
      console.error(error);
    }
  };

  const loadHNSW = async () => {
    try {
      const res = await fetch(`${API}/hnsw-info`);
      const data = await res.json();
      setHnswLayers(data);
    } catch (error) {
      console.error(error);
    }
  };

  const checkOllamaStatus = async () => {
    try {
      const res = await fetch(`${API}/status`);
      const data = await res.json();
      setOllamaStatus(data);
    } catch (error) {
      console.error(error);
    }
  };

  // Initial Load
  useEffect(() => {
    loadItems().then(loadHNSW);
    checkOllamaStatus();
  }, []);

  // Recalculate 3D PCA points whenever demoItems or docItems change
  useEffect(() => {
    const all = [...demoItems, ...docItems];
    if (!all.length) {
      setScenePoints([]);
      setSceneExtent(1);
      return;
    }

    const coords = pca3D(all.map((item) => item.embedding));
    const points = all.map((item, idx) => ({
      x: coords[idx][0],
      y: coords[idx][1],
      z: coords[idx][2],
      item
    }));

    const maxVal = Math.max(
      1,
      ...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)))
    );

    setScenePoints(points);
    setSceneExtent(maxVal);
  }, [demoItems, docItems]);

  const runSearch = async () => {
    const text = qInput.trim();
    if (!text) return;

    const embedding = textToEmbedding(text);
    setEmbeddingProfile(embedding);

    try {
      const res = await fetch(`${API}/search?v=${embedding.join(",")}&k=${k}&metric=${metric}&algo=${selAlgo}`);
      const data = await res.json();
      const results = data.results || [];
      setSearchResults(results);
      const activeHitIds = new Set(results.map((item) => item.id));
      setHitIds(activeHitIds);

      const latency = data.latencyUs || 0;
      setSearchLatency(latency < 1000 ? `${latency} us` : `${(latency / 1000).toFixed(2)} ms`);
      setSearchQueryMode(text);
      setSearchQueryMeta(`${results.length} demo neighbors highlighted in the 3D field.`);

      // Compute visual query anchor point in 3D
      if (results.length) {
        let sx = 0, sy = 0, sz = 0, sw = 0;
        for (let idx = 0; idx < Math.min(4, results.length); idx++) {
          const point = scenePoints.find((entry) => entry.item.id === results[idx].id);
          if (!point) continue;
          const weight = 1 / (idx + 1);
          sx += point.x * weight;
          sy += point.y * weight;
          sz += point.z * weight;
          sw += weight;
        }
        setQueryPoint(sw ? { x: sx / sw, y: sy / sw, z: sz / sw, item: { id: "query" } } : null);
      } else {
        setQueryPoint(null);
      }
    } catch (error) {
      console.error(error);
      alert("Could not reach the local server. Make sure db.exe is running on port 8080.");
    }
  };

  const runBenchmark = async () => {
    const text = qInput.trim() || "binary tree algorithm";
    const embedding = textToEmbedding(text);
    try {
      const res = await fetch(`${API}/benchmark?v=${embedding.join(",")}&k=5&metric=${metric}`);
      const data = await res.json();
      setBenchData(data);
    } catch (error) {
      console.error(error);
    }
  };

  const addVector = async () => {
    const meta = addMeta.trim();
    if (!meta) return;
    const embedding = textToEmbedding(`${meta} ${addCat}`);
    try {
      await fetch(`${API}/insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: meta, category: addCat, embedding })
      });
      setAddMeta('');
      await loadItems();
      await loadHNSW();
    } catch (error) {
      console.error(error);
    }
  };

  const deleteItem = async (id) => {
    try {
      await fetch(`${API}/delete/${id}`, { method: "DELETE" });
      setSearchResults((prev) => prev.filter((item) => item.id !== id));
      setHitIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await loadItems();
      await loadHNSW();
    } catch (error) {
      console.error(error);
    }
  };

  const insertDocument = async () => {
    const title = docTitle.trim();
    const text = docText.trim();
    if (!title || !text) {
      setDocInsertStatus("Please add both a title and some text.");
      return;
    }

    setIsEmbedding(true);
    setDocInsertStatus("Calling Ollama to embed document chunks...");

    try {
      const res = await fetch(`${API}/doc/insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, text })
      });
      const data = await res.json();
      if (data.error) {
        setDocInsertStatus(data.error);
      } else {
        setDocInsertStatus(`Inserted ${data.chunks} chunk(s) with ${data.dims} dimensions.`);
        setDocTitle('');
        setDocText('');
        await loadItems();
        await checkOllamaStatus();
      }
    } catch (error) {
      setDocInsertStatus("Could not insert the document. Check the local server and Ollama.");
      console.error(error);
    }
    setIsEmbedding(false);
  };

  const deleteDoc = async (id) => {
    try {
      await fetch(`${API}/doc/delete/${id}`, { method: "DELETE" });
      await loadItems();
      await checkOllamaStatus();
    } catch (error) {
      console.error(error);
    }
  };

  const updateRagHighlights = async (question, k) => {
    try {
      const res = await fetch(`${API}/doc/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, k })
      });
      const data = await res.json();
      if (data.contexts && data.contexts.length) {
        const activeDocHits = new Set();
        let sx = 0, sy = 0, sz = 0, sw = 0;
        data.contexts.forEach((context, idx) => {
          const point = scenePoints.find((entry) => entry.item.sourceDocId === context.id);
          if (!point) return;
          activeDocHits.add(point.item.id);
          const weight = 1 / (idx + 1);
          sx += point.x * weight;
          sy += point.y * weight;
          sz += point.z * weight;
          sw += weight;
        });
        setHitIds(activeDocHits);
        setQueryPoint(sw ? { x: sx / sw, y: sy / sw, z: sz / sw, item: { id: "query" } } : null);
        return;
      }
    } catch (error) {
      console.error(error);
    }
    setHitIds(new Set());
    setQueryPoint(null);
  };

  const askAI = async () => {
    const question = ragQuestion.trim();
    if (!question) return;

    setIsThinking(true);
    setRagQuestion('');
    setRagHistory((prev) => [...prev, { type: 'q', text: question }]);

    updateRagHighlights(question, ragK);

    try {
      const res = await fetch(`${API}/doc/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, k: ragK })
      });
      const data = await res.json();

      if (data.error) {
        setRagHistory((prev) => [...prev, { type: 'error', text: data.error }]);
      } else {
        setRagHistory((prev) => [
          ...prev,
          {
            type: 'a',
            text: data.answer,
            model: data.model,
            grounded: data.grounded,
            contexts: data.contexts || []
          }
        ]);
      }
    } catch (error) {
      setRagHistory((prev) => [
        ...prev,
        { type: 'error', text: "Could not reach the local RAG endpoint. Make sure the backend is running." }
      ]);
      console.error(error);
    }
    setIsThinking(false);
  };

  // Toggle custom layout details depending on active hover item in canvas
  const handleHoverItemChange = (item) => {
    setHoverItem(item);
  };

  // Get active scene subtitle copy
  const getSceneTitle = () => {
    if (hoverItem) return hoverItem.metadata;
    if (queryPoint && hitIds.size) return "Active query neighborhood";
    return "Semantic landscape";
  };

  const getSceneBody = () => {
    if (hoverItem) {
      const label = hoverItem.category === "doc" ? "Document chunk" : (hoverItem.category === "cs" ? "CS / Algorithms" : hoverItem.category);
      return `${label.toUpperCase()} point. Hover highlights let you inspect exact semantic labels without leaving the 3D view.`;
    }
    if (queryPoint && hitIds.size) {
      return `${hitIds.size} nearby points are highlighted around the latest query anchor. Search results on the right stay in sync with the 3D view.`;
    }
    return "Drag to orbit. Scroll to zoom. Demo vectors, documents, and active query neighborhoods all live in the same coordinate space.";
  };

  const getSceneTag = () => {
    if (hoverItem) return hoverItem.category === "doc" ? "Document projection" : "Semantic point";
    if (queryPoint && hitIds.size) return "Query in focus";
    return "Live retrieval scene";
  };

  const toggleCtxPanel = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.style.display = el.style.display === "block" ? "none" : "block";
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="eyebrow">Vector Retrieval Studio</div>
          <h1><span>PragnaAI</span></h1>
          <p>Explore semantic neighborhoods in an interactive 3D field, compare HNSW against KD-Tree and brute force, embed your own documents, and ask grounded questions against a local LLM.</p>
        </div>
        <div className="header-meta">
          <span className="pill glow">3D semantic field</span>
          <span className="pill">HNSW</span>
          <span className="pill">KD-tree</span>
          <span className="pill">Brute force</span>
          {ollamaStatus ? (
            <span className={`pill ${ollamaStatus.ollamaAvailable ? 'ok' : 'err'}`}>
              {ollamaStatus.ollamaAvailable ? 'Ollama online' : 'Ollama offline'}
            </span>
          ) : (
            <span className="pill">Checking Ollama</span>
          )}
          <span className="pill">
            {demoItems.length} demo - {docItems.length} docs - {DIMS} dims
          </span>
        </div>
      </header>

      <main className="main-grid">
        <aside className="rail">
          <div className="rail-scroll">
            <div className="section-block">
              <div className="section-title">Query</div>
              <div className="card stack">
                <label>
                  Search the demo vector space
                  <input
                    type="text"
                    value={qInput}
                    onChange={(e) => setQInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                    placeholder="binary tree, sushi, basketball"
                  />
                </label>
                <button className="primary-btn" onClick={runSearch}>Search</button>
              </div>
            </div>

            <div className="section-block">
              <div className="section-title">Algorithm</div>
              <div className="algo-grid">
                <button className={`algo-pill ${selAlgo === 'hnsw' ? 'active' : ''}`} onClick={() => setSelAlgo('hnsw')}>HNSW</button>
                <button className={`algo-pill ${selAlgo === 'kdtree' ? 'active' : ''}`} onClick={() => setSelAlgo('kdtree')}>KD-tree</button>
                <button className={`algo-pill ${selAlgo === 'bruteforce' ? 'active' : ''}`} onClick={() => setSelAlgo('bruteforce')}>Brute</button>
              </div>
            </div>

            <div className="section-block">
              <div className="section-title">Distance Metric</div>
              <div className="card stack">
                <label>
                  Metric
                  <select value={metric} onChange={(e) => setMetric(e.target.value)}>
                    <option value="cosine">Cosine similarity</option>
                    <option value="euclidean">Euclidean distance</option>
                    <option value="manhattan">Manhattan distance</option>
                  </select>
                </label>
                <div>
                  <div className="k-row">
                    <span>Top-K</span>
                    <strong>{k}</strong>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={k}
                    onChange={(e) => setK(parseInt(e.target.value, 10))}
                  />
                </div>
              </div>
            </div>

            <div className="section-block">
              <div className="section-title">Semantic Legend</div>
              <div className="card">
                <div className="legend-list">
                  <div className="legend-row"><span className="legend-dot" style={{ color: '#49d6ff', background: '#49d6ff' }}></span>CS / Algorithms</div>
                  <div className="legend-row"><span className="legend-dot" style={{ color: '#ff7aa2', background: '#ff7aa2' }}></span>Mathematics</div>
                  <div className="legend-row"><span className="legend-dot" style={{ color: '#ffbf5a', background: '#ffbf5a' }}></span>Food / Cooking</div>
                  <div className="legend-row"><span className="legend-dot" style={{ color: '#73f0aa', background: '#73f0aa' }}></span>Sports / Games</div>
                  <div className="legend-row"><span className="legend-dot" style={{ color: '#b7ff8a', background: '#b7ff8a' }}></span>Document projections</div>
                </div>
              </div>
            </div>

            <div className="section-block">
              <div className="section-title">Insert Demo Vector</div>
              <div className="card stack">
                <label>
                  Description
                  <input
                    type="text"
                    value={addMeta}
                    onChange={(e) => setAddMeta(e.target.value)}
                    placeholder="Describe a new semantic point"
                  />
                </label>
                <label>
                  Category
                  <select value={addCat} onChange={(e) => setAddCat(e.target.value)}>
                    <option value="cs">CS / Algorithms</option>
                    <option value="math">Mathematics</option>
                    <option value="food">Food / Cooking</option>
                    <option value="sports">Sports / Games</option>
                  </select>
                </label>
                <button className="secondary-btn" onClick={addVector}>Insert point</button>
              </div>
            </div>

            <div className="section-block">
              <div className="section-title">Benchmark</div>
              <div className="card stack">
                <div className="status-note">Run the same query across all three search strategies and compare their latency.</div>
                <button className="accent-btn" onClick={runBenchmark}>Compare all algorithms</button>
              </div>
            </div>
          </div>
        </aside>

        <section className="stage">
          <div className="stage-card">
            <div className="hero-grid">
              <div className="hero-copy">
                <div className="eyebrow">Interactive retrieval cockpit</div>
                <h2>Orbit the semantic space instead of staring at a flat scatter plot.</h2>
                <p>The center visualization now renders a 3D projection of the vector field. Drag to rotate, scroll to zoom, and watch document chunks land directly inside the same semantic world as your demo vectors.</p>
              </div>
              <div className="hero-metrics">
                <div className="metric-card">
                  <div className="metric-label">Core search</div>
                  <div className="metric-value">{selAlgo.toUpperCase()}</div>
                  <div className="metric-sub">Switch between HNSW, KD-tree, and brute force without leaving the scene.</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Grounded RAG</div>
                  <div className="metric-value">{ollamaStatus?.ollamaAvailable ? 'Online' : 'Offline'}</div>
                  <div className="metric-sub">Answers stay tied to retrieved documents and report when no grounded match exists.</div>
                </div>
                <div className="metric-card">
                  <div className="metric-label">Projection</div>
                  <div className="metric-value">3D</div>
                  <div className="metric-sub">Semantic points, query anchors, and live highlights all share one orbitable view.</div>
                </div>
              </div>
            </div>
          </div>

          <div className="scene-card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <PcaCanvas
              ref={pcaCanvasRef}
              scenePoints={scenePoints}
              queryPoint={queryPoint}
              hitIds={hitIds}
              autoSpin={autoSpin}
              sceneExtent={sceneExtent}
              onHoverItemChange={handleHoverItemChange}
              cameraZoom={cameraZoom}
              onCameraZoomChange={setCameraZoom}
            />
            <div className="scene-overlay" style={{ pointerEvents: 'none' }}>
              <div className="scene-badge-row">
                <div className="scene-copy">
                  <div className="scene-tag">{getSceneTag()}</div>
                  <h4>{getSceneTitle()}</h4>
                  <p>{getSceneBody()}</p>
                </div>
                <div className="scene-stats" style={{ pointerEvents: 'auto' }}>
                  <div className="scene-stat">
                    <div className="label">Visible points</div>
                    <div className="value">{scenePoints.length}</div>
                  </div>
                  <div className="scene-stat">
                    <div className="label">Camera</div>
                    <div className="value">{cameraZoom.toFixed(2)}x</div>
                  </div>
                  <div className="scene-stat">
                    <div className="label">Highlighted</div>
                    <div className="value">{hitIds.size}</div>
                  </div>
                  <button className="ghost-btn" onClick={() => pcaCanvasRef.current?.resetView()} style={{ alignSelf: 'center', height: 'fit-content' }}>Reset view</button>
                </div>
              </div>
              <div className="scene-foot">
                <div className="hint-list">
                  <span className="hint-chip">drag to orbit</span>
                  <span className="hint-chip">scroll to zoom</span>
                  <span className="hint-chip">green points are document projections</span>
                </div>
                <div className="legend-inline">
                  <span className="legend-chip"><span className="legend-dot" style={{ color: '#49d6ff', background: '#49d6ff' }}></span>CS</span>
                  <span className="legend-chip"><span className="legend-dot" style={{ color: '#ff7aa2', background: '#ff7aa2' }}></span>Math</span>
                  <span className="legend-chip"><span className="legend-dot" style={{ color: '#ffbf5a', background: '#ffbf5a' }}></span>Food</span>
                  <span className="legend-chip"><span className="legend-dot" style={{ color: '#73f0aa', background: '#73f0aa' }}></span>Sports</span>
                  <span className="legend-chip"><span className="legend-dot" style={{ color: '#b7ff8a', background: '#b7ff8a' }}></span>Docs</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="right-panel">
          <div className="tabs">
            <button className={`tab-btn ${activeTab === 'search' ? 'active' : ''}`} onClick={() => setActiveTab('search')}>Search</button>
            <button className={`tab-btn ${activeTab === 'docs' ? 'active' : ''}`} onClick={() => { setActiveTab('docs'); fetchStoredDocs(); }}>Documents</button>
            <button className={`tab-btn ${activeTab === 'rag' ? 'active' : ''}`} onClick={() => setActiveTab('rag')}>Ask AI</button>
          </div>
          <div className="right-scroll">
            {activeTab === 'search' && (
              <div className="search-pane-grid">
                <div className="stat-strip">
                  <div className="mini-stat">
                    <div className="label">Search latency</div>
                    <div className="value">{searchLatency}</div>
                    <div className="sub">{selAlgo.toUpperCase()} - {metric} - top {k}</div>
                  </div>
                  <div className="mini-stat">
                    <div className="label">Query profile</div>
                    <div className="value">{searchQueryMode}</div>
                    <div className="sub">{searchQueryMeta}</div>
                  </div>
                </div>

                <div className="panel-card card stack">
                  <div className="section-title">Top Matches</div>
                  <div className="results-list">
                    {searchResults.length === 0 ? (
                      <div className="empty-state">Run a search to see the nearest semantic neighbors.</div>
                    ) : (
                      searchResults.map((result, idx) => (
                        <div key={result.id} className="result-card">
                          <div className="result-rank">Nearest #{idx + 1}</div>
                          <div className="result-title">{result.metadata}</div>
                          <div className="result-foot">
                            <span className="badge-soft" style={{ borderColor: `${COL[result.category]}44`, color: COL[result.category], background: `${COL[result.category]}14` }}>
                              {(CATEGORY_LABEL[result.category] || result.category).toUpperCase()}
                            </span>
                            <span className="distance">dist {Number(result.distance).toFixed(5)}</span>
                            <button className="delete-btn" onClick={() => deleteItem(result.id)}>Delete</button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="panel-card card stack">
                  <div className="section-title">Embedding Profile</div>
                  <div className="status-note">The search phrase is transformed into a quick 16D demo embedding so you can see which semantic bands are lighting up.</div>
                  <div className="profile-grid">
                    {embeddingProfile.map((value, idx) => {
                      const color = DIM_COL[idx];
                      const height = Math.max(6, Math.round(value * 92));
                      return (
                        <div key={idx} className="profile-bar">
                          <div className="rail">
                            <div className="fill" style={{ height: `${height}px`, background: color, color: color }}></div>
                          </div>
                          <span>{idx + 1}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="panel-card card stack">
                  <div className="section-title">Algorithm Comparison</div>
                  <div className="benchmark-list">
                    {!benchData ? (
                      <div className="empty-state">Benchmark data appears here after you run Compare all algorithms.</div>
                    ) : (
                      [
                        { label: "Brute force", value: benchData.bruteforceUs, color: "#ff7aa2" },
                        { label: "KD-tree", value: benchData.kdtreeUs, color: "#49d6ff" },
                        { label: "HNSW", value: benchData.hnswUs, color: "#73f0aa" }
                      ].map((row) => {
                        const peak = Math.max(1, benchData.bruteforceUs, benchData.kdtreeUs, benchData.hnswUs);
                        const width = Math.max(6, Math.round((row.value / peak) * 100));
                        const display = row.value < 1000 ? `${row.value} us` : `${(row.value / 1000).toFixed(2)} ms`;
                        return (
                          <div key={row.label} className="benchmark-row">
                            <div className="benchmark-head">
                              <strong>{row.label}</strong>
                              <span>{display}</span>
                            </div>
                            <div className="bar-track">
                              <div className="bar-fill" style={{ width: `${width}%`, background: row.color }}></div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="panel-card card stack">
                  <div className="section-title">HNSW Layers</div>
                  <div className="layers-list">
                    {!hnswLayers ? (
                      <div className="empty-state">Loading graph structure...</div>
                    ) : (
                      hnswLayers.nodesPerLayer.map((count, idx) => {
                        const edges = hnswLayers.edgesPerLayer[idx] || 0;
                        const peak = Math.max(1, ...hnswLayers.nodesPerLayer);
                        const width = Math.max(6, Math.round((count / peak) * 100));
                        return (
                          <div key={idx} className="layer-row">
                            <div className="layer-head">
                              <strong>Layer L{idx}</strong>
                              <span>{count} nodes - {edges} edges</span>
                            </div>
                            <div className="bar-track">
                              <div className="bar-fill" style={{ width: `${width}%`, background: 'linear-gradient(90deg, #49d6ff, #73f0aa)' }}></div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'docs' && (
              <div className="docs-pane-grid">
                <div className="panel-card card stack">
                  <div className="section-title">Ollama Status</div>
                  <div className="status-panel">
                    {ollamaStatus?.ollamaAvailable ? (
                      <>
                        <strong>Local models are available.</strong>
                        <p>Embedding model: <code>{ollamaStatus.embedModel}</code></p>
                        <p>Generation model: <code>{ollamaStatus.genModel}</code></p>
                        <p>Document chunks: <code>{ollamaStatus.docCount}</code> - inferred dimensions: <code>{ollamaStatus.docDims || "pending first insert"}</code></p>
                      </>
                    ) : (
                      <>
                        <strong>Checking local models...</strong>
                        <p>The project uses Ollama for document embeddings and grounded answers.</p>
                      </>
                    )}
                  </div>
                </div>

                <div className="panel-card card stack">
                  <div className="section-title">Insert Document</div>
                  <label>
                    Title
                    <input
                      type="text"
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      placeholder="Operating systems notes"
                    />
                  </label>
                  <label>
                    Text
                    <textarea
                      value={docText}
                      onChange={(e) => setDocText(e.target.value)}
                      placeholder="Paste notes, article excerpts, or documentation. The app chunks longer text and embeds each chunk locally through Ollama."
                    />
                  </label>
                  <button className="accent-btn" disabled={isEmbedding} onClick={insertDocument}>
                    {isEmbedding ? 'Embedding...' : 'Embed and insert'}
                  </button>
                  <div className="status-note">{docInsertStatus}</div>
                </div>

                <div className="panel-card card stack">
                  <div className="section-title">Stored Chunks ({storedDocs.length})</div>
                  <div className="doc-list">
                    {storedDocs.length === 0 ? (
                      <div className="empty-state">No documents yet. Add one above to populate the semantic field.</div>
                    ) : (
                      storedDocs.map((doc) => (
                        <div key={doc.id} className="doc-card">
                          <div className="doc-meta">{doc.words} words</div>
                          <div className="doc-title">{doc.title}</div>
                          <div className="doc-preview">{doc.preview}</div>
                          <div className="doc-foot">
                            <span className="badge-soft">Projected in 3D field</span>
                            <button className="delete-btn" onClick={() => deleteDoc(doc.id)}>Delete</button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'rag' && (
              <div className="rag-pane-grid">
                <div className="panel-card card stack">
                  <div className="section-title">Ask Grounded AI</div>
                  <label>
                    Question
                    <textarea
                      value={ragQuestion}
                      onChange={(e) => setRagQuestion(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && askAI()}
                      placeholder="What is the main idea behind HNSW? Press Ctrl+Enter to submit."
                      rows="3"
                    />
                  </label>
                  <div className="control-row">
                    <label style={{ flex: '0 0 110px' }}>
                      Top-K
                      <select value={ragK} onChange={(e) => setRagK(parseInt(e.target.value, 10))}>
                        <option value={2}>Top 2</option>
                        <option value={3}>Top 3</option>
                        <option value={5}>Top 5</option>
                      </select>
                    </label>
                    <button className="primary-btn" disabled={isThinking} onClick={askAI}>
                      {isThinking ? 'Thinking...' : 'Ask AI'}
                    </button>
                  </div>
                  <div className="status-note">Answers are grounded to retrieved document chunks. If nothing relevant is found, the assistant says so instead of pretending.</div>
                </div>

                <div className="panel-card card stack">
                  <div className="section-title">Conversation</div>
                  <div className="chat-history">
                    {ragHistory.length === 0 ? (
                      <div className="empty-state">Ask a question about the documents you inserted and the answer will appear here.</div>
                    ) : (
                      ragHistory.map((msg, idx) => (
                        <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {msg.type === 'q' && (
                            <div className="chat-q">{msg.text}</div>
                          )}
                          {msg.type === 'a' && (
                            <div className="chat-card">
                              <div className="chat-meta">
                                {msg.grounded === false ? 'No doc match' : `Grounded answer - ${msg.model || 'local model'}`}
                              </div>
                              <div className="chat-answer">{msg.text}</div>
                              {msg.contexts && msg.contexts.length > 0 && (
                                <div className="ctx-wrap">
                                  <div className="ctx-label">Retrieved chunks ({msg.contexts.length})</div>
                                  <div className="ctx-chip-row">
                                    {msg.contexts.map((context, cidx) => {
                                      const panelId = `msg-${idx}-ctx-${cidx}`;
                                      return (
                                        <div key={cidx} style={{ display: 'inline-block' }}>
                                          <button className="ctx-chip" onClick={() => toggleCtxPanel(panelId)}>
                                            Chunk {cidx + 1} - {Number(context.distance).toFixed(3)}
                                          </button>
                                          <div className="ctx-panel" id={panelId}>
                                            {context.text}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                          {msg.type === 'error' && (
                            <div className="chat-card">
                              <div className="chat-meta" style={{ color: 'var(--rose)' }}>Error</div>
                              <div className="chat-answer" style={{ color: '#ffd9e4' }}>{msg.text}</div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                    {isThinking && (
                      <div className="thinking">
                        <div className="spinner"></div>
                        <span>Retrieving context and generating an answer...</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
