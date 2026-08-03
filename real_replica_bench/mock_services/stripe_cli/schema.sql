-- schema.sql — Stripe CLI mock 状态层（bun:sqlite, WAL）
-- 对象采用通用存储：每行一个资源对象，完整 JSON 存在 data_json。
-- 这样新增资源 = 在 lib/resources.js 加配置，无需改表结构。

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS objects (
  id          TEXT PRIMARY KEY,        -- 如 cus_xxx / prod_xxx / price_xxx
  object      TEXT NOT NULL,           -- customer / product / price ...
  resource    TEXT NOT NULL,           -- 命令名 customers / products / prices ...
  created     INTEGER NOT NULL,        -- Unix 秒
  deleted     INTEGER NOT NULL DEFAULT 0,
  data_json   TEXT NOT NULL            -- 完整对象 JSON
);

CREATE INDEX IF NOT EXISTS idx_objects_resource ON objects(resource, created);

-- 配置（模拟 stripe login / config 写入的 key 等）
CREATE TABLE IF NOT EXISTS config (
  profile TEXT NOT NULL,
  key     TEXT NOT NULL,
  value   TEXT,
  PRIMARY KEY (profile, key)
);

-- 审计日志：记录每条改动状态的命令，供 stripe-bench audit 检视
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           INTEGER NOT NULL,
  resource     TEXT,
  operation    TEXT,
  object_id    TEXT,
  details_json TEXT
);
