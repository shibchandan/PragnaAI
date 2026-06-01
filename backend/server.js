import express from 'express';
import cors from 'cors';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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

// Start Express server
app.listen(PORT, '127.0.0.1', () => {
  console.log('==================================================');
  console.log(`  Express backend gateway running on http://127.0.0.1:${PORT}`);
  console.log(`  Serving React UI assets from: ${path.resolve(__dirname, '../ui')}`);
  console.log('==================================================');
});
