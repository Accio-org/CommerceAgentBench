import { Router } from 'express';

export default function accountRoutes(store) {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(store.getAccount());
  });

  router.post('/login', (req, res) => {
    const account = store.updateAccount({
      isLoggedIn: true,
      loginTime: new Date().toISOString(),
      token: 'ntn_mock_xxxxxxxxxxxxxxxxxxxx',
    });
    store.addEvent('account.login', 'account', account.userId, { email: account.email });
    res.json(account);
  });

  router.post('/logout', (req, res) => {
    const account = store.updateAccount({
      isLoggedIn: false,
      token: null,
      loginTime: null,
    });
    store.addEvent('account.logout', 'account', account.userId, { email: account.email });
    res.json({ message: 'Logged out' });
  });

  return router;
}
