import { Router } from 'express';

export default function datasourcesRoutes(store) {
  const router = Router();

  router.get('/', (req, res) => {
    const datasources = store.listEntities('datasources');
    res.json({ results: datasources, total: datasources.length });
  });

  router.post('/:id/query', (req, res) => {
    const ds = store.getEntity('datasources', req.params.id);
    if (!ds) return res.status(404).json({ error: 'Data source not found' });

    const limit = parseInt(req.body.limit || req.query.limit || '25', 10);
    const startCursor = parseInt(req.body.start_cursor || req.query.start_cursor || '0', 10);

    let pages = (ds.pages || []).map(pid => store.getEntity('pages', pid)).filter(Boolean);

    if (req.body.filter) {
      const filter = req.body.filter;
      pages = pages.filter(p => {
        return Object.entries(filter).every(([key, val]) => {
          if (p.properties && p.properties[key] !== undefined) return p.properties[key] === val;
          if (p[key] !== undefined) return p[key] === val;
          return true;
        });
      });
    }

    if (req.body.sort) {
      const sorts = Array.isArray(req.body.sort) ? req.body.sort : [req.body.sort];
      for (const s of sorts.reverse()) {
        const [prop, dir] = typeof s === 'string' ? s.split(' ') : [s.property, s.direction];
        pages.sort((a, b) => {
          const va = a.properties?.[prop] ?? a[prop] ?? '';
          const vb = b.properties?.[prop] ?? b[prop] ?? '';
          const cmp = va < vb ? -1 : va > vb ? 1 : 0;
          return dir === 'desc' ? -cmp : cmp;
        });
      }
    }

    const slice = pages.slice(startCursor, startCursor + limit);
    const hasMore = startCursor + limit < pages.length;

    res.json({
      results: slice,
      has_more: hasMore,
      next_cursor: hasMore ? String(startCursor + limit) : null,
      total: pages.length,
    });
  });

  router.get('/resolve/:dbId', (req, res) => {
    const datasources = store.listEntities('datasources').filter(
      ds => ds.databaseId === req.params.dbId
    );
    if (datasources.length === 0) {
      return res.status(404).json({ error: `No data sources found for database "${req.params.dbId}"` });
    }
    res.json({ results: datasources.map(ds => ({ id: ds.id, title: ds.title })) });
  });

  return router;
}
