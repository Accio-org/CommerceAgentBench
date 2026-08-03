import { Router } from 'express';

export default function runsRoutes(store) {
  const router = Router();

  router.get('/:wid/runs', (req, res) => {
    const runs = store.listEntities('runs', { workerId: req.params.wid });
    runs.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    const summary = runs.map(r => ({
      id: r.id, capabilityKey: r.capabilityKey, capabilityType: r.capabilityType,
      status: r.status, startedAt: r.startedAt, durationMs: r.durationMs,
    }));
    res.json({ results: summary, total: summary.length });
  });

  router.get('/:wid/runs/:rid/logs', (req, res) => {
    const run = store.getEntity('runs', req.params.rid);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    if (run.workerId !== req.params.wid) return res.status(404).json({ error: 'Run not found in this worker' });
    res.json({ runId: run.id, status: run.status, logs: run.logs || [] });
  });

  return router;
}
