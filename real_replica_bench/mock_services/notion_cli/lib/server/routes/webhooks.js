import { Router } from 'express';

export default function webhooksRoutes(store) {
  const router = Router();

  router.get('/:wid/webhooks', (req, res) => {
    const webhooks = store.listEntities('webhooks', { workerId: req.params.wid });
    res.json({ results: webhooks, total: webhooks.length });
  });

  return router;
}
