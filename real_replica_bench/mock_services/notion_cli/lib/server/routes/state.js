import { Router } from 'express';

function requireVerifierToken(req, res, next) {
  const expected = process.env.MOCK_VERIFIER_TOKEN || 'bench-verifier';
  const headerToken = req.headers['x-mock-verifier-token'];
  const auth = req.headers.authorization;
  if (!auth && !headerToken) {
    return res.status(401).json({ error: 'Missing verifier token' });
  }
  const token = headerToken || auth.replace(/^Bearer\s+/i, '');
  if (token !== expected) {
    return res.status(403).json({ error: 'Invalid verifier token' });
  }
  next();
}

export default function stateRoutes(store) {
  const router = Router();

  router.get('/', requireVerifierToken, (req, res) => {
    res.json(store.getState());
  });

  router.post('/reset', requireVerifierToken, (req, res) => {
    const result = store.reset();
    res.json(result);
  });

  router.post('/seed', requireVerifierToken, (req, res) => {
    try {
      const result = store.applySeedOverlay(req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  return router;
}
