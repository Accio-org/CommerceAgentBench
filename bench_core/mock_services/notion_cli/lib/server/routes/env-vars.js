import { Router } from 'express';

export default function envVarsRoutes(store) {
  const router = Router();

  router.get('/:wid/env', (req, res) => {
    const vars = store.listEntities('envVars', { workerId: req.params.wid });
    const keys = vars.map(v => ({ key: v.key, isSet: v.isSet, updatedAt: v.updatedAt }));
    res.json({ results: keys, total: keys.length });
  });

  router.post('/:wid/env', (req, res) => {
    const { vars } = req.body;
    if (!vars || !Array.isArray(vars)) {
      return res.status(400).json({ error: 'vars array is required (e.g. [{ key: "K", value: "V" }])' });
    }

    const results = [];
    for (const { key, value } of vars) {
      if (!key) continue;
      const existing = store.listEntities('envVars').find(
        v => v.workerId === req.params.wid && v.key === key
      );
      if (existing) {
        store.updateEntity('envVars', existing.id, { value, isSet: true });
        results.push({ key, action: 'updated' });
      } else {
        store.createEntity('envVars', { workerId: req.params.wid, key, value, isSet: true });
        results.push({ key, action: 'created' });
      }
    }
    store.addEvent('env.set', 'envVar', req.params.wid, { keys: results.map(r => r.key) });
    res.json({ results });
  });

  router.delete('/:wid/env/:key', (req, res) => {
    const envVar = store.listEntities('envVars').find(
      v => v.workerId === req.params.wid && v.key === req.params.key
    );
    if (!envVar) return res.status(404).json({ error: `Environment variable "${req.params.key}" not found` });
    store.deleteEntity('envVars', envVar.id);
    store.addEvent('env.unset', 'envVar', req.params.wid, { key: req.params.key });
    res.json({ message: `Removed "${req.params.key}"` });
  });

  router.get('/:wid/env/pull', (req, res) => {
    const vars = store.listEntities('envVars', { workerId: req.params.wid });
    const envContent = vars.map(v => `${v.key}=${v.value}`).join('\n');
    res.type('text/plain').send(envContent);
  });

  router.post('/:wid/env/push', (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'content is required (KEY=VALUE lines)' });

    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const results = [];
    for (const line of lines) {
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      const value = line.slice(eqIdx + 1).trim();
      const existing = store.listEntities('envVars').find(
        v => v.workerId === req.params.wid && v.key === key
      );
      if (existing) {
        store.updateEntity('envVars', existing.id, { value, isSet: true });
      } else {
        store.createEntity('envVars', { workerId: req.params.wid, key, value, isSet: true });
      }
      results.push(key);
    }
    store.addEvent('env.push', 'envVar', req.params.wid, { keys: results });
    res.json({ message: `Pushed ${results.length} variables`, keys: results });
  });

  return router;
}
