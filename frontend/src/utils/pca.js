export function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export function normalize(vec) {
  const mag = Math.sqrt(dot(vec, vec));
  if (mag < 1e-10) return vec.map(() => 0);
  return vec.map((value) => value / mag);
}

export function orthogonalize(vec, basis) {
  let out = vec.slice();
  for (const axis of basis) {
    const factor = dot(out, axis);
    out = out.map((value, idx) => value - factor * axis[idx]);
  }
  return out;
}

export function powerIter(centered, basis) {
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

export function pca3D(embeddings) {
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
