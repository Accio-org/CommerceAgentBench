import { v4 as uuidv4 } from 'uuid';

const PREFIXES = {
  worker: 'wkr_',
  capability: 'cap_',
  envVar: 'env_',
  sync: 'sync_',
  oauth: 'oauth_',
  run: 'run_',
  webhook: 'whk_',
  page: 'page_',
  datasource: 'ds_',
  file: 'file_',
  event: 'evt_',
  user: 'usr_',
  workspace: 'ws_',
  database: 'db_',
};

export function generateId(entityType) {
  const prefix = PREFIXES[entityType] || '';
  return prefix + uuidv4().replace(/-/g, '').slice(0, 12);
}
