import { Router } from 'express';
import express from 'express';

export default function filesRoutes(store) {
  const router = Router();

  router.get('/', (req, res) => {
    const files = store.listEntities('files');
    res.json({ results: files, total: files.length });
  });

  router.post('/', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
    let filename, contentType, contentLength, externalUrl, contentBase64;

    if (req.is('application/json') || (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body))) {
      filename = req.body.filename || 'untitled';
      contentType = req.body.contentType || 'application/octet-stream';
      contentLength = req.body.contentLength || 0;
      externalUrl = req.body.externalUrl || null;
      contentBase64 = req.body.content || null;
    } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      filename = req.query.filename || `upload-${Date.now()}.bin`;
      contentType = req.headers['content-type'] || 'application/octet-stream';
      contentLength = req.body.length;
    } else {
      filename = 'untitled';
      contentType = 'application/octet-stream';
      contentLength = 0;
    }

    const file = store.createEntity('files', {
      filename,
      status: 'uploaded',
      contentType,
      contentLength,
      externalUrl: externalUrl || null,
      lastEdited: new Date().toISOString(),
      expiryTime: new Date(Date.now() + 86400000).toISOString(),
    });

    if (contentBase64) {
      store.saveFileBlob(file.id, Buffer.from(contentBase64, 'base64'));
      store.updateEntity('files', file.id, { contentLength: Buffer.from(contentBase64, 'base64').length });
      file.contentLength = Buffer.from(contentBase64, 'base64').length;
    } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      store.saveFileBlob(file.id, req.body);
    }

    store.addEvent('file.upload', 'file', file.id, { filename: file.filename, contentLength: file.contentLength });
    res.status(201).json(file);
  });

  router.post('/:id/send', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
    const file = store.getEntity('files', req.params.id);
    if (!file) return res.status(404).json({ error: 'File upload not found' });

    let buffer;
    if (req.is('application/json') || (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body))) {
      if (req.body.content) {
        buffer = Buffer.from(req.body.content, 'base64');
      }
    } else if (Buffer.isBuffer(req.body) && req.body.length > 0) {
      buffer = req.body;
    }

    if (buffer) {
      const existing = store.getFileBlob(file.id);
      if (existing) {
        const combined = Buffer.concat([existing, buffer]);
        store.saveFileBlob(file.id, combined);
        store.updateEntity('files', file.id, {
          contentLength: combined.length,
          status: 'uploaded',
        });
      } else {
        store.saveFileBlob(file.id, buffer);
        store.updateEntity('files', file.id, {
          contentLength: buffer.length,
          status: 'uploaded',
        });
      }
    }

    const updated = store.getEntity('files', req.params.id);
    res.json(updated);
  });

  router.get('/:id', (req, res) => {
    const file = store.getEntity('files', req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });
    res.json(file);
  });

  router.get('/:id/content', (req, res) => {
    const file = store.getEntity('files', req.params.id);
    if (!file) return res.status(404).json({ error: 'File not found' });

    const blob = store.getFileBlob(req.params.id);
    if (!blob) return res.status(404).json({ error: 'No file content stored' });

    res.set('Content-Type', file.contentType || 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.set('Content-Length', blob.length);
    res.send(blob);
  });

  return router;
}
