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

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

app.get('/health', async (_req, res) => {
  let database = 'not_configured';
  try {
    if (hasDatabase) {
      await query('SELECT 1');
      database = 'connected';
    }
  } catch (error) {
    database = `error: ${error.message}`;
  }
  res.json({ ok: true, service: 'observex', database, timestamp: new Date().toISOString() });
});

app.use('/api', apiRoutes);

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('[api] error', error);
  res.status(error.status || 500).json({ error: error.message || 'Internal server error' });
});

async function boot() {
  if (process.env.AUTO_MIGRATE !== 'false') {
    await migrate();
  }
  if (process.env.SEED_DEMO_DATA !== 'false') {
    await seed();
  }
  app.listen(port, () => {
    console.log(`[server] ObserveX running on port ${port}`);
  });
}

boot().catch((error) => {
  console.error('[server] failed to start', error);
  process.exit(1);
});
