import { generateCommerceSeedOverlay } from './commerce-seed.js';

export function generateSeedData() {
  const now = new Date().toISOString();
  const hour = ms => new Date(Date.now() - ms).toISOString();

  const seed = {
    account: {
      userId: 'usr_mock_001',
      email: 'dev@example.com',
      name: 'Mock Developer',
      workspaceId: 'ws_mock_001',
      workspaceName: 'Mock Workspace',
      isLoggedIn: true,
      token: 'ntn_mock_xxxxxxxxxxxxxxxxxxxx',
      authMethod: 'keychain',
      loginTime: now,
    },

    settings: {
      cliVersion: '0.15.0',
      configDir: '~/.config/notion',
      defaultWorkspace: 'ws_mock_001',
      keyring: true,
      notionApiVersion: '2026-05-07',
    },

    entities: {
      workers: {
        wkr_abc123: {
          id: 'wkr_abc123',
          name: 'my-sync-worker',
          status: 'active',
          createdAt: hour(86400000),
          updatedAt: hour(3600000),
          lastDeployedAt: hour(3600000),
          deployCount: 3,
          sourceHash: 'sha256:a1b2c3d4e5f6',
          workspaceId: 'ws_mock_001',
        },
        wkr_def456: {
          id: 'wkr_def456',
          name: 'data-importer',
          status: 'error',
          createdAt: hour(172800000),
          updatedAt: hour(7200000),
          lastDeployedAt: hour(7200000),
          deployCount: 1,
          sourceHash: 'sha256:f6e5d4c3b2a1',
          workspaceId: 'ws_mock_001',
        },
      },

      capabilities: {
        cap_001: {
          id: 'cap_001',
          workerId: 'wkr_abc123',
          key: 'sayHello',
          type: 'tool',
          title: 'Say Hello',
          description: 'A greeting tool that returns a hello message',
          schema: { input: { type: 'object', properties: { name: { type: 'string' } } } },
          createdAt: hour(86400000),
          updatedAt: hour(86400000),
        },
        cap_002: {
          id: 'cap_002',
          workerId: 'wkr_abc123',
          key: 'importUsers',
          type: 'sync',
          title: 'Import Users',
          description: 'Syncs users from external system into Notion',
          schema: { input: { type: 'object', properties: {} } },
          createdAt: hour(86400000),
          updatedAt: hour(86400000),
        },
        cap_003: {
          id: 'cap_003',
          workerId: 'wkr_abc123',
          key: 'externalEvent',
          type: 'webhook',
          title: 'External Event Handler',
          description: 'Receives webhook events from external services',
          schema: { input: { type: 'object', properties: { event: { type: 'string' } } } },
          createdAt: hour(86400000),
          updatedAt: hour(86400000),
        },
        cap_004: {
          id: 'cap_004',
          workerId: 'wkr_def456',
          key: 'fetchData',
          type: 'tool',
          title: 'Fetch Data',
          description: 'Fetches data from an external API',
          schema: { input: { type: 'object', properties: { url: { type: 'string' } } } },
          createdAt: hour(172800000),
          updatedAt: hour(172800000),
        },
      },

      envVars: {
        env_001: { id: 'env_001', workerId: 'wkr_abc123', key: 'API_KEY', value: 'sk-mock-api-key-12345', isSet: true, updatedAt: hour(86400000) },
        env_002: { id: 'env_002', workerId: 'wkr_abc123', key: 'DATABASE_URL', value: 'postgres://mock:mock@localhost/db', isSet: true, updatedAt: hour(86400000) },
        env_003: { id: 'env_003', workerId: 'wkr_def456', key: 'WEBHOOK_SECRET', value: 'whsec_mock_secret', isSet: true, updatedAt: hour(172800000) },
      },

      syncs: {
        sync_001: {
          id: 'sync_001',
          workerId: 'wkr_abc123',
          capabilityKey: 'importUsers',
          status: 'running',
          cursor: { page: 5, lastId: 'user_042' },
          lastRunAt: hour(1800000),
          nextRunAt: new Date(Date.now() + 1800000).toISOString(),
          runCount: 42,
          errorCount: 0,
          schedule: '*/30 * * * *',
        },
      },

      oauthTokens: {
        oauth_001: {
          id: 'oauth_001',
          workerId: 'wkr_abc123',
          capabilityKey: 'githubSync',
          provider: 'github',
          accessToken: 'gho_mock_xxxxxxxxxxxxxxxxxxxx',
          refreshToken: 'ghr_mock_xxxxxxxxxxxxxxxxxxxx',
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          scopes: ['repo', 'read:user'],
          redirectUrl: 'https://www.notion.so/oauth/callback/wkr_abc123/githubSync',
        },
      },

      runs: {
        run_001: {
          id: 'run_001', workerId: 'wkr_abc123', capabilityKey: 'sayHello', capabilityType: 'tool',
          status: 'completed', startedAt: hour(7200000), completedAt: hour(7199766), durationMs: 234,
          input: { name: 'World' }, output: 'Hello, World!',
          logs: [
            { timestamp: hour(7200000), level: 'info', message: 'Executing sayHello' },
            { timestamp: hour(7199766), level: 'info', message: 'Completed in 234ms' },
          ],
        },
        run_002: {
          id: 'run_002', workerId: 'wkr_abc123', capabilityKey: 'importUsers', capabilityType: 'sync',
          status: 'completed', startedAt: hour(3600000), completedAt: hour(3595000), durationMs: 5000,
          input: {}, output: { imported: 12, skipped: 2 },
          logs: [
            { timestamp: hour(3600000), level: 'info', message: 'Starting importUsers sync' },
            { timestamp: hour(3598000), level: 'info', message: 'Processed 12 records' },
            { timestamp: hour(3595000), level: 'info', message: 'Sync completed: 12 imported, 2 skipped' },
          ],
        },
        run_003: {
          id: 'run_003', workerId: 'wkr_def456', capabilityKey: 'fetchData', capabilityType: 'tool',
          status: 'failed', startedAt: hour(5400000), completedAt: hour(5397000), durationMs: 3000,
          input: { url: 'https://api.example.com/data' }, output: null,
          logs: [
            { timestamp: hour(5400000), level: 'info', message: 'Executing fetchData' },
            { timestamp: hour(5398000), level: 'error', message: 'Connection timeout after 2000ms' },
            { timestamp: hour(5397000), level: 'error', message: 'Run failed: ETIMEDOUT' },
          ],
        },
        run_004: {
          id: 'run_004', workerId: 'wkr_abc123', capabilityKey: 'sayHello', capabilityType: 'tool',
          status: 'completed', startedAt: hour(1800000), completedAt: hour(1799850), durationMs: 150,
          input: { name: 'Notion' }, output: 'Hello, Notion!',
          logs: [
            { timestamp: hour(1800000), level: 'info', message: 'Executing sayHello' },
            { timestamp: hour(1799850), level: 'info', message: 'Completed in 150ms' },
          ],
        },
        run_005: {
          id: 'run_005', workerId: 'wkr_abc123', capabilityKey: 'externalEvent', capabilityType: 'webhook',
          status: 'completed', startedAt: hour(900000), completedAt: hour(899900), durationMs: 100,
          input: { event: 'push', payload: { ref: 'refs/heads/main' } }, output: { acknowledged: true },
          logs: [
            { timestamp: hour(900000), level: 'info', message: 'Received webhook event: push' },
            { timestamp: hour(899900), level: 'info', message: 'Event processed successfully' },
          ],
        },
      },

      webhooks: {
        whk_001: {
          id: 'whk_001',
          workerId: 'wkr_abc123',
          capabilityKey: 'externalEvent',
          url: 'https://www.notion.so/webhooks/worker/ws_mock_001/wkr_abc123/whk_001/externalEvent',
          createdAt: hour(86400000),
        },
      },

      pages: {
        page_root: {
          id: 'page_root', parentType: null, parentId: null,
          title: 'Workspace Root', content: '# Mock Workspace\n\nThis is the root of your workspace.',
          properties: {}, archived: false, createdAt: hour(604800000), updatedAt: hour(604800000), createdBy: 'usr_mock_001',
        },
        page_001: {
          id: 'page_001', parentType: 'page', parentId: 'page_root',
          title: 'Getting Started', content: '# Getting Started\n\nWelcome to your Notion workspace.\n\n## Quick Start\n\n1. Create your first page\n2. Set up a database\n3. Invite collaborators',
          properties: {}, archived: false, createdAt: hour(432000000), updatedAt: hour(172800000), createdBy: 'usr_mock_001',
        },
        page_002: {
          id: 'page_002', parentType: 'database', parentId: 'db_001',
          title: 'Fix login bug', content: '# Fix login bug\n\nUsers are unable to log in with SSO.',
          properties: { Status: 'Open', Priority: 1 }, archived: false, createdAt: hour(259200000), updatedAt: hour(86400000), createdBy: 'usr_mock_001',
        },
        page_003: {
          id: 'page_003', parentType: 'database', parentId: 'db_001',
          title: 'Add dark mode', content: '# Add dark mode\n\nImplement dark mode toggle in settings.',
          properties: { Status: 'Closed', Priority: 3 }, archived: false, createdAt: hour(345600000), updatedAt: hour(259200000), createdBy: 'usr_mock_001',
        },
        page_004: {
          id: 'page_004', parentType: 'page', parentId: 'page_001',
          title: 'API Reference', content: '# API Reference\n\nSee the official docs for full API details.',
          properties: {}, archived: false, createdAt: hour(172800000), updatedAt: hour(172800000), createdBy: 'usr_mock_001',
        },
      },

      datasources: {
        ds_001: {
          id: 'ds_001', databaseId: 'db_001', title: 'Tasks',
          properties: {
            Name: { type: 'title' },
            Status: { type: 'select', options: [{ name: 'Open', color: 'red' }, { name: 'In Progress', color: 'yellow' }, { name: 'Closed', color: 'green' }] },
            Priority: { type: 'number', format: 'number' },
          },
          pages: ['page_002', 'page_003'],
          createdAt: hour(345600000),
        },
      },

      files: {
        file_001: {
          id: 'file_001', filename: 'architecture-diagram.png', status: 'uploaded',
          contentType: 'image/png', contentLength: 245891,
          createdAt: hour(172800000), lastEdited: hour(172800000), expiryTime: new Date(Date.now() + 86400000).toISOString(),
        },
        file_002: {
          id: 'file_002', filename: 'meeting-notes.pdf', status: 'uploaded',
          contentType: 'application/pdf', contentLength: 102400,
          createdAt: hour(86400000), lastEdited: hour(86400000), expiryTime: new Date(Date.now() + 86400000).toISOString(),
        },
      },

      apiEndpoints: [
        { method: 'GET', path: 'v1/users/me' },
        { method: 'GET', path: 'v1/users' },
        { method: 'GET', path: 'v1/users/:id' },
        { method: 'POST', path: 'v1/pages' },
        { method: 'GET', path: 'v1/pages/:id' },
        { method: 'PATCH', path: 'v1/pages/:id' },
        { method: 'DELETE', path: 'v1/pages/:id' },
        { method: 'POST', path: 'v1/search' },
        { method: 'GET', path: 'v1/databases/:id' },
        { method: 'POST', path: 'v1/databases/:id/query' },
        { method: 'GET', path: 'v1/blocks/:id' },
        { method: 'PATCH', path: 'v1/blocks/:id' },
        { method: 'GET', path: 'v1/blocks/:id/children' },
        { method: 'PATCH', path: 'v1/blocks/:id/children' },
        { method: 'DELETE', path: 'v1/blocks/:id' },
        { method: 'GET', path: 'v1/comments' },
        { method: 'POST', path: 'v1/comments' },
        { method: 'POST', path: 'v1/data_sources' },
        { method: 'GET', path: 'v1/data_sources/:id' },
        { method: 'PATCH', path: 'v1/data_sources/:id' },
        { method: 'POST', path: 'v1/data_sources/:id/query' },
        { method: 'GET', path: 'v1/data_sources/:id/templates' },
        { method: 'POST', path: 'v1/file_uploads' },
        { method: 'GET', path: 'v1/file_uploads/:id' },
        { method: 'POST', path: 'v1/file_uploads/:id/send' },
        { method: 'POST', path: 'v1/file_uploads/:id/complete' },
        { method: 'GET', path: 'v1/file_uploads' },
      ],
    },

    events: [
      { id: 'evt_001', timestamp: hour(86400000), action: 'account.login', entityType: 'account', entityId: 'usr_mock_001', details: { email: 'dev@example.com' } },
      { id: 'evt_002', timestamp: hour(86400000), action: 'worker.create', entityType: 'worker', entityId: 'wkr_abc123', details: { name: 'my-sync-worker' } },
      { id: 'evt_003', timestamp: hour(172800000), action: 'worker.create', entityType: 'worker', entityId: 'wkr_def456', details: { name: 'data-importer' } },
      { id: 'evt_004', timestamp: hour(86400000), action: 'worker.deploy', entityType: 'worker', entityId: 'wkr_abc123', details: { deployCount: 1 } },
      { id: 'evt_005', timestamp: hour(43200000), action: 'worker.deploy', entityType: 'worker', entityId: 'wkr_abc123', details: { deployCount: 2 } },
      { id: 'evt_006', timestamp: hour(3600000), action: 'worker.deploy', entityType: 'worker', entityId: 'wkr_abc123', details: { deployCount: 3 } },
      { id: 'evt_007', timestamp: hour(7200000), action: 'run.completed', entityType: 'run', entityId: 'run_001', details: { capability: 'sayHello', durationMs: 234 } },
      { id: 'evt_008', timestamp: hour(3600000), action: 'run.completed', entityType: 'run', entityId: 'run_002', details: { capability: 'importUsers', durationMs: 5000 } },
      { id: 'evt_009', timestamp: hour(5400000), action: 'run.failed', entityType: 'run', entityId: 'run_003', details: { capability: 'fetchData', error: 'ETIMEDOUT' } },
      { id: 'evt_010', timestamp: hour(172800000), action: 'page.create', entityType: 'page', entityId: 'page_001', details: { title: 'Getting Started' } },
      { id: 'evt_011', timestamp: hour(86400000), action: 'file.upload', entityType: 'file', entityId: 'file_001', details: { filename: 'architecture-diagram.png' } },
    ],
  };

  for (const profile of activeSeedProfiles()) {
    if (profile === 'commerce' || profile === 'ecommerce') {
      mergeSeedOverlay(seed, generateCommerceSeedOverlay());
    }
  }

  return seed;
}

function activeSeedProfiles() {
  return (process.env.NTN_MOCK_SEED_PROFILE || '')
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);
}

function mergeSeedOverlay(seed, overlay) {
  if (overlay.account) seed.account = { ...seed.account, ...overlay.account };
  if (overlay.settings) seed.settings = { ...seed.settings, ...overlay.settings };
  for (const [type, collection] of Object.entries(overlay.entities || {})) {
    if (type === 'apiEndpoints') {
      seed.entities.apiEndpoints = collection;
      continue;
    }
    if (!seed.entities[type] || Array.isArray(seed.entities[type])) {
      seed.entities[type] = Array.isArray(collection) ? [...collection] : { ...collection };
      continue;
    }
    Object.assign(seed.entities[type], collection);
  }
  if (overlay.events) seed.events.push(...overlay.events);
  if (overlay.fileBlobs) seed.fileBlobs = { ...(seed.fileBlobs || {}), ...overlay.fileBlobs };
}
