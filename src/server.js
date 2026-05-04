import compression from 'compression';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import apiRoutes from './routes/api.js';
import { hasDatabase, query } from './db/pool.js';
import { migrate } from './db/migrate.js';
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
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

// Railway healthcheck must be fast and must not wait for PostgreSQL.
app.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'observex',
    uptime_seconds: Math.round(process.uptime()),
    boot: bootState,
    timestamp: new Date().toISOString()
  });
});

// Readiness is stricter and can be used manually to validate PostgreSQL.
app.get('/ready', async (_req, res) => {
  if (!hasDatabase) {
    return res.status(200).json({ ok: true, database: 'not_configured', message: 'App is running without PostgreSQL. Add DATABASE_URL to enable persistence.' });
  }
  try {
    await query('SELECT 1');
    return res.json({ ok: true, database: 'connected', boot: bootState });
  } catch (error) {
    return res.status(503).json({ ok: false, database: 'error', error: error.message, boot: bootState });
  }
});

app.use('/api', apiRoutes);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('[api] error', error);
  res.status(error.status || 500).json({ error: error.message || 'Internal server error' });
});

async function runDatabaseStartupTasks() {
  if (!hasDatabase) {
    bootState.database = 'not_configured';
    bootState.migration = 'skipped';
    bootState.seed = 'skipped';
    console.warn('[db] DATABASE_URL missing. Running UI/API with in-memory demo fallback.');
    return;
  }

  try {
    bootState.database = 'connecting';
    await query('SELECT 1');
    bootState.database = 'connected';

    if (process.env.AUTO_MIGRATE !== 'false') {
      bootState.migration = 'running';
      await migrate();
      bootState.migration = 'completed';
    } else {
      bootState.migration = 'disabled';
    }

    if (process.env.SEED_DEMO_DATA !== 'false') {
      bootState.seed = 'running';
      await seed();
      bootState.seed = 'completed';
    } else {
      bootState.seed = 'disabled';
    }
  } catch (error) {
    bootState.lastError = error.message;
    bootState.database = bootState.database === 'connecting' ? 'connection_failed' : bootState.database;
    if (bootState.migration === 'running') bootState.migration = 'failed';
    if (bootState.seed === 'running') bootState.seed = 'failed';
    console.error('[db] startup task failed. App remains online; check /ready for details.', error);
  }
}

app.listen(port, '0.0.0.0', () => {
  console.log(`[server] ObserveX running on 0.0.0.0:${port}`);
  runDatabaseStartupTasks();
});
