import { Router } from 'express';

export default function pagesRoutes(store) {
  const router = Router();

  router.get('/', (req, res) => {
    const pages = store.listEntities('pages');
    res.json({ results: pages, total: pages.length });
  });

  router.post('/', (req, res) => {
    const { parent, content, title } = req.body;
    let parentType = null, parentId = null;
    if (parent) {
      const parts = parent.split(':');
      if (parts.length === 2) {
        parentType = parts[0];
        parentId = parts[1];
      }
    }
    const page = store.createEntity('pages', {
      parentType,
      parentId,
      title: title || extractTitle(content) || 'Untitled',
      content: content || '',
      properties: {},
      archived: false,
      createdBy: store.getAccount().userId,
    });
    store.addEvent('page.create', 'page', page.id, { title: page.title });
    res.status(201).json(page);
  });

  router.get('/:id', (req, res) => {
    const page = store.getEntity('pages', req.params.id);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    res.json(page);
  });

  router.patch('/:id', (req, res) => {
    const page = store.getEntity('pages', req.params.id);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const patch = {};
    if (req.body.content !== undefined) {
      patch.content = req.body.content;
      patch.title = req.body.title || extractTitle(req.body.content) || page.title;
    }
    if (req.body.title !== undefined) patch.title = req.body.title;
    if (req.body.properties !== undefined) patch.properties = req.body.properties;
    const updated = store.updateEntity('pages', req.params.id, patch);
    store.addEvent('page.update', 'page', updated.id, { title: updated.title });
    res.json(updated);
  });

  router.post('/:id/trash', (req, res) => {
    const page = store.getEntity('pages', req.params.id);
    if (!page) return res.status(404).json({ error: 'Page not found' });
    const updated = store.updateEntity('pages', req.params.id, { archived: true });
    store.addEvent('page.trash', 'page', updated.id, { title: updated.title });
    res.json({ message: `Page "${updated.title}" moved to trash` });
  });

  return router;
}

function extractTitle(content) {
  if (!content) return null;
  const match = content.match(/^#\s+(.+)/m);
  return match ? match[1].trim() : null;
}
