import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pdf from 'pdf-parse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;
const CPP_PORT = 8081;

// Resolve paths
const dbPath = path.resolve(__dirname, '../db.exe');
const buildScriptPath = path.resolve(__dirname, '../build.ps1');
const workspacePath = path.resolve(__dirname, '..');

// Compile db.exe if it doesn't exist
if (!fs.existsSync(dbPath)) {
  console.log('db.exe binary not found, compiling from source...');
  try {
    execSync('powershell -ExecutionPolicy Bypass -File ./build.ps1', {
      cwd: workspacePath,
      stdio: 'inherit'
    });
    console.log('Successfully compiled db.exe');
  } catch (error) {
    console.error('Compilation of db.exe failed:', error);
    process.exit(1);
  }
}

// Spawn C++ Microservice
console.log(`Launching high-performance C++ vector search microservice on port ${CPP_PORT}...`);
const cppProcess = spawn(dbPath, [String(CPP_PORT)], {
  cwd: workspacePath,
  stdio: 'inherit' // Pipe stdout and stderr directly to our node terminal
});

cppProcess.on('error', (err) => {
  console.error('Failed to start C++ VectorDB microservice:', err);
});

cppProcess.on('close', (code) => {
  console.log(`C++ VectorDB microservice exited with code ${code}`);
});

// Process Cleanup Listeners
const cleanup = () => {
  console.log('Shutting down C++ VectorDB microservice...');
  cppProcess.kill('SIGINT');
  cppProcess.kill('SIGKILL');
};

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception in Express backend:', err);
  cleanup();
  process.exit(1);
});

const app = express();

// Enable CORS
app.use(cors());

// Log incoming API requests
app.use((req, res, next) => {
  console.log(`[Express API Gateway] ${req.method} ${req.url}`);
  next();
});

// Setup Proxy to C++ Vector Database Microservice
const apiProxy = createProxyMiddleware({
  target: `http://127.0.0.1:${CPP_PORT}`,
  changeOrigin: true,
  ws: true,
  logger: console
});

// Define endpoints to proxy
const endpoints = [
  '/search',
  '/insert',
  '/delete',
  '/items',
  '/benchmark',
  '/hnsw-info',
  '/doc',
  '/status',
  '/stats'
];

// Check and proxy requests without stripping the prefix from the URL path
app.use((req, res, next) => {
  const isApi = endpoints.some(ep => req.path === ep || req.path.startsWith(ep + '/'));
  if (isApi) {
    return apiProxy(req, res, next);
  }
  next();
});

// Serve static React web app from ../ui
app.use(express.static(path.resolve(__dirname, '../ui')));

// Fallback all other requests to React index.html for SPA router compatibility
app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, '../ui/index.html'));
});

// Function to automatically scan a 'documents/' folder and upload files to the database
async function autoIndexDocuments() {
  const docsDir = path.resolve(__dirname, '../documents');
  
  // If the documents folder doesn't exist, create it and seed it with 3 sample files
  if (!fs.existsSync(docsDir)) {
    console.log('[Auto-Indexer] Creating "documents" directory in the root...');
    fs.mkdirSync(docsDir);
    
    fs.writeFileSync(path.join(docsDir, 'about_pragna_ai.txt'), 
      `PragnaAI Vector Retrieval Studio is a premium educational cockpit for orbiting semantic spaces. 
It implements vector search algorithms including Hierarchical Navigable Small World (HNSW) graphs, 
KD-Trees, and Brute-Force KNN searches from scratch in C++. 
The front-end is built using React and renders a high-performance 3D PCA projection canvas.`
    );
    
    fs.writeFileSync(path.join(docsDir, 'vector_embeddings_basics.txt'), 
      `Vector embeddings are numerical representations of semantic meaning. 
By translating text chunks into dense lists of numbers (usually 768 or 1536 dimensions), 
machines can perform mathematical calculations to determine semantic similarity. 
Cosine similarity measures the angle between these vectors, while Euclidean distance measures straight-line distance.`
    );
    
    fs.writeFileSync(path.join(docsDir, 'grounded_rag_intro.txt'), 
      `Retrieval-Augmented Generation (RAG) grounds Large Language Model responses in factual documents. 
When a user asks a question, the system searches the HNSW index for the most relevant document chunks, 
adds them to the prompt as context, and instructs the LLM to only answer using this context. 
If no matches exist, the LLM reports that it has insufficient information, avoiding hallucinations.`
    );
    console.log('[Auto-Indexer] Seeded 3 sample files in the "documents" directory.');
  }

  try {
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.txt') || f.endsWith('.md') || f.endsWith('.pdf'));
    if (files.length === 0) {
      console.log('[Auto-Indexer] No documents found to index.');
      return;
    }

    console.log(`[Auto-Indexer] Found ${files.length} document(s). Commencing background indexing in 3 seconds...`);
    
    // Wait for the C++ server to be fully active and listening
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Fetch existing documents from C++ database to avoid duplicate indexing
    let existingDocs = [];
    try {
      const listRes = await fetch(`http://127.0.0.1:${CPP_PORT}/doc/list`);
      if (listRes.ok) {
        existingDocs = await listRes.json();
      }
    } catch (fetchError) {
      console.error('[Auto-Indexer] Warning: Could not fetch existing documents for duplicate checks:', fetchError.message);
    }

    for (const file of files) {
      // Check if file is already indexed (matches exact title or begins with title + chunk count)
      const alreadyIndexed = existingDocs.some(d => d.title === file || d.title.startsWith(file + ' ['));
      if (alreadyIndexed) {
        console.log(`[Auto-Indexer] Skipping "${file}" - already indexed in database.`);
        continue;
      }

      const filePath = path.join(docsDir, file);
      let text = '';

      if (file.endsWith('.pdf')) {
        try {
          const dataBuffer = fs.readFileSync(filePath);
          const pdfData = await pdf(dataBuffer);
          text = pdfData.text.trim();
        } catch (pdfError) {
          console.error(`[Auto-Indexer] Failed to parse PDF "${file}":`, pdfError);
          continue;
        }
      } else {
        text = fs.readFileSync(filePath, 'utf-8').trim();
      }

      if (!text) continue;

      console.log(`[Auto-Indexer] Indexing "${file}" (${text.length} characters)...`);
      
      const response = await fetch(`http://127.0.0.1:${CPP_PORT}/doc/insert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: file, text })
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`[Auto-Indexer] Successfully indexed "${file}". Created chunk IDs: ${JSON.stringify(data.ids)}`);
      } else {
        const errText = await response.text();
        console.error(`[Auto-Indexer] Failed to index "${file}":`, errText);
      }
    }
    console.log('[Auto-Indexer] Background indexing task completed.');
  } catch (error) {
    console.error('[Auto-Indexer] Error during document ingestion:', error);
  }
}

// Start Express server
app.listen(PORT, '127.0.0.1', () => {
  console.log('==================================================');
  console.log(`  Express backend gateway running on http://127.0.0.1:${PORT}`);
  console.log(`  Serving React UI assets from: ${path.resolve(__dirname, '../ui')}`);
  console.log('==================================================');
  
  // Launch the background document indexer
  autoIndexDocuments();
});
