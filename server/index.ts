import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app';
import { backup, openDb } from './db';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR ?? './data');
const port = Number(process.env.PORT ?? 3000);
const webDir = path.resolve(here, 'web');

const { db, sqlite } = openDb(path.join(dataDir, 'budget.db'));
const app = createApp(db, { allowSignup: process.env.ALLOW_SIGNUP !== 'false' });

// Once built, the server also hands out the interface. In development Vite does that.
if (fs.existsSync(path.join(webDir, 'index.html'))) {
  const root = path.relative(process.cwd(), webDir) || '.';
  app.use('*', serveStatic({ root }));
  app.get('*', serveStatic({ root, path: 'index.html' }));
}

const runBackup = () => backup(sqlite, dataDir).catch((e) => console.error('Backup failed:', e));
runBackup();
setInterval(runBackup, 24 * 60 * 60 * 1000).unref();

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Budget Calculator is running on port ${port}. Data is in ${dataDir}.`);
});

const stop = () => {
  server.close();
  sqlite.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
