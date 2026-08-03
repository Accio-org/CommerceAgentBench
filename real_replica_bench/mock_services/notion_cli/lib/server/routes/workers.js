import { Router } from 'express';
import { generateId } from '../../utils/ids.js';

export default function workersRoutes(store) {
  const router = Router();

  router.get('/', (req, res) => {
    const workers = store.listEntities('workers');
    res.json({ results: workers, total: workers.length });
  });

  router.post('/', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const existing = store.listEntities('workers').find(w => w.name === name);
    if (existing) return res.status(409).json({ error: `Worker "${name}" already exists` });

    const worker = store.createEntity('workers', {
      name,
      status: 'active',
      deployCount: 0,
      sourceHash: null,
      lastDeployedAt: null,
      workspaceId: store.getAccount().workspaceId,
    });
    store.addEvent('worker.create', 'worker', worker.id, { name });
    res.status(201).json(worker);
  });

  router.get('/:id', (req, res) => {
    const worker = store.getEntity('workers', req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    res.json(worker);
  });

  router.patch('/:id', (req, res) => {
    const worker = store.updateEntity('workers', req.params.id, req.body);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    store.addEvent('worker.update', 'worker', worker.id, req.body);
    res.json(worker);
  });

  router.delete('/:id', (req, res) => {
    const worker = store.getEntity('workers', req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    store.deleteEntity('workers', req.params.id);
    store.addEvent('worker.delete', 'worker', req.params.id, { name: worker.name });
    res.json({ message: `Worker "${worker.name}" deleted` });
  });

  router.post('/:id/deploy', (req, res) => {
    const worker = store.getEntity('workers', req.params.id);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });
    const updated = store.updateEntity('workers', req.params.id, {
      status: 'active',
      deployCount: worker.deployCount + 1,
      lastDeployedAt: new Date().toISOString(),
      sourceHash: 'sha256:' + Math.random().toString(36).slice(2, 14),
    });
    store.addEvent('worker.deploy', 'worker', updated.id, { name: updated.name, deployCount: updated.deployCount });
    res.json(updated);
  });

  return router;
}
