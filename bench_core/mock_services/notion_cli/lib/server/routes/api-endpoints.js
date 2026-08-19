import { Router } from 'express';
import { validateParentType, validateBlockChildren } from '../validation.js';

export default function apiEndpointsRoutes(store) {
  const router = Router();

  router.get('/', (req, res) => {
    const endpoints = store.listEntities('apiEndpoints');
    res.json({ results: endpoints, total: endpoints.length });
  });

  router.post('/proxy', (req, res) => {
    const { method, path: apiPath, body, queryParams, headers: extraHeaders } = req.body;
    if (!apiPath) return res.status(400).json({ error: 'path is required' });

    store.addEvent('api.proxy', 'api', null, {
      method: method || 'GET', path: apiPath, body, queryParams, headers: extraHeaders,
    });

    const account = store.getAccount();

    if (apiPath === 'v1/users/me' || apiPath === '/v1/users/me') {
      return res.json({
        object: 'user', id: account.userId, name: account.name, type: 'person',
        person: { email: account.email },
      });
    }

    if (apiPath.match(/^\/v1\/users\/?$/) || apiPath.match(/^v1\/users\/?$/)) {
      return res.json({
        object: 'list',
        results: [{
          object: 'user', id: account.userId, name: account.name, type: 'person',
          person: { email: account.email },
        }],
      });
    }

    const pageMatch = apiPath.match(/^\/?v1\/pages\/([^/]+)$/);
    if (pageMatch) {
      const pageId = pageMatch[1];
      if ((method || 'GET').toUpperCase() === 'PATCH' && body) {
        const updated = store.updateEntity('pages', pageId, body);
        if (updated) return res.json({ object: 'page', id: updated.id, ...updated });
        return res.status(404).json({ object: 'error', status: 404, message: 'Page not found' });
      }
      const page = store.getEntity('pages', pageId);
      if (page) return res.json({ object: 'page', id: page.id, ...page });
      return res.status(404).json({ object: 'error', status: 404, message: 'Page not found' });
    }

    if (apiPath.match(/^\/?v1\/pages\/?$/) && (method || 'GET').toUpperCase() === 'POST' && body) {
      const parentErr = validateParentType(body.parent);
      if (parentErr) return res.status(parentErr.status).json({ object: 'error', status: parentErr.status, message: parentErr.error });

      const page = store.createEntity('pages', {
        title: extractTitle(body) || 'Untitled',
        content: '',
        properties: body.properties || {},
        parentType: body.parent?.page_id ? 'page' : (body.parent?.database_id ? 'database' : null),
        parentId: body.parent?.page_id || body.parent?.database_id || null,
        archived: false,
        createdBy: account.userId,
      });
      return res.json({ object: 'page', id: page.id, ...page });
    }

    if (apiPath === 'v1/search' || apiPath === '/v1/search') {
      const query = (body?.query || queryParams?.query || '').toLowerCase();
      const pages = store.listEntities('pages').filter(
        p => !p.archived && (p.title.toLowerCase().includes(query) || p.content.toLowerCase().includes(query))
      );
      return res.json({ object: 'list', results: pages.map(p => ({ object: 'page', id: p.id, ...p })) });
    }

    const dsQueryMatch = apiPath.match(/^\/?v1\/data_sources\/([^/]+)\/query$/);
    if (dsQueryMatch) {
      const dsId = dsQueryMatch[1];
      const ds = store.getEntity('datasources', dsId);
      if (!ds) return res.status(404).json({ object: 'error', status: 404, message: 'Data source not found' });
      const pageIds = ds.pages || [];
      const pages = pageIds.map(pid => store.getEntity('pages', pid)).filter(Boolean);
      return res.json({
        object: 'list', results: pages.map(p => ({ object: 'page', id: p.id, ...p })),
        has_more: false, next_cursor: null,
      });
    }

    const dsMatch = apiPath.match(/^\/?v1\/data_sources\/([^/]+)$/);
    if (dsMatch) {
      const ds = store.getEntity('datasources', dsMatch[1]);
      if (ds) return res.json({ object: 'data_source', id: ds.id, ...ds });
      return res.status(404).json({ object: 'error', status: 404, message: 'Data source not found' });
    }

    const commentMatch = apiPath.match(/^\/?v1\/comments\/?$/);
    if (commentMatch) {
      if ((method || 'GET').toUpperCase() === 'POST' && body) {
        return res.json({ object: 'comment', id: `comment_${Date.now()}`, ...body, created_time: new Date().toISOString() });
      }
      return res.json({ object: 'list', results: [] });
    }

    const blockChildrenMatch = apiPath.match(/^\/?v1\/blocks\/([^/]+)\/children$/);
    if (blockChildrenMatch) {
      if ((method || 'GET').toUpperCase() === 'PATCH' && body) {
        const childErr = validateBlockChildren(body.children);
        if (childErr) return res.status(childErr.status).json({ object: 'error', status: childErr.status, message: childErr.error });
        return res.json({ object: 'list', results: (body.children || []).map((c, i) => ({ object: 'block', id: `block_${Date.now()}_${i}`, ...c })) });
      }
      return res.json({ object: 'list', results: [] });
    }

    const fileUploadsMatch = apiPath.match(/^\/?v1\/file_uploads\/?$/);
    if (fileUploadsMatch) {
      if ((method || 'GET').toUpperCase() === 'POST') {
        const file = store.createEntity('files', {
          filename: body?.filename || `upload-${Date.now()}.bin`,
          status: 'uploaded',
          contentType: body?.content_type || 'application/octet-stream',
          contentLength: body?.content_length || 0,
          expiryTime: new Date(Date.now() + 3600000).toISOString(),
          lastEdited: new Date().toISOString(),
        });
        return res.json({ object: 'file_upload', id: file.id, ...file });
      }
      const files = store.listEntities('files');
      return res.json({ object: 'list', results: files.map(f => ({ object: 'file_upload', id: f.id, ...f })) });
    }

    const fileUploadSendMatch = apiPath.match(/^\/?v1\/file_uploads\/([^/]+)\/send$/);
    if (fileUploadSendMatch) {
      const fileId = fileUploadSendMatch[1];
      const file = store.getEntity('files', fileId);
      if (!file) return res.status(404).json({ object: 'error', status: 404, message: 'File upload not found' });
      const filePayload = req.body.file;
      if (filePayload?.content) {
        const buffer = Buffer.from(filePayload.content, 'base64');
        const existing = store.getFileBlob(fileId);
        if (existing) {
          const combined = Buffer.concat([existing, buffer]);
          store.saveFileBlob(fileId, combined);
          store.updateEntity('files', fileId, { contentLength: combined.length, status: 'uploaded' });
        } else {
          store.saveFileBlob(fileId, buffer);
          store.updateEntity('files', fileId, { contentLength: buffer.length, status: 'uploaded' });
        }
      }
      const updated = store.getEntity('files', fileId);
      return res.json({ object: 'file_upload', id: updated.id, ...updated });
    }

    const fileUploadCompleteMatch = apiPath.match(/^\/?v1\/file_uploads\/([^/]+)\/complete$/);
    if (fileUploadCompleteMatch) {
      const file = store.getEntity('files', fileUploadCompleteMatch[1]);
      if (!file) return res.status(404).json({ object: 'error', status: 404, message: 'File upload not found' });
      store.updateEntity('files', file.id, { status: 'uploaded' });
      const updated = store.getEntity('files', file.id);
      return res.json({ object: 'file_upload', id: updated.id, ...updated });
    }

    const fileUploadIdMatch = apiPath.match(/^\/?v1\/file_uploads\/([^/]+)$/);
    if (fileUploadIdMatch) {
      const file = store.getEntity('files', fileUploadIdMatch[1]);
      if (file) return res.json({ object: 'file_upload', id: file.id, ...file });
      return res.status(404).json({ object: 'error', status: 404, message: 'File upload not found' });
    }

    const dbMatch = apiPath.match(/^\/?v1\/databases\/([^/]+)$/);
    if (dbMatch) {
      const dsList = store.listEntities('datasources').filter(ds => ds.databaseId === dbMatch[1]);
      return res.json({
        object: 'database', id: dbMatch[1],
        data_sources: dsList.map(ds => ({ id: ds.id, title: ds.title })),
      });
    }

    res.status(404).json({
      object: 'error', status: 404,
      message: `Mock endpoint not implemented for: ${method || 'GET'} ${apiPath}`,
    });
  });

  return router;
}

function extractTitle(body) {
  try {
    const titleProp = body?.properties?.Name?.title || body?.properties?.title?.title;
    if (Array.isArray(titleProp) && titleProp[0]?.text?.content) return titleProp[0].text.content;
  } catch { /* ignore */ }
  return null;
}
