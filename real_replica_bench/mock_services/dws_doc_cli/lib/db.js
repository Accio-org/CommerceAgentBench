'use strict';

const { Database } = require('bun:sqlite');
const { readFileSync, existsSync, mkdirSync, unlinkSync } = require('fs');
const { join, dirname } = require('path');

const MOCK_DIR = join(__dirname, '..');
const MOCK_HOME = process.env.DWS_MOCK_HOME || join(require('os').homedir(), '.dws-mock');
const DB_PATH = join(MOCK_HOME, 'mock.db');

let _db = null;

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function openDb(path) {
  const p = path || DB_PATH;
  ensureDir(dirname(p));

  const db = new Database(p);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const schemaSql = readFileSync(join(MOCK_DIR, 'schema.sql'), 'utf-8');
  db.exec(schemaSql);

  const count = db.query('SELECT COUNT(*) as c FROM documents').get();
  if (count.c === 0) {
    const seedPath = join(MOCK_DIR, 'seeds', 'default.sql');
    if (existsSync(seedPath)) {
      db.exec(readFileSync(seedPath, 'utf-8'));
    }
  }

  _db = db;
  return db;
}

function getDb() {
  if (!_db) openDb();
  return _db;
}

function resetDb() {
  const db = getDb();
  db.exec('DELETE FROM comment_replies');
  db.exec('DELETE FROM comments');
  db.exec('DELETE FROM blocks');
  db.exec('DELETE FROM permissions');
  db.exec('DELETE FROM documents');
  db.exec('DELETE FROM mock_config');
  db.exec('DELETE FROM audit_log');

  const seedPath = join(MOCK_DIR, 'seeds', 'default.sql');
  if (existsSync(seedPath)) {
    db.exec(readFileSync(seedPath, 'utf-8'));
  }
  recordAudit('reset', 'system', '', {});
}

function closeDb() {
  if (_db) { _db.close(); _db = null; }
}

// ── Config ──────────────────────────────────────────────
function getConfig(key) {
  const row = getDb().query('SELECT value FROM mock_config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function getMockUser() {
  return {
    userId: getConfig('mockUserId') || '0156023530111151377',
    userName: getConfig('mockUserName') || '张三',
    corpId: getConfig('mockCorpId') || 'dingf0a25d89eb4d7e6da39a90f97fcb1e03',
    corpName: getConfig('mockCorpName') || '测试企业'
  };
}

function getDefaultWorkspaceId() {
  return getConfig('defaultWorkspaceId') || 'Y7kmbeElo8lkqXLq';
}

function getDefaultFolderId() {
  return getConfig('defaultFolderId') || 'X6GRezwJlAgaoedehQQ6En2z8dqbropQ';
}

// ── Documents ───────────────────────────────────────────
function getDocument(nodeId) {
  return getDb().query('SELECT * FROM documents WHERE nodeId = ?').get(nodeId);
}

function listDocuments(workspaceId, folderId, pageSize) {
  const db = getDb();
  const limit = pageSize || 50;
  if (folderId) {
    return db.query('SELECT * FROM documents WHERE parentId = ? ORDER BY createTime LIMIT ?').all(folderId, limit);
  }
  if (workspaceId) {
    return db.query('SELECT * FROM documents WHERE workspaceId = ? ORDER BY createTime LIMIT ?').all(workspaceId, limit);
  }
  return db.query('SELECT * FROM documents ORDER BY createTime LIMIT ?').all(limit);
}

function searchDocuments(query, extensions, pageSize) {
  const db = getDb();
  const limit = pageSize || 30;
  let docs;
  if (query) {
    docs = db.query("SELECT * FROM documents WHERE name LIKE ? OR content LIKE ? ORDER BY lastEditTime DESC LIMIT ?")
      .all(`%${query}%`, `%${query}%`, limit);
  } else {
    docs = db.query('SELECT * FROM documents ORDER BY lastEditTime DESC LIMIT ?').all(limit);
  }
  if (extensions) {
    const exts = extensions.split(',').map(e => e.trim().toLowerCase());
    docs = docs.filter(d => exts.includes(d.extension || 'adoc'));
  }
  return docs;
}

function insertDocument(doc) {
  getDb().query(`INSERT INTO documents (nodeId, name, type, extension, createTime, lastEditTime, creatorUid, parentId, workspaceId, content)
    VALUES ($nodeId, $name, $type, $extension, $createTime, $lastEditTime, $creatorUid, $parentId, $workspaceId, $content)`)
    .run({
      $nodeId: doc.nodeId, $name: doc.name, $type: doc.type, $extension: doc.extension || 'adoc',
      $createTime: doc.createTime, $lastEditTime: doc.lastEditTime,
      $creatorUid: doc.creatorUid, $parentId: doc.parentId || null,
      $workspaceId: doc.workspaceId || null, $content: doc.content || ''
    });
  recordAudit('insert', 'document', doc.nodeId, { name: doc.name });
}

function updateDocumentContent(nodeId, content, lastEditTime) {
  getDb().query('UPDATE documents SET content = ?, lastEditTime = ? WHERE nodeId = ?')
    .run(content, lastEditTime, nodeId);
  recordAudit('update', 'document', nodeId, { field: 'content' });
}

function updateDocumentField(nodeId, field, value) {
  const allowed = ['name', 'parentId', 'workspaceId', 'lastEditTime'];
  if (!allowed.includes(field)) return;
  getDb().query(`UPDATE documents SET ${field} = ?, lastEditTime = ? WHERE nodeId = ?`)
    .run(value, Date.now(), nodeId);
  recordAudit('update', 'document', nodeId, { field, value });
}

function documentCount() {
  return getDb().query('SELECT COUNT(*) as c FROM documents').get().c;
}

// ── Blocks ──────────────────────────────────────────────
function getBlocks(nodeId, blockType, startIdx, endIdx) {
  const db = getDb();
  let rows;
  if (blockType) {
    rows = db.query('SELECT * FROM blocks WHERE nodeId = ? AND blockType = ? ORDER BY blockOrder')
      .all(nodeId, blockType);
  } else {
    rows = db.query('SELECT * FROM blocks WHERE nodeId = ? ORDER BY blockOrder').all(nodeId);
  }
  if (startIdx !== undefined || endIdx !== undefined) {
    const s = startIdx || 0;
    const e = endIdx !== undefined ? endIdx + 1 : rows.length;
    rows = rows.slice(s, e);
  }
  return rows.map(r => ({
    blockId: r.blockId,
    blockType: r.blockType,
    ...JSON.parse(r.contentJson),
    blockOrder: r.blockOrder
  }));
}

function insertBlock(nodeId, block, order) {
  const contentObj = {};
  if (block.heading) contentObj.heading = block.heading;
  if (block.paragraph) contentObj.paragraph = block.paragraph;
  Object.keys(block).forEach(k => {
    if (!['blockId', 'blockType', 'heading', 'paragraph', 'blockOrder'].includes(k)) {
      contentObj[k] = block[k];
    }
  });

  getDb().query(`INSERT INTO blocks (blockId, nodeId, blockType, contentJson, blockOrder)
    VALUES (?, ?, ?, ?, ?)`)
    .run(block.blockId, nodeId, block.blockType, JSON.stringify(contentObj), order);
  recordAudit('insert', 'block', block.blockId, { nodeId, blockType: block.blockType });
}

function updateBlock(blockId, block) {
  const contentObj = {};
  if (block.heading) contentObj.heading = block.heading;
  if (block.paragraph) contentObj.paragraph = block.paragraph;
  Object.keys(block).forEach(k => {
    if (!['blockId', 'blockType', 'heading', 'paragraph', 'blockOrder'].includes(k)) {
      contentObj[k] = block[k];
    }
  });

  getDb().query('UPDATE blocks SET blockType = ?, contentJson = ? WHERE blockId = ?')
    .run(block.blockType, JSON.stringify(contentObj), blockId);
  recordAudit('update', 'block', blockId, { blockType: block.blockType });
}

function deleteBlock(blockId) {
  getDb().query('DELETE FROM blocks WHERE blockId = ?').run(blockId);
  recordAudit('delete', 'block', blockId, {});
}

function deleteBlocksByNode(nodeId) {
  getDb().query('DELETE FROM blocks WHERE nodeId = ?').run(nodeId);
}

function getBlockCount(nodeId) {
  return getDb().query('SELECT COUNT(*) as c FROM blocks WHERE nodeId = ?').get(nodeId).c;
}

function getMaxBlockOrder(nodeId) {
  const row = getDb().query('SELECT MAX(blockOrder) as m FROM blocks WHERE nodeId = ?').get(nodeId);
  return row.m !== null ? row.m : -1;
}

function getBlockByIdAndNode(blockId, nodeId) {
  const row = getDb().query('SELECT * FROM blocks WHERE blockId = ? AND nodeId = ?').get(blockId, nodeId);
  if (!row) return null;
  return {
    blockId: row.blockId,
    blockType: row.blockType,
    ...JSON.parse(row.contentJson),
    blockOrder: row.blockOrder
  };
}

function shiftBlockOrders(nodeId, fromOrder, delta) {
  getDb().query('UPDATE blocks SET blockOrder = blockOrder + ? WHERE nodeId = ? AND blockOrder >= ?')
    .run(delta, nodeId, fromOrder);
}

function rebuildContentFromBlocks(nodeId) {
  const blocks = getBlocks(nodeId);
  const lines = blocks.map(b => {
    if (b.blockType === 'heading') {
      const h = b.heading || b;
      return '#'.repeat(h.level || 1) + ' ' + (h.text || '');
    }
    const p = b.paragraph || b;
    if (p.text != null) return p.text;
    return '';
  });
  const content = lines.join('\n');
  getDb().query('UPDATE documents SET content = ? WHERE nodeId = ?').run(content, nodeId);
  return content;
}

// ── Comments ────────────────────────────────────────────
function getComments(nodeId, type, resolveStatus, pageSize) {
  const db = getDb();
  let sql = 'SELECT * FROM comments WHERE nodeId = ?';
  const params = [nodeId];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (resolveStatus === 'resolved') { sql += ' AND resolved = 1'; }
  else if (resolveStatus === 'unresolved') { sql += ' AND resolved = 0'; }
  sql += ' ORDER BY createTime';
  if (pageSize) { sql += ' LIMIT ?'; params.push(pageSize); }
  return db.query(sql).all(...params);
}

function getCommentReplies(commentKey) {
  return getDb().query('SELECT * FROM comment_replies WHERE commentKey = ? ORDER BY createTime')
    .all(commentKey);
}

function insertComment(c) {
  getDb().query(`INSERT INTO comments (commentKey, nodeId, content, type, creatorUid, createTime, resolved, blockId, startOffset, endOffset, selectedText, mentionsJson)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(c.commentKey, c.nodeId, c.content, c.type || 'global', c.creatorUid, c.createTime,
         c.resolved ? 1 : 0, c.blockId || null, c.startOffset ?? null, c.endOffset ?? null,
         c.selectedText || null, JSON.stringify(c.mentions || []));
  recordAudit('insert', 'comment', c.commentKey, { nodeId: c.nodeId, type: c.type });
}

function insertReply(r) {
  getDb().query(`INSERT INTO comment_replies (replyKey, commentKey, content, emoji, creatorUid, createTime, mentionsJson)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(r.replyKey, r.commentKey, r.content, r.emoji ? 1 : 0, r.creatorUid, r.createTime,
         JSON.stringify(r.mentions || []));
  recordAudit('insert', 'reply', r.replyKey, { commentKey: r.commentKey });
}

function commentExists(commentKey) {
  return !!getDb().query('SELECT 1 FROM comments WHERE commentKey = ?').get(commentKey);
}

// ── Permissions ────────────────────────────────────────────
function addPermission(nodeId, userId, role) {
  const now = Date.now();
  getDb().query(`INSERT OR REPLACE INTO permissions (nodeId, userId, role, grantedAt) VALUES (?, ?, ?, ?)`)
    .run(nodeId, userId, role, now);
  recordAudit('insert', 'permission', `${nodeId}:${userId}`, { role });
}

function updatePermission(nodeId, userId, role) {
  const existing = getDb().query('SELECT 1 FROM permissions WHERE nodeId = ? AND userId = ?').get(nodeId, userId);
  if (!existing) return false;
  getDb().query('UPDATE permissions SET role = ?, grantedAt = ? WHERE nodeId = ? AND userId = ?')
    .run(role, Date.now(), nodeId, userId);
  recordAudit('update', 'permission', `${nodeId}:${userId}`, { role });
  return true;
}

function listPermissions(nodeId, filterRole, maxResults) {
  let sql = 'SELECT * FROM permissions WHERE nodeId = ?';
  const params = [nodeId];
  if (filterRole) { sql += ' AND role = ?'; params.push(filterRole); }
  sql += ' ORDER BY grantedAt DESC';
  if (maxResults) { sql += ' LIMIT ?'; params.push(maxResults); }
  return getDb().query(sql).all(...params);
}

// ── Exports ─────────────────────────────────────────────
function insertExport(nodeId, name, format) {
  const exportedAt = Date.now();
  getDb().query('INSERT INTO exports (node_id, name, format, exported_at) VALUES (?, ?, ?, ?)')
    .run(nodeId, name, format || 'docx', exportedAt);
  recordAudit('export', 'document', nodeId, { name, format: format || 'docx' });
}

function listExports() {
  return getDb().query('SELECT * FROM exports ORDER BY exported_at').all();
}

// ── Audit ───────────────────────────────────────────────
function recordAudit(operation, entityType, entityId, details) {
  getDb().query('INSERT INTO audit_log (timestamp, operation, entityType, entityId, detailsJson) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), operation, entityType || '', entityId || '', JSON.stringify(details || {}));
}

function getAuditLog(limit) {
  return getDb().query('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit || 500);
}

// ── Inject (for seed/bench) ─────────────────────────────
function injectData(data) {
  const db = getDb();
  if (data.documents) {
    for (const doc of data.documents) {
      db.query(`INSERT OR REPLACE INTO documents (nodeId, name, type, extension, createTime, lastEditTime, creatorUid, parentId, workspaceId, content)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(doc.nodeId, doc.name, doc.type, doc.extension || 'adoc',
             doc.createTime, doc.lastEditTime, doc.creatorUid,
             doc.parentId || null, doc.workspaceId || null, doc.content || '');
      if (doc.blocks) {
        for (let i = 0; i < doc.blocks.length; i++) {
          const b = doc.blocks[i];
          const contentObj = {};
          if (b.heading) contentObj.heading = b.heading;
          if (b.paragraph) contentObj.paragraph = b.paragraph;
          db.query('INSERT OR REPLACE INTO blocks (blockId, nodeId, blockType, contentJson, blockOrder) VALUES (?, ?, ?, ?, ?)')
            .run(b.blockId, doc.nodeId, b.blockType, JSON.stringify(contentObj), i);
        }
      }
      if (doc.comments) {
        for (const c of doc.comments) {
          db.query(`INSERT OR REPLACE INTO comments (commentKey, nodeId, content, type, creatorUid, createTime, resolved, blockId, startOffset, endOffset, selectedText, mentionsJson)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(c.commentKey, doc.nodeId, c.content, c.type || 'global', c.creatorUid, c.createTime,
                 c.resolved ? 1 : 0, c.blockId || null, c.start ?? null, c.end ?? null,
                 c.selectedText || null, JSON.stringify(c.mentions || []));
          if (c.replies) {
            for (const r of c.replies) {
              db.query('INSERT OR REPLACE INTO comment_replies (replyKey, commentKey, content, emoji, creatorUid, createTime, mentionsJson) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(r.replyKey, c.commentKey, r.content, r.emoji ? 1 : 0, r.creatorUid, r.createTime, JSON.stringify(r.mentions || []));
            }
          }
        }
      }
    }
  }
  recordAudit('inject', 'system', '', {});
}

function dumpFullState() {
  const d = getDb();
  const docs = d.query('SELECT * FROM documents ORDER BY createTime').all();
  const documentsMap = {};
  for (const doc of docs) {
    const blocks = d.query('SELECT * FROM blocks WHERE nodeId = ? ORDER BY blockOrder').all(doc.nodeId);
    const comments = d.query('SELECT * FROM comments WHERE nodeId = ? ORDER BY createTime').all(doc.nodeId);
    const commentsMap = {};
    for (const c of comments) {
      const replies = d.query('SELECT * FROM comment_replies WHERE commentKey = ? ORDER BY createTime').all(c.commentKey);
      commentsMap[c.commentKey] = {
        ...c,
        resolved: !!c.resolved,
        mentions: JSON.parse(c.mentionsJson || '[]'),
        replies: replies.map(r => ({ ...r, emoji: !!r.emoji, mentions: JSON.parse(r.mentionsJson || '[]') }))
      };
    }
    documentsMap[doc.nodeId] = {
      ...doc,
      blocks: blocks.map(b => ({ blockId: b.blockId, nodeId: b.nodeId, blockType: b.blockType, ...JSON.parse(b.contentJson || '{}'), blockOrder: b.blockOrder })),
      comments: commentsMap
    };
  }
  const allComments = d.query('SELECT c.*, d.name as documentName, d.parentId as documentParentId FROM comments c JOIN documents d ON c.nodeId = d.nodeId ORDER BY c.createTime').all();
  const commentsFlat = {};
  for (const c of allComments) {
    const replies = d.query('SELECT * FROM comment_replies WHERE commentKey = ? ORDER BY createTime').all(c.commentKey);
    commentsFlat[c.commentKey] = {
      ...c,
      resolved: !!c.resolved,
      mentions: JSON.parse(c.mentionsJson || '[]'),
      replies: replies.map(r => ({ ...r, emoji: !!r.emoji, mentions: JSON.parse(r.mentionsJson || '[]') }))
    };
  }

  const allBlocks = d.query('SELECT * FROM blocks ORDER BY nodeId, blockOrder').all();
  const blocksFlat = {};
  for (const b of allBlocks) {
    const parsed = JSON.parse(b.contentJson || '{}');
    const text = (parsed.paragraph && parsed.paragraph.text) || (parsed.heading && parsed.heading.text) || parsed.text || '';
    blocksFlat[b.blockId] = {
      blockId: b.blockId, nodeId: b.nodeId, blockType: b.blockType,
      blockOrder: b.blockOrder, text,
      _jsonml: parsed._jsonml || null
    };
  }

  const allPerms = d.query('SELECT * FROM permissions ORDER BY grantedAt').all();
  const permsFlat = {};
  for (const p of allPerms) {
    const key = `${p.nodeId}:${p.userId}`;
    permsFlat[key] = { nodeId: p.nodeId, userId: p.userId, role: p.role, grantedAt: p.grantedAt };
  }

  const allExports = d.query('SELECT * FROM exports ORDER BY exported_at').all();

  return {
    entities: {
      documents: documentsMap,
      blocks: blocksFlat,
      comments: commentsFlat,
      permissions: permsFlat
    },
    exports: allExports,
    config: {
      mockUser: getMockUser(),
      defaultWorkspaceId: getDefaultWorkspaceId(),
      defaultFolderId: getDefaultFolderId()
    }
  };
}

module.exports = {
  MOCK_HOME, DB_PATH,
  openDb, getDb, resetDb, closeDb,
  getConfig, getMockUser, getDefaultWorkspaceId, getDefaultFolderId,
  getDocument, listDocuments, searchDocuments, insertDocument, updateDocumentContent, updateDocumentField, documentCount,
  getBlocks, insertBlock, updateBlock, deleteBlock, deleteBlocksByNode, getBlockCount, getMaxBlockOrder, getBlockByIdAndNode, shiftBlockOrders, rebuildContentFromBlocks,
  getComments, getCommentReplies, insertComment, insertReply, commentExists,
  addPermission, updatePermission, listPermissions,
  insertExport, listExports,
  recordAudit, getAuditLog,
  injectData, dumpFullState
};
