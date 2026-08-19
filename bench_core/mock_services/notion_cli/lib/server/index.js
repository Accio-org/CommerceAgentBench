import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { StateStore } from '../state/store.js';
import healthRoutes from './routes/health.js';
import stateRoutes from './routes/state.js';
import accountRoutes from './routes/account.js';
import workersRoutes from './routes/workers.js';
import capabilitiesRoutes from './routes/capabilities.js';
import syncsRoutes from './routes/syncs.js';
import envVarsRoutes from './routes/env-vars.js';
import oauthRoutes from './routes/oauth.js';
import runsRoutes from './routes/runs.js';
import webhooksRoutes from './routes/webhooks.js';
import pagesRoutes from './routes/pages.js';
import datasourcesRoutes from './routes/datasources.js';
import filesRoutes from './routes/files.js';
import apiEndpointsRoutes from './routes/api-endpoints.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(store) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use(express.static(path.join(__dirname, '../../public')));

  app.use((req, res, next) => {
    req.store = store;
    next();
  });

  app.use('/health', healthRoutes(store));
  app.use('/api/state', stateRoutes(store));
  app.use('/api/account', accountRoutes(store));
  app.use('/api/workers', workersRoutes(store));
  app.use('/api/workers', capabilitiesRoutes(store));
  app.use('/api/workers', syncsRoutes(store));
  app.use('/api/workers', envVarsRoutes(store));
  app.use('/api/workers', oauthRoutes(store));
  app.use('/api/workers', runsRoutes(store));
  app.use('/api/workers', webhooksRoutes(store));
  app.use('/api/pages', pagesRoutes(store));
  app.use('/api/datasources', datasourcesRoutes(store));
  app.use('/api/files', filesRoutes(store));
  app.use('/api/endpoints', apiEndpointsRoutes(store));

  app.use((err, req, res, _next) => {
    console.error(err.stack || err.message);
    res.status(500).json({ error: err.message });
  });

  return app;
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMainModule) {
  const store = new StateStore();
  store.load();
  const app = createApp(store);
  const port = parseInt(process.env.NTN_MOCK_PORT || '3456', 10);
  app.listen(port, () => {
    console.log(`ntn-mock server running on http://localhost:${port}`);
    console.log(`  Docs:  http://localhost:${port}/`);
    console.log(`  Admin: http://localhost:${port}/admin.html`);
    console.log(`  API:   http://localhost:${port}/api/state`);
  });
}
