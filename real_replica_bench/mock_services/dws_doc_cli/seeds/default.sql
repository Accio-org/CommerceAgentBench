-- Default seed data for DWS Doc CLI mock
-- Provides 5 nodes (2 folders + 3 documents), blocks, comments, and replies

-- Mock config
INSERT OR IGNORE INTO mock_config (key, value) VALUES
  ('defaultWorkspaceId', 'Y7kmbeElo8lkqXLq'),
  ('defaultFolderId',    'X6GRezwJlAgaoedehQQ6En2z8dqbropQ'),
  ('mockUserId',         '0156023530111151377'),
  ('mockUserName',       '张三'),
  ('mockCorpId',         'dingf0a25d89eb4d7e6da39a90f97fcb1e03'),
  ('mockCorpName',       '测试企业');

-- Documents / folders
INSERT OR IGNORE INTO documents (nodeId, name, type, extension, createTime, lastEditTime, creatorUid, parentId, workspaceId, content) VALUES
  ('Kx9mRzJWqPpvo939iQQ7vRAyJGXn6lpz', '我的文档',         'folder', 'folder', 1774347550000, 1774347550000, '0156023530111151377', NULL, 'Y7kmbeElo8lkqXLq', ''),
  ('gpG2NdyVX36w0mbmIGeb4WMwvDqPkR2D', '项目资料',         'folder', 'folder', 1774348000000, 1774348000000, '0156023530111151377', 'Kx9mRzJWqPpvo939iQQ7vRAyJGXn6lpz', 'Y7kmbeElo8lkqXLq', ''),
  ('NDoBb60VLQlwNDdDuB5y9D6QJlemrZQ3', '2025 Q2 项目周报', 'file',   'adoc',   1778208000000, 1779849600000, '0156023530111151377', 'gpG2NdyVX36w0mbmIGeb4WMwvDqPkR2D', 'Y7kmbeElo8lkqXLq',
   '# 2025 Q2 项目周报

## 本周进展

- 完成了用户认证模块重构
- 修复了 3 个线上 Bug
- 性能优化：接口响应时间降低 40%

## 下周计划

- 启动数据迁移方案设计
- 完成代码审查'),
  ('MyQA2dXW7elL6YPYfMMpXoO1JzlwrZgb', '产品评审会议纪要', 'file',   'adoc',   1779504000000, 1779504000000, '0267134641222262488', 'gpG2NdyVX36w0mbmIGeb4WMwvDqPkR2D', 'Y7kmbeElo8lkqXLq',
   '# 产品评审会议纪要

## 参会人

张三、李四、王五

## 讨论议题

1. Q2 产品路线图确认
2. 用户反馈处理流程优化
3. 新功能优先级排序

## 结论

优先处理核心体验问题，新功能延期到 Q3'),
  ('dxXB52LJqnX4ovLvfMoneyXo8qjMp697', 'API 设计规范',     'file',   'adoc',   1779590400000, 1780128000000, '0156023530111151377', NULL, 'Y7kmbeElo8lkqXLq',
   '# API 设计规范

## 命名规则

- RESTful 风格
- 资源名使用复数
- 动作使用 HTTP 方法

## 响应格式

所有 API 统一返回 JSON 格式');

-- Blocks for doc "2025 Q2 项目周报"
INSERT OR IGNORE INTO blocks (blockId, nodeId, blockType, contentJson, blockOrder) VALUES
  ('mpv0a1b2c3d4e5f6g7h', 'NDoBb60VLQlwNDdDuB5y9D6QJlemrZQ3', 'heading',   '{"text":"2025 Q2 项目周报","level":1}', 0),
  ('mpv0i9j8k7l6m5n4o3p', 'NDoBb60VLQlwNDdDuB5y9D6QJlemrZQ3', 'heading',   '{"text":"本周进展","level":2}',          1),
  ('mpv0q2r3s4t5u6v7w8x', 'NDoBb60VLQlwNDdDuB5y9D6QJlemrZQ3', 'paragraph', '{"text":"- 完成了用户认证模块重构"}',     2),
  ('mpv0y9z0a1b2c3d4e5f', 'NDoBb60VLQlwNDdDuB5y9D6QJlemrZQ3', 'paragraph', '{"text":"- 修复了 3 个线上 Bug"}',       3),
  ('mpv0g6h7i8j9k0l1m2n', 'NDoBb60VLQlwNDdDuB5y9D6QJlemrZQ3', 'paragraph', '{"text":"- 性能优化：接口响应时间降低 40%"}', 4),
  ('mpv0o3p4q5r6s7t8u9v', 'NDoBb60VLQlwNDdDuB5y9D6QJlemrZQ3', 'heading',   '{"text":"下周计划","level":2}',          5),
  ('mpv0w0x1y2z3a4b5c6d', 'NDoBb60VLQlwNDdDuB5y9D6QJlemrZQ3', 'paragraph', '{"text":"- 启动数据迁移方案设计"}',      6),
  ('mpv0e7f8g9h0i1j2k3l', 'NDoBb60VLQlwNDdDuB5y9D6QJlemrZQ3', 'paragraph', '{"text":"- 完成代码审查"}',              7);

-- Blocks for doc "产品评审会议纪要"
INSERT OR IGNORE INTO blocks (blockId, nodeId, blockType, contentJson, blockOrder) VALUES
  ('mpv0mn1o2p3q4r5s6t7', 'MyQA2dXW7elL6YPYfMMpXoO1JzlwrZgb', 'heading',   '{"text":"产品评审会议纪要","level":1}',   0),
  ('mpv0u8v9w0x1y2z3a4b', 'MyQA2dXW7elL6YPYfMMpXoO1JzlwrZgb', 'heading',   '{"text":"参会人","level":2}',             1),
  ('mpv0c5d6e7f8g9h0i1j', 'MyQA2dXW7elL6YPYfMMpXoO1JzlwrZgb', 'paragraph', '{"text":"张三、李四、王五"}',              2),
  ('mpv0k2l3m4n5o6p7q8r', 'MyQA2dXW7elL6YPYfMMpXoO1JzlwrZgb', 'heading',   '{"text":"讨论议题","level":2}',           3),
  ('mpv0s9t0u1v2w3x4y5z', 'MyQA2dXW7elL6YPYfMMpXoO1JzlwrZgb', 'paragraph', '{"text":"1. Q2 产品路线图确认"}',          4),
  ('mpv0a6b7c8d9e0f1g2h', 'MyQA2dXW7elL6YPYfMMpXoO1JzlwrZgb', 'paragraph', '{"text":"2. 用户反馈处理流程优化"}',       5),
  ('mpv0i3j4k5l6m7n8o9p', 'MyQA2dXW7elL6YPYfMMpXoO1JzlwrZgb', 'paragraph', '{"text":"3. 新功能优先级排序"}',           6),
  ('mpv0q0r1s2t3u4v5w6x', 'MyQA2dXW7elL6YPYfMMpXoO1JzlwrZgb', 'heading',   '{"text":"结论","level":2}',               7),
  ('mpv0y7z8a9b0c1d2e3f', 'MyQA2dXW7elL6YPYfMMpXoO1JzlwrZgb', 'paragraph', '{"text":"优先处理核心体验问题，新功能延期到 Q3"}', 8);

-- Blocks for doc "API 设计规范"
INSERT OR IGNORE INTO blocks (blockId, nodeId, blockType, contentJson, blockOrder) VALUES
  ('mpv0g4h5i6j7k8l9m0n', 'dxXB52LJqnX4ovLvfMoneyXo8qjMp697', 'heading',   '{"text":"API 设计规范","level":1}',     0),
  ('mpv0o1p2q3r4s5t6u7v', 'dxXB52LJqnX4ovLvfMoneyXo8qjMp697', 'heading',   '{"text":"命名规则","level":2}',          1),
  ('mpv0w8x9y0z1a2b3c4d', 'dxXB52LJqnX4ovLvfMoneyXo8qjMp697', 'paragraph', '{"text":"- RESTful 风格"}',              2),
  ('mpv0e5f6g7h8i9j0k1l', 'dxXB52LJqnX4ovLvfMoneyXo8qjMp697', 'paragraph', '{"text":"- 资源名使用复数"}',             3),
  ('mpv0m2n3o4p5q6r7s8t', 'dxXB52LJqnX4ovLvfMoneyXo8qjMp697', 'paragraph', '{"text":"- 动作使用 HTTP 方法"}',         4),
  ('mpv0u9v0w1x2y3z4a5b', 'dxXB52LJqnX4ovLvfMoneyXo8qjMp697', 'heading',   '{"text":"响应格式","level":2}',           5),
  ('mpv0c6d7e8f9g0h1i2j', 'dxXB52LJqnX4ovLvfMoneyXo8qjMp697', 'paragraph', '{"text":"所有 API 统一返回 JSON 格式"}', 6);

-- Comments on "2025 Q2 项目周报"
INSERT OR IGNORE INTO comments (commentKey, nodeId, content, type, creatorUid, createTime, resolved, blockId, startOffset, endOffset, selectedText, mentionsJson) VALUES
  ('1779849600000b75bfb4ecbf44ccc8738f3c02a26033c', 'NDoBb60VLQlwNDdDuB5y9D6QJlemrZQ3',
   '数据迁移方案需要考虑回滚策略', 'global', '0267134641222262488', 1779849600000, 0,
   NULL, NULL, NULL, NULL, '[]'),
  ('1779870000000adf44e0452884ed1b49c7b0e1aa26e57', 'NDoBb60VLQlwNDdDuB5y9D6QJlemrZQ3',
   '这个数据能否补充具体的 P95 延迟？', 'inline', '0378245752333373599', 1779870000000, 0,
   'mpv0g6h7i8j9k0l1m2n', 7, 18, '接口响应时间降低 40%', '["0156023530111151377"]');

-- Reply on the global comment
INSERT OR IGNORE INTO comment_replies (replyKey, commentKey, content, emoji, creatorUid, createTime, mentionsJson) VALUES
  ('1779936000000c541306e942b4341a2e5a4c785e74ebb', '1779849600000b75bfb4ecbf44ccc8738f3c02a26033c',
   '好的，我会加上回滚方案', 0, '0156023530111151377', 1779936000000, '[]');
