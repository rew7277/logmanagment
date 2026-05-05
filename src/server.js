import compression from 'compression';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { WebSocketServer } from 'ws';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.js';
import { hasDatabase, query, closePool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { getLogs } from './services/repository.js';
import { seed } from './db/seed.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = Number(process.env.PORT || 3000);

const bootState = {
  startedAt: new Date().toISOString(),
  database: hasDatabase ? 'configured' : 'not_configured',
  migration: 'pending',
  seed: 'pending',
  lastError: null
};

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: process.env.JSON_LIMIT || '5mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '0', etag: false }));

// ─── Health / Readiness ───────────────────────────────────────────────────────

// Railway healthcheck must respond FAST. Never await DB here.
app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'observex',
    uptime_seconds: Math.round(process.uptime()),
    boot: bootState,
    timestamp: new Date().toISOString()
  });
});

// Stricter check — use this manually to validate PostgreSQL connectivity.
app.get('/ready', async (_req, res) => {
  if (!hasDatabase) {
    return res.status(200).json({
      ok: true,
      database: 'not_configured',
      message: 'App is running without PostgreSQL. Add DATABASE_URL to enable persistence.'
    });
  }
  try {
    await query('SELECT 1');
    return res.json({ ok: true, database: 'connected', boot: bootState });
  } catch (error) {
    return res.status(503).json({ ok: false, database: 'error', error: error.message, boot: bootState });
  }
});

// ─── API & SPA ────────────────────────────────────────────────────────────────

app.use('/api', apiRoutes);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global error handler
app.use((error, _req, res, _next) => {
  console.error('[api] unhandled error', error);
  res.status(error.status || 500).json({ error: error.message || 'Internal server error' });
});

// ─── DB startup (non-blocking) ────────────────────────────────────────────────

async function runDatabaseStartupTasks() {
  if (!hasDatabase) {
    bootState.database = 'not_configured';
    bootState.migration = 'skipped';
    bootState.seed = 'skipped';
    console.warn('[db] DATABASE_URL missing. Running with in-memory demo fallback.');
    return;
  }

  try {
    bootState.database = 'connecting';
    await query('SELECT 1');
    bootState.database = 'connected';
    console.log('[db] connected successfully');

    if (process.env.AUTO_MIGRATE !== 'false') {
      bootState.migration = 'running';
      await migrate();
      bootState.migration = 'completed';
    } else {
      bootState.migration = 'disabled';
    }

    if (process.env.SEED_DEMO_DATA === 'true') {
      bootState.seed = 'running';
      await seed();
      bootState.seed = 'completed';
    } else {
      bootState.seed = 'disabled';
    }
  } catch (error) {
    bootState.lastError = error.message;
    if (bootState.database === 'connecting') bootState.database = 'connection_failed';
    if (bootState.migration === 'running') bootState.migration = 'failed';
    if (bootState.seed === 'running') bootState.seed = 'failed';
    console.error('[db] startup task failed. App stays online — check /ready for details.', error.message);
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────
// FIX: Without this, Railway sends SIGTERM and the process is force-killed after
// a timeout, potentially dropping in-flight requests and DB connections.

let server;

async function shutdown(signal) {
  console.log(`[server] ${signal} received — shutting down gracefully`);
  server.close(async () => {
    console.log('[server] HTTP server closed');
    await closePool();
    console.log('[db] pool closed');
    process.exit(0);
  });

  // Force-exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('[server] forced exit after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Catch unhandled rejections so they don't silently swallow errors
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException — exiting', err);
  process.exit(1);
});

// ─── Start ────────────────────────────────────────────────────────────────────

server = app.listen(port, '0.0.0.0', () => {
  console.log(`[server] ObserveX running on 0.0.0.0:${port} (NODE_ENV=${process.env.NODE_ENV})`);
  runDatabaseStartupTasks();
});

// WebSocket live logs: ws(s)://host/ws/live-logs?workspace=fsbl-prod-ops&environment=PROD
const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname !== '/ws/live-logs') return socket.destroy();
  wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws, request, url));
});
wss.on('connection', (ws, _request, url) => {
  const workspace = url.searchParams.get('workspace') || 'fsbl-prod-ops';
  const environment = url.searchParams.get('environment') || 'PROD';
  let lastSeen = null;
  ws.send(JSON.stringify({ type:'connected', workspace, environment, message:'Live logs connected' }));
  const timer = setInterval(async () => {
    if (ws.readyState !== ws.OPEN) return;
    try {
      const page = await getLogs(workspace, environment, { page:1, limit:20, range:'all' });
      const items = page.items || [];
      const fresh = lastSeen ? items.filter(x => new Date(x.created_at || x.timestamp) > new Date(lastSeen)) : items.slice(0,5);
      if (items[0]) lastSeen = items[0].created_at || items[0].timestamp;
      if (fresh.length) ws.send(JSON.stringify({ type:'logs', items:fresh }));
    } catch (error) {
      ws.send(JSON.stringify({ type:'error', error:error.message }));
    }
  }, 5000);
  ws.on('close', () => clearInterval(timer));
});
