import { Router } from 'express';

export default function syncsRoutes(store) {
  const router = Router();

  router.get('/:wid/syncs', (req, res) => {
    const syncs = store.listEntities('syncs', { workerId: req.params.wid });
    res.json({ results: syncs, total: syncs.length });
  });

  router.get('/:wid/syncs/:key', (req, res) => {
    const sync = store.listEntities('syncs').find(
      s => s.workerId === req.params.wid && s.capabilityKey === req.params.key
    );
    if (!sync) return res.status(404).json({ error: `Sync "${req.params.key}" not found` });
    res.json(sync);
  });

  router.post('/:wid/syncs/:key/trigger', (req, res) => {
    const sync = store.listEntities('syncs').find(
      s => s.workerId === req.params.wid && s.capabilityKey === req.params.key
    );
    if (!sync) return res.status(404).json({ error: `Sync "${req.params.key}" not found` });

    const updated = store.updateEntity('syncs', sync.id, {
      lastRunAt: new Date().toISOString(),
      runCount: sync.runCount + 1,
    });
    store.addEvent('sync.trigger', 'sync', sync.id, { capabilityKey: req.params.key });

    if (req.body.preview) {
      return res.json({ preview: true, sync: updated, nextContext: updated.cursor });
    }
    res.json({ triggered: true, sync: updated });
  });

  router.post('/:wid/syncs/:key/pause', (req, res) => {
    const sync = store.listEntities('syncs').find(
      s => s.workerId === req.params.wid && s.capabilityKey === req.params.key
    );
    if (!sync) return res.status(404).json({ error: `Sync "${req.params.key}" not found` });
    const updated = store.updateEntity('syncs', sync.id, { status: 'paused' });
    store.addEvent('sync.pause', 'sync', sync.id, { capabilityKey: req.params.key });
    res.json(updated);
  });

  router.post('/:wid/syncs/:key/resume', (req, res) => {
    const sync = store.listEntities('syncs').find(
      s => s.workerId === req.params.wid && s.capabilityKey === req.params.key
    );
    if (!sync) return res.status(404).json({ error: `Sync "${req.params.key}" not found` });
    const updated = store.updateEntity('syncs', sync.id, { status: 'running' });
    store.addEvent('sync.resume', 'sync', sync.id, { capabilityKey: req.params.key });
    res.json(updated);
  });

  router.get('/:wid/syncs/:key/state', (req, res) => {
    const sync = store.listEntities('syncs').find(
      s => s.workerId === req.params.wid && s.capabilityKey === req.params.key
    );
    if (!sync) return res.status(404).json({ error: `Sync "${req.params.key}" not found` });
    res.json({ cursor: sync.cursor, runCount: sync.runCount, errorCount: sync.errorCount, lastRunAt: sync.lastRunAt });
  });

  router.delete('/:wid/syncs/:key/state', (req, res) => {
    const sync = store.listEntities('syncs').find(
      s => s.workerId === req.params.wid && s.capabilityKey === req.params.key
    );
    if (!sync) return res.status(404).json({ error: `Sync "${req.params.key}" not found` });
    store.updateEntity('syncs', sync.id, { cursor: null, runCount: 0, errorCount: 0 });
    store.addEvent('sync.state.reset', 'sync', sync.id, { capabilityKey: req.params.key });
    res.json({ message: `Sync state for "${req.params.key}" has been reset` });
  });

  return router;
}
