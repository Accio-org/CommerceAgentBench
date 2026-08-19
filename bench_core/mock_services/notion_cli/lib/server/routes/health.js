import { Router } from 'express';

export default function healthRoutes(store) {
  const router = Router();
  const startTime = Date.now();

  router.get('/', (req, res) => {
    res.json({
      status: 'ok',
      version: store.getSettings().cliVersion,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    });
  });

  return router;
}
