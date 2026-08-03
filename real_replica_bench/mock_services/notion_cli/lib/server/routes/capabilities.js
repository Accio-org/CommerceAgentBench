import { Router } from 'express';
import { generateId } from '../../utils/ids.js';

export default function capabilitiesRoutes(store) {
  const router = Router();

  router.get('/:wid/capabilities', (req, res) => {
    const caps = store.listEntities('capabilities', { workerId: req.params.wid });
    res.json({ results: caps, total: caps.length });
  });

  router.post('/:wid/capabilities/:key/exec', (req, res) => {
    const cap = store.listEntities('capabilities').find(
      c => c.workerId === req.params.wid && c.key === req.params.key
    );
    if (!cap) return res.status(404).json({ error: `Capability "${req.params.key}" not found` });

    const input = req.body.data || req.body || {};
    const startedAt = new Date().toISOString();

    let output;
    if (cap.key === 'sayHello') {
      output = `Hello, ${input.name || 'World'}!`;
    } else if (cap.type === 'sync') {
      output = { imported: Math.floor(Math.random() * 20), skipped: Math.floor(Math.random() * 5) };
    } else {
      output = { result: 'mock execution completed', input };
    }

    const durationMs = Math.floor(Math.random() * 500) + 50;
    const completedAt = new Date(Date.now()).toISOString();

    const run = store.createEntity('runs', {
      workerId: req.params.wid,
      capabilityKey: cap.key,
      capabilityType: cap.type,
      status: 'completed',
      startedAt,
      completedAt,
      durationMs,
      input,
      output,
      logs: [
        { timestamp: startedAt, level: 'info', message: `Executing ${cap.key}` },
        { timestamp: completedAt, level: 'info', message: `Completed in ${durationMs}ms` },
      ],
    });
    store.addEvent('run.completed', 'run', run.id, { capability: cap.key, durationMs });

    res.json({ output, run });
  });

  return router;
}
