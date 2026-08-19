import { Router } from 'express';

export default function oauthRoutes(store) {
  const router = Router();

  router.post('/:wid/oauth/:key/start', (req, res) => {
    const token = store.listEntities('oauthTokens').find(
      t => t.workerId === req.params.wid && t.capabilityKey === req.params.key
    );
    const authUrl = `https://accounts.example.com/oauth/authorize?client_id=mock&redirect_uri=${encodeURIComponent(
      token?.redirectUrl || `https://www.notion.so/oauth/callback/${req.params.wid}/${req.params.key}`
    )}&scope=read,write`;

    store.addEvent('oauth.start', 'oauth', req.params.wid, { capabilityKey: req.params.key });
    res.json({ authorizationUrl: authUrl, message: 'Open this URL to authorize' });
  });

  router.get('/:wid/oauth/:key/token', (req, res) => {
    const token = store.listEntities('oauthTokens').find(
      t => t.workerId === req.params.wid && t.capabilityKey === req.params.key
    );
    if (!token) return res.status(404).json({ error: `No OAuth token for capability "${req.params.key}"` });
    res.json(token);
  });

  router.get('/:wid/oauth/redirect-url', (req, res) => {
    const account = store.getAccount();
    res.json({
      redirectUrl: `https://www.notion.so/oauth/callback/${account.workspaceId}/${req.params.wid}`,
    });
  });

  return router;
}
