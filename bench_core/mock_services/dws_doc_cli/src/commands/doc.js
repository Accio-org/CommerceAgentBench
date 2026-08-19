'use strict';

const { parseCommandArgs } = require('../utils');
const db = require('../../lib/db');
const { requireAuth } = require('./auth');
const jsonml = require('../../lib/jsonml');

// ─── Global flags help (shared) ───────────────────────────
const GLOBAL_FLAGS = `
Global Flags:
      --client-id string       Override OAuth client ID (DingTalk AppKey)
      --client-secret string   Override OAuth client secret (DingTalk AppSecret)
      --debug                  显示调试日志
      --dry-run                预览操作内容，不实际执行
      --fields string          筛选输出字段 (逗号分隔, 如: name,id,status)
  -f, --format string          输出格式: json|table|raw|pretty|ndjson|csv (default "json")
      --jq string              jq 表达式过滤输出 (如: '.items[] | .name')
      --mock                   使用 Mock 数据 (开发调试用)
      --timeout int            HTTP 请求超时时间 (秒) (default 30)
  -v, --verbose                显示详细日志
  -y, --yes                    跳过确认提示 (AI Agent 模式)`;

function h(usage, flags) {
  return `${usage}\n\nFlags:\n${flags}\n${GLOBAL_FLAGS}`;
}

// ─── Help definitions (aligned with real dws v1.0.33 --help output) ──
const HELP = {
  'doc search': h('搜索文档\n\nUsage:\n  dws doc search [flags]', `      --created-from int        创建时间起点
      --created-to int          创建时间终点
      --creator-uids string     创建人 userId，逗号分隔
      --editor-uids string      编辑人 userId，逗号分隔
      --extensions string       扩展名，逗号分隔
  -h, --help                    help for search
      --mentioned-uids string   提及 userId，逗号分隔
      --page-size int           每页数量
      --page-token string       分页 token
      --query string            搜索关键词
      --visited-from int        访问时间起点
      --visited-to int          访问时间终点
      --workspace-ids string    Workspace ID，逗号分隔`),
  'doc list': h('列出文档节点\n\nUsage:\n  dws doc list [flags]', `      --folder string       父文件夹 nodeId / URL
  -h, --help                help for list
      --page-size int       每页数量
      --page-token string   分页 token
      --workspace string    Workspace ID`),
  'doc info': h('获取文档元信息\n\nUsage:\n  dws doc info [flags]', `  -h, --help          help for info
      --node string   文档 nodeId / URL`),
  'doc read': h('读取文档内容\n\nUsage:\n  dws doc read [flags]', `      --content-format string   输出格式: markdown / jsonml
  -h, --help                    help for read
      --node string             文档 nodeId / URL
      --output string           输出到本地文件路径（JSONML 场景透传）`),
  'doc create': h('创建文档\n\nUsage:\n  dws doc create [flags]', `      --content string          初始 Markdown 内容
      --content-file string     从文件读取初始 Markdown
      --content-format string   内容格式: markdown / jsonml
      --fix-jsonml              启用全部 JSONML 修复（含 JSON 语法修复 + 结构修复），推荐 agent 调用时使用
      --folder string           父文件夹 nodeId / URL
  -h, --help                    help for create
      --name string             文档名称 (必填)
      --no-fix-jsonml           关闭全部 JSONML 修复（跳过 JSON 语法修复和结构修复），用于排查原始错误
      --workspace string        Workspace ID`),
  'doc update': h('更新文档内容\n\nUsage:\n  dws doc update [flags]', `      --content string          Markdown 内容
      --content-file string     从文件读取 Markdown
      --content-format string   内容格式: markdown / jsonml
      --fix-jsonml              启用全部 JSONML 修复（含 JSON 语法修复 + 结构修复），推荐 agent 调用时使用
  -h, --help                    help for update
      --index int               append 插入位置
      --mode string             更新模式: append / overwrite
      --no-fix-jsonml           关闭全部 JSONML 修复（跳过 JSON 语法修复和结构修复），用于排查原始错误
      --node string             文档 nodeId / URL
      --revision int            文档编辑版本号（JSONML 场景透传）`),
  'doc upload': h('上传文件到钉钉文档或知识库\n\nUsage:\n  dws doc upload [flags]', `      --convert            是否转换为钉钉在线文档
      --file string        Local file path (required)
      --folder string      目标文档文件夹 nodeId 或 alidocs 文件夹 URL
  -h, --help               help for upload
      --name string        文件显示名称（默认使用本地文件名）
      --workspace string   目标知识库 ID 或 URL`),
  'doc download': h('获取文档下载地址\n\nUsage:\n  dws doc download [flags]', `  -h, --help            help for download
      --node string     文档 nodeId / URL
      --output string   本地输出路径 (必填)`),
  'doc copy': h('copy 文档节点\n\nUsage:\n  dws doc copy [flags]', `      --folder string      目标父文件夹 nodeId / URL
  -h, --help               help for copy
      --node string        文档 nodeId / URL
      --workspace string   Workspace ID`),
  'doc move': h('move 文档节点\n\nUsage:\n  dws doc move [flags]', `      --folder string      目标父文件夹 nodeId / URL
  -h, --help               help for move
      --node string        文档 nodeId / URL
      --workspace string   Workspace ID`),
  'doc rename': h('重命名文档节点\n\nUsage:\n  dws doc rename [flags]', `  -h, --help          help for rename
      --name string   新名称 (必填)
      --node string   文档 nodeId / URL`),
  'doc delete': h(`将文档或文件移入回收站（高风险、不可逆操作）。

权限要求：对目标节点有"管理"权限。
执行前需要确认（交互式输入 yes），或传入 --yes 跳过确认。

与 dws doc block delete 的区别：
  - dws doc delete       —— 删除整篇文档/文件（本命令）
  - dws doc block delete —— 删除文档内部的某个块

Usage:
  dws doc delete [flags]

Examples:
  dws doc delete --node DOC_ID --yes
  dws doc delete --node "https://alidocs.dingtalk.com/i/nodes/<UUID>" --yes
  dws doc delete --node DOC_ID    # 交互式确认后删除`, `  -h, --help          help for delete
      --node string   文档 nodeId / URL`),
  'doc folder create': h('创建文档文件夹\n\nUsage:\n  dws doc folder create [flags]', `      --folder string      父文件夹 nodeId / URL
  -h, --help               help for create
      --name string        文件夹名称 (必填)
      --workspace string   Workspace ID`),
  'doc file create': h('创建文档文件\n\nUsage:\n  dws doc file create [flags]', `      --folder string      父文件夹 nodeId / URL
  -h, --help               help for create
      --name string        文件名称 (必填)
      --type string        文件类型 (必填)
      --workspace string   Workspace ID`),
  'doc block list': h('列出文档块\n\nUsage:\n  dws doc block list [flags]', `      --block-id string         块 ID（JSONML 场景透传）
      --block-type string       块类型
      --content-format string   输出格式: element / jsonml
      --end-index int           结束块索引
  -h, --help                    help for list
      --node string             文档 nodeId / URL
      --start-index int         起始块索引`),
  'doc block insert': h('插入文档块\n\nUsage:\n  dws doc block insert [flags]', `      --columns int             分栏数量；配合 --type columns (default 2)
      --content-format string   输入格式: element / jsonml
      --element string          块 element JSON
      --fix-jsonml              启用全部 JSONML 修复（含 JSON 语法修复 + 结构修复），推荐 agent 调用时使用
      --heading string          标题文本快捷参数
  -h, --help                    help for insert
      --index int               插入索引
      --language string         代码块语言；配合 --type code/codeBlock
      --level int               标题级别 (default 1)
      --list-id string          列表 ID；orderedList/unorderedList 多项连续插入时使用同一个 ID
      --no-fix-jsonml           关闭全部 JSONML 修复（跳过 JSON 语法修复和结构修复），用于排查原始错误
      --node string             文档 nodeId / URL
      --parent-block string     父容器块 ID（JSONML 场景透传）
      --ref-block string        参考块 ID
      --text string             段落文本快捷参数
      --type string             块类型快捷参数: paragraph/blockquote/callout/code/orderedList/unorderedList/columns/divider
      --where string            插入位置`),
  'doc block update': h('更新文档块\n\nUsage:\n  dws doc block update [flags]', `      --block-id string         块 ID (必填)
      --columns int             分栏数量；配合 --type columns (default 2)
      --content-format string   输入格式: element / jsonml
      --element string          块 element JSON
      --fix-jsonml              启用全部 JSONML 修复（含 JSON 语法修复 + 结构修复），推荐 agent 调用时使用
      --heading string          标题文本快捷参数
  -h, --help                    help for update
      --language string         代码块语言；配合 --type code/codeBlock
      --level int               标题级别 (default 1)
      --list-id string          列表 ID；orderedList/unorderedList 多项连续插入时使用同一个 ID
      --no-fix-jsonml           关闭全部 JSONML 修复（跳过 JSON 语法修复和结构修复），用于排查原始错误
      --node string             文档 nodeId / URL
      --text string             段落文本快捷参数
      --type string             块类型快捷参数: paragraph/blockquote/callout/code/orderedList/unorderedList/columns/divider`),
  'doc block delete': h('删除文档块\n\nUsage:\n  dws doc block delete [flags]', `      --block-id string   块 ID (必填)
  -h, --help              help for delete
      --node string       文档 nodeId / URL`),
  'doc block move': h('移动文档块\n\nUsage:\n  dws doc block move [flags]', `      --block-id string   块 ID (必填)
  -h, --help              help for move
      --index int         目标索引
      --node string       文档 nodeId / URL
      --ref-block string  参考块 ID
      --where string      插入位置: before/after`),
  'doc comment list': h('列出文档评论\n\nUsage:\n  dws doc comment list [flags]', `  -h, --help                    help for list
      --next-token string       下一页 token
      --node string             文档 nodeId / URL
      --page-size int           每页数量
      --resolve-status string   解决状态
      --type string             评论类型`),
  'doc comment create': h('创建文档评论\n\nUsage:\n  dws doc comment create [flags]', `      --content string   评论内容 (必填)
  -h, --help             help for create
      --mention string   提及 userId，逗号分隔
      --node string      文档 nodeId / URL`),
  'doc comment create-inline': h('创建行内评论\n\nUsage:\n  dws doc comment create-inline [flags]', `      --block-id string        块 ID
      --content string         评论内容 (必填)
      --end int                结束位置
  -h, --help                   help for create-inline
      --mention string         提及 userId，逗号分隔
      --node string            文档 nodeId / URL
      --selected-text string   选中文本
      --start int              起始位置`),
  'doc comment reply': h('回复文档评论\n\nUsage:\n  dws doc comment reply [flags]', `      --comment-key string   评论 key
      --content string       回复内容 (必填)
      --emoji                是否作为表情贴图回复
  -h, --help                 help for reply
      --mention string       提及 userId，逗号分隔
      --node string          文档 nodeId / URL`),
  'doc permission add': h('节点级授权\n\nUsage:\n  dws doc permission add [flags]', `  -h, --help             help for add
      --node string       目标文档/文件夹的 ID 或 URL (必填)
      --role string       授予的角色: MANAGER / EDITOR / DOWNLOADER / READER (必填，必须全大写)
      --user strings      被授权的用户 userId 列表，逗号分隔 (必填，单次最多 30 个)`),
  'doc permission update': h('修改权限\n\nUsage:\n  dws doc permission update [flags]', `  -h, --help             help for update
      --node string       目标文档/文件夹的 ID 或 URL (必填)
      --role string       新角色: MANAGER / EDITOR / DOWNLOADER / READER (必填)
      --user strings      目标用户 userId 列表，逗号分隔 (必填)`),
  'doc permission list': h('列出权限\n\nUsage:\n  dws doc permission list [flags]', `      --filter-role string   按角色过滤: MANAGER / EDITOR / DOWNLOADER / READER
  -h, --help                 help for list
      --max-results int      返回数量上限 (默认 50)
      --node string          目标文档/文件夹的 ID 或 URL (必填)`),
  'doc export': h('在线文档导出为 docx\n\nUsage:\n  dws doc export [flags]', `  -h, --help                    help for export
      --export-format string   导出格式 (默认 docx)
      --node string            要导出的文档 ID 或 URL (必填)
      --output string          本地保存路径 (必填)`),
  'doc media insert': h('上传附件并插入文档\n\nUsage:\n  dws doc media insert [flags]', `      --file string        本地文件路径 (必填)
  -h, --help              help for insert
      --index int          插入位置索引
      --mime-type string   文件 MIME 类型
      --name string        附件显示名称
      --node string        目标文档 ID 或 URL (必填)
      --ref-block string   参考块 ID
      --where string       相对位置: before / after`),
  'doc media download': h('下载文档附件\n\nUsage:\n  dws doc media download [flags]', `  -h, --help                help for download
      --node string          目标文档 ID 或 URL (必填)
      --resource-id string   附件资源 ID (必填)`)
};

// ─── Group help texts (aligned with real dws --help output) ─────
const GROUP_HELP = {
  'doc': `钉钉文档（搜索 / 浏览 / 读写 / 上传下载 / 文件 / 文件夹 / 块级编辑 / 评论）

Usage:
  dws doc [flags]
  dws doc [command]

Available Commands:
  block       块级编辑
  comment     文档评论
  copy        copy 文档节点
  create      创建文档
  delete      删除整篇文档/文件到回收站
  download    获取文档下载地址
  export      文档导出（异步任务）
  file        文件管理
  folder      文件夹管理
  info        获取文档元信息
  list        列出文档节点
  media       文档媒体 / 附件管理
  move        move 文档节点
  permission  文档权限协作管理
  read        读取文档内容
  rename      重命名文档节点
  search      搜索文档
  update      更新文档内容
  upload      上传文件到钉钉文档或知识库

Flags:
  -h, --help   help for doc
${GLOBAL_FLAGS}

Use "dws doc [command] --help" for more information about a command.`,
  'doc block': `块级编辑

Usage:
  dws doc block [flags]
  dws doc block [command]

Available Commands:
  delete      删除文档块
  insert      插入文档块
  list        列出文档块
  update      更新文档块

Flags:
  -h, --help   help for block
${GLOBAL_FLAGS}

Use "dws doc block [command] --help" for more information about a command.`,
  'doc comment': `文档评论

Usage:
  dws doc comment [flags]
  dws doc comment [command]

Available Commands:
  create        创建文档评论
  create-inline 创建行内评论
  list          列出文档评论
  reply         回复文档评论

Flags:
  -h, --help   help for comment
${GLOBAL_FLAGS}

Use "dws doc comment [command] --help" for more information about a command.`,
  'doc permission': `文档权限协作管理

Usage:
  dws doc permission [flags]
  dws doc permission [command]

Available Commands:
  add         节点级授权
  list        列出权限
  update      修改权限

Flags:
  -h, --help   help for permission
${GLOBAL_FLAGS}

Use "dws doc permission [command] --help" for more information about a command.`,
  'doc media': `文档媒体 / 附件管理

Usage:
  dws doc media [flags]
  dws doc media [command]

Available Commands:
  download    下载文档附件
  insert      上传附件并插入文档

Flags:
  -h, --help   help for media
${GLOBAL_FLAGS}

Use "dws doc media [command] --help" for more information about a command.`,
  'doc file': `文件管理

Usage:
  dws doc file [flags]
  dws doc file [command]

Available Commands:
  create      创建文档文件

Flags:
  -h, --help   help for file
${GLOBAL_FLAGS}

Use "dws doc file [command] --help" for more information about a command.`,
  'doc folder': `文件夹管理

Usage:
  dws doc folder [flags]
  dws doc folder [command]

Available Commands:
  create      创建文档文件夹

Flags:
  -h, --help   help for folder
${GLOBAL_FLAGS}

Use "dws doc folder [command] --help" for more information about a command.`
};

function withAuth(handler) {
  return function (args, flags) {
    const authErr = requireAuth();
    if (authErr) return authErr;
    return handler(args, flags);
  };
}

function register(registerCommand) {
  registerCommand('doc', () => { console.log(GROUP_HELP['doc']); }, GROUP_HELP['doc'], null);
  registerCommand('doc block', () => { console.log(GROUP_HELP['doc block']); }, GROUP_HELP['doc block'], null);
  registerCommand('doc comment', () => { console.log(GROUP_HELP['doc comment']); }, GROUP_HELP['doc comment'], null);
  registerCommand('doc file', () => { console.log(GROUP_HELP['doc file']); }, GROUP_HELP['doc file'], null);
  registerCommand('doc folder', () => { console.log(GROUP_HELP['doc folder']); }, GROUP_HELP['doc folder'], null);
  registerCommand('doc search', withAuth(handleSearch), HELP['doc search'], 'search_documents');
  registerCommand('doc list', withAuth(handleList), HELP['doc list'], 'list_nodes');
  registerCommand('doc info', withAuth(handleInfo), HELP['doc info'], 'get_document_info');
  registerCommand('doc read', withAuth(handleRead), HELP['doc read'], 'read_document');
  registerCommand('doc create', withAuth(handleCreate), HELP['doc create'], 'create_document');
  registerCommand('doc update', withAuth(handleUpdate), HELP['doc update'], 'update_document');
  registerCommand('doc upload', withAuth(handleUpload), HELP['doc upload'], 'upload_file');
  registerCommand('doc download', withAuth(handleDownload), HELP['doc download'], 'download_file');
  registerCommand('doc copy', withAuth(handleCopy), HELP['doc copy'], 'copy_node');
  registerCommand('doc move', withAuth(handleMove), HELP['doc move'], 'move_node');
  registerCommand('doc rename', withAuth(handleRename), HELP['doc rename'], 'rename_node');
  registerCommand('doc delete', withAuth(handleDelete), HELP['doc delete'], 'delete_node');
  registerCommand('doc folder create', withAuth(handleFolderCreate), HELP['doc folder create'], 'create_folder');
  registerCommand('doc file create', withAuth(handleFileCreate), HELP['doc file create'], 'create_file_node');
  registerCommand('doc block list', withAuth(handleBlockList), HELP['doc block list'], 'list_blocks');
  registerCommand('doc block insert', withAuth(handleBlockInsert), HELP['doc block insert'], 'insert_block');
  registerCommand('doc block update', withAuth(handleBlockUpdate), HELP['doc block update'], 'update_block');
  registerCommand('doc block delete', withAuth(handleBlockDelete), HELP['doc block delete'], 'delete_block');
  registerCommand('doc comment list', withAuth(handleCommentList), HELP['doc comment list'], 'list_comments');
  registerCommand('doc comment create', withAuth(handleCommentCreate), HELP['doc comment create'], 'create_comment');
  registerCommand('doc comment create-inline', withAuth(handleCommentCreateInline), HELP['doc comment create-inline'], 'create_inline_comment');
  registerCommand('doc comment reply', withAuth(handleCommentReply), HELP['doc comment reply'], 'reply_comment');
  registerCommand('doc permission', () => { console.log(GROUP_HELP['doc permission']); }, GROUP_HELP['doc permission']);
  registerCommand('doc permission add', withAuth(handlePermissionAdd), HELP['doc permission add'], 'permission_add');
  registerCommand('doc permission update', withAuth(handlePermissionUpdate), HELP['doc permission update'], 'permission_update');
  registerCommand('doc permission list', withAuth(handlePermissionList), HELP['doc permission list'], 'permission_list');
  registerCommand('doc export', withAuth(handleExport), HELP['doc export'], 'export_document');
  registerCommand('doc media', () => { console.log(GROUP_HELP['doc media']); }, GROUP_HELP['doc media']);
  registerCommand('doc media insert', withAuth(handleMediaInsert), HELP['doc media insert'], 'media_insert');
  registerCommand('doc media download', withAuth(handleMediaDownload), HELP['doc media download'], 'media_download');
}

// ─── Helpers ───────────────────────────────────────────────

function genNodeId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function genBlockId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'mpv0';
  for (let i = 0; i < 15; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function genLogId() {
  const hex8 = Math.random().toString(16).slice(2, 10).padEnd(8, '0');
  const ts13 = Date.now().toString();
  const rand4 = Math.floor(1000 + Math.random() * 9000).toString();
  const hex3 = Math.random().toString(16).slice(2, 5);
  return `${hex8}${ts13}${rand4}e0${hex3}`;
}

function genPageToken() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'te';
  for (let i = 0; i < 78; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function genCommentSuffix() {
  const hexChars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 33; i++) result += hexChars[Math.floor(Math.random() * 16)];
  return result;
}

function validationError(flag) {
  return { error: { category: 'validation', code: 3, message: `--${flag} is required` } };
}

function apiError(message, opts) {
  return {
    error: {
      category: 'api', code: 1,
      hint: 'The API returned a business-level error. Check required parameters and values.',
      message, operation: 'tools/call', reason: 'business_error',
      server_error_code: (opts && opts.code) || 'invalidRequest.inputArgs.invalid',
      server_key: (opts && opts.server_key) || 'doc',
      trace_id: genLogId()
    }
  };
}

function resolveNodeId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const match = raw.match(/\/i\/nodes\/([^?#]+)/);
  if (match) return match[1];
  if (raw.includes('alidocs.dingtalk.com')) return raw;
  return raw;
}

const FILE_CREATE_TYPE_MAP = {
  adoc: 'ALIDOC', axls: 'WORKBOOK', appt: 'PRESENTATION',
  adraw: 'WHITEBOARD', amind: 'MINDMAP', able: 'MULTITABLE', aform: 'FORM'
};

function blockToMarkdown(block) {
  if (block.blockType === 'heading' && block.heading) {
    return '#'.repeat(block.heading.level || 1) + ' ' + (block.heading.text || '');
  }
  if (block.paragraph) return block.paragraph.text || '';
  if (block.blockType === 'blockquote' && block.blockquote) return '> ' + (block.blockquote.text || '');
  return block.text || '';
}

function parseMarkdownToBlocks(markdown) {
  const blocks = [];
  for (const line of markdown.split('\n')) {
    if (!line.trim()) continue;
    const hm = line.match(/^(#{1,6})\s+(.+)$/);
    if (hm) {
      blocks.push({ blockId: genBlockId(), blockType: 'heading', heading: { text: hm[2], level: hm[1].length } });
    } else {
      blocks.push({ blockId: genBlockId(), blockType: 'paragraph', paragraph: { text: line } });
    }
  }
  return blocks;
}

// ─── doc search ────────────────────────────────────────────

function handleSearch(args) {
  const params = parseCommandArgs(args);
  const pageSize = parseInt(params.limit || params['page-size']) || 10;
  let results = db.searchDocuments(params.query || params.keyword || '', params.extensions, pageSize + 1);

  if (params['created-from']) results = results.filter(d => d.createTime >= parseInt(params['created-from']));
  if (params['created-to']) results = results.filter(d => d.createTime <= parseInt(params['created-to']));
  if (params['creator-uids']) { const uids = params['creator-uids'].split(',').map(u => u.trim()); results = results.filter(d => uids.includes(d.creatorUid)); }
  if (params['workspace-ids']) { const ws = params['workspace-ids'].split(',').map(w => w.trim()); results = results.filter(d => ws.includes(d.workspaceId || '')); }

  const hasMore = results.length > pageSize;
  const paged = results.slice(0, pageSize);
  return {
    documents: paged.map(d => ({
      contentType: d.type === 'folder' ? 'OTHER' : 'ALIDOC',
      createTime: d.createTime, creatorUid: d.creatorUid,
      docUrl: `https://alidocs.dingtalk.com/i/nodes/${d.nodeId}?utm_scene=person_space`,
      extension: d.type === 'folder' ? 'folder' : (d.extension || 'adoc'),
      lastEditTime: null, name: d.name, nodeId: d.nodeId,
      nodeType: d.type === 'folder' ? 'folder' : 'file', updateTime: null
    })),
    hasMore, logId: genLogId(), nextPageToken: hasMore ? genPageToken() : null, success: true
  };
}

function handleList(args) {
  const params = parseCommandArgs(args);
  const pageSize = parseInt(params.limit || params['page-size']) || 50;
  const folder = params.folder || params.node || params['parent-id'] || null;
  const results = db.listDocuments(params.workspace || null, folder, pageSize);

  return {
    hasMore: false, logId: genLogId(),
    nodes: results.map(d => ({
      contentType: d.type === 'folder' ? null : 'ALIDOC',
      createTime: d.createTime,
      docUrl: `https://alidocs.dingtalk.com/i/nodes/${d.nodeId}?utm_scene=person_space`,
      extension: d.type === 'folder' ? null : (d.extension || 'adoc'),
      hasChildren: d.type === 'folder',
      name: d.name, nodeId: d.nodeId,
      nodeType: d.type === 'folder' ? 'folder' : 'file',
      updateTime: d.lastEditTime || d.createTime,
      workspaceId: d.workspaceId || db.getDefaultWorkspaceId()
    })),
    success: true
  };
}

function handleInfo(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  const doc = db.getDocument(nodeId);
  if (!doc) return apiError(`文档未找到: ${nodeId}`);

  const base = {
    contentType: doc.type === 'folder' ? null : 'ALIDOC',
    createTime: doc.createTime,
    docUrl: `https://alidocs.dingtalk.com/i/nodes/${doc.nodeId}`,
    extension: doc.type === 'folder' ? null : (doc.extension || 'adoc'),
    folderId: doc.parentId || db.getDefaultFolderId(),
    logId: genLogId(), name: doc.name, nodeId: doc.nodeId,
    nodeType: doc.type === 'folder' ? 'folder' : 'file',
    success: true, updateTime: doc.lastEditTime || doc.createTime,
    workspaceId: doc.workspaceId || db.getDefaultWorkspaceId()
  };
  return base;
}

function handleRead(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  const doc = db.getDocument(nodeId);
  if (!doc) return apiError(`文档未找到: ${nodeId}`);

  const contentFormat = params['content-format'] || 'markdown';

  if (contentFormat === 'jsonml') {
    const blocks = db.getBlocks(nodeId);
    const jsonmlBody = ['root', {}];
    for (const b of blocks) {
      jsonmlBody.push(JSON.parse(blockToJsonML(b)));
    }
    return { revision: doc.lastEditTime || Date.now(), jsonml: jsonmlBody, nodeId: doc.nodeId, success: true };
  }

  const blocks = db.getBlocks(nodeId);
  const markdown = blocks.length > 0 ? blocks.map(blockToMarkdown).join('\n') : (doc.content || '');

  return {
    docUrl: `https://alidocs.dingtalk.com/i/nodes/${doc.nodeId}`,
    logId: genLogId(), markdown, nodeId: doc.nodeId, success: true, title: doc.name
  };
}

function handleCreate(args) {
  const params = parseCommandArgs(args);
  if (!params.name) return validationError("name");

  const now = Date.now();
  const nodeId = genNodeId();
  const rawMd = params.content || params.markdown || resolveContentFile(params['content-file']) || '';
  const content = rawMd.replace(/\\n/g, '\n');

  db.insertDocument({
    nodeId, name: params.name, type: 'file', extension: 'adoc',
    createTime: now, lastEditTime: now,
    creatorUid: db.getMockUser().userId,
    parentId: params.folder || null, workspaceId: params.workspace || null,
    content
  });

  const blocks = parseMarkdownToBlocks(content);
  blocks.forEach((b, i) => db.insertBlock(nodeId, b, i));

  return {
    createTime: now, docUrl: `https://alidocs.dingtalk.com/i/nodes/${nodeId}`,
    folderId: params.folder || db.getDefaultFolderId(),
    logId: genLogId(), message: '文档创建成功，初始内容已写入。',
    name: params.name, nodeId, success: true
  };
}

function resolveContentFile(val) {
  if (!val || val === '-') return null;
  try { return require('fs').readFileSync(val, 'utf-8'); } catch { return null; }
}

function handleUpdate(args, flags) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");

  const doc = db.getDocument(nodeId);
  if (!doc) return apiError(`文档未找到: ${nodeId}`);

  const validModes = ['overwrite', 'append'];
  const mode = params.mode;
  if (!mode) return validationError("mode (必填: overwrite 或 append)");
  if (!validModes.includes(mode)) return apiError(`Invalid mode '${mode}'. Must be one of: ${validModes.join(', ')}`);

  const contentFormat = params['content-format'] || 'markdown';
  const now = Date.now();

  if (contentFormat === 'jsonml') {
    if (mode !== 'overwrite') return apiError('--content-format jsonml 当前仅支持 --mode overwrite');
    const raw = params.content || resolveContentFile(params['content-file']);
    if (!raw) return validationError("content or --content-file");
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) {
      if (params['fix-jsonml']) {
        try { parsed = JSON.parse(raw.replace(/,\s*([}\]])/g, '$1')); }
        catch { return apiError(`JSON 语法错误且自动修复失败: ${e.message}`); }
      } else {
        return apiError(`JSON 语法错误: ${e.message}`);
      }
    }
    let body = Array.isArray(parsed) ? parsed : (parsed && parsed.jsonml ? parsed.jsonml : null);
    if (!body) return apiError('JSONML 输入必须是数组或包含 "jsonml" 字段的对象');
    if (!params['no-fix-jsonml']) {
      const { fixed, notes } = jsonml.normalizeJsonMLBody(body);
      body = fixed;
      const { fixed: wrapped } = jsonml.ensureRootWrappedBody(body);
      body = wrapped;
    }
    const vr = jsonml.validateJsonMLBodyV2(body);
    if (vr.hasErrors()) return apiError(`JSONML 格式校验失败:\n${vr.summary()}`);

    db.deleteBlocksByNode(nodeId);
    const startIdx = (typeof body[0] === 'string' && body[0] === 'root') ? (typeof body[1] === 'object' && !Array.isArray(body[1]) ? 2 : 1) : 0;
    for (let i = startIdx; i < body.length; i++) {
      const node = body[i];
      if (!Array.isArray(node)) continue;
      const tag = node[0];
      const blockType = (tag && tag.startsWith('h') && tag.length === 2) ? 'heading' : (tag === 'code' ? 'codeBlock' : (tag || 'p'));
      const text = extractTextFromJsonML(node);
      const block = { blockId: genBlockId(), blockType, paragraph: { text }, _jsonml: JSON.stringify(node) };
      db.insertBlock(nodeId, block, i - startIdx);
    }
    db.updateDocumentContent(nodeId, db.rebuildContentFromBlocks(nodeId), now);
    return { logId: genLogId(), message: 'JSONML 内容已成功覆盖。', mode, nodeId, success: true };
  }

  // Markdown path
  let content = params.content || params.markdown || resolveContentFile(params['content-file']);
  if (content === '-') return apiError('stdin (--content -) 请改用 --content-file /dev/stdin 或 shell heredoc 管道');
  if (!content) return validationError("content");

  const markdown = content.replace(/\\n/g, '\n');

  if (mode === 'overwrite') {
    db.deleteBlocksByNode(nodeId);
    db.updateDocumentContent(nodeId, markdown, now);
    const newBlocks = parseMarkdownToBlocks(markdown);
    newBlocks.forEach((b, i) => db.insertBlock(nodeId, b, i));
  } else {
    const insertIdx = params.index !== undefined ? parseInt(params.index) : undefined;
    const newBlocks = parseMarkdownToBlocks(markdown);
    if (insertIdx !== undefined) {
      db.shiftBlockOrders(nodeId, insertIdx, newBlocks.length);
      newBlocks.forEach((b, i) => db.insertBlock(nodeId, b, insertIdx + i));
    } else {
      const startOrder = db.getMaxBlockOrder(nodeId) + 1;
      newBlocks.forEach((b, i) => db.insertBlock(nodeId, b, startOrder + i));
    }
    db.updateDocumentContent(nodeId, db.rebuildContentFromBlocks(nodeId), now);
  }

  return {
    logId: genLogId(),
    message: mode === 'append' ? '内容已成功追加到文档末尾，原有内容保持不变。' : '文档内容已成功覆盖，所有原有内容已替换为新内容。',
    mode, nodeId, success: true
  };
}

function handleUpload(args) {
  const params = parseCommandArgs(args);
  const nodeId = genNodeId();
  const now = Date.now();
  // 文件名/扩展名跟随 --name / --file（此前硬编码 uploaded_file.pdf，丢弃入参）
  const fileBase = String(params.file || '').split('/').pop() || '';
  const rawName = String(params.name || fileBase || 'uploaded_file');
  const dotIdx = rawName.lastIndexOf('.');
  const name = dotIdx > 0 ? rawName.slice(0, dotIdx) : rawName;
  const extension = dotIdx > 0 ? rawName.slice(dotIdx + 1).toLowerCase() : 'file';
  db.insertDocument({
    nodeId, name, type: 'file', extension,
    createTime: now, lastEditTime: now, creatorUid: db.getMockUser().userId,
    parentId: params.folder || null, workspaceId: params.workspace || null, content: ''
  });
  return {
    createTime: now, docUrl: `https://alidocs.dingtalk.com/i/nodes/${nodeId}?utm_scene=person_space`,
    folderId: params.folder || db.getDefaultFolderId(),
    logId: genLogId(), message: 'File uploaded successfully.', name, nodeId, success: true
  };
}

function handleDownload(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  return {
    downloadUrl: `https://alidocs.dingtalk.com/download/${nodeId}`,
    logId: genLogId(), message: `文件下载链接已生成。nodeId: ${nodeId}`, nodeId, success: true
  };
}

function handleCopy(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  const doc = db.getDocument(nodeId);
  if (!doc) return apiError(`文档未找到: ${nodeId}`);

  const newNodeId = genNodeId();
  const now = Date.now();
  const targetFolderId = params.folder || params.workspace || doc.parentId || db.getDefaultFolderId();

  db.insertDocument({
    nodeId: newNodeId, name: doc.name, type: doc.type, extension: doc.extension,
    createTime: now, lastEditTime: now, creatorUid: doc.creatorUid,
    parentId: targetFolderId, workspaceId: params.workspace || doc.workspaceId,
    content: doc.content
  });
  const blocks = db.getBlocks(nodeId);
  blocks.forEach((b, i) => db.insertBlock(newNodeId, { ...b, blockId: genBlockId() }, i));

  return {
    docUrl: `https://alidocs.dingtalk.com/i/nodes/${newNodeId}`,
    message: `节点复制成功，已复制到目标文件夹。sourceNodeId: ${nodeId}，targetFolderId: ${targetFolderId}，新节点 ID: ${newNodeId}`,
    nodeId: newNodeId, success: true
  };
}

function handleMove(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  const doc = db.getDocument(nodeId);
  if (!doc) return apiError(`文档未找到: ${nodeId}`);

  const targetFolderId = params.folder || params.workspace || doc.parentId || db.getDefaultFolderId();
  db.updateDocumentField(nodeId, 'parentId', targetFolderId);
  if (params.workspace) db.updateDocumentField(nodeId, 'workspaceId', params.workspace);

  return {
    docUrl: `https://alidocs.dingtalk.com/i/nodes/${nodeId}`,
    message: `节点移动成功，已移动到目标文件夹。nodeId: ${nodeId}，targetFolderId: ${targetFolderId}`,
    nodeId, success: true
  };
}

function handleRename(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!params.name) return validationError("name");
  const doc = db.getDocument(nodeId);
  if (!doc) return apiError(`文档未找到: ${nodeId}`);

  db.updateDocumentField(nodeId, 'name', params.name);
  return {
    docUrl: `https://alidocs.dingtalk.com/i/nodes/${nodeId}`,
    message: `节点重命名成功，新名称为：${params.name}。nodeId: ${nodeId}`,
    newName: params.name, nodeId, success: true
  };
}

function handleDelete(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");

  const doc = db.getDocument(nodeId);
  if (!doc) return apiError(`Document not found: ${nodeId}`);

  db.getDb().query('DELETE FROM documents WHERE nodeId = ?').run(nodeId);
  db.recordAudit('delete', 'document', nodeId, { name: doc.name });

  return {
    logId: genLogId(),
    message: `文档已删除（移入回收站）。nodeId: ${nodeId}`,
    nodeId, success: true
  };
}

function handleFolderCreate(args) {
  const params = parseCommandArgs(args);
  if (!params.name) return validationError("name");

  const now = Date.now();
  const nodeId = genNodeId();
  const folderId = params.folder || db.getDefaultFolderId();

  db.insertDocument({
    nodeId, name: params.name, type: 'folder', extension: 'folder',
    createTime: now, lastEditTime: now, creatorUid: db.getMockUser().userId,
    parentId: folderId, workspaceId: params.workspace || null, content: ''
  });
  return {
    createTime: now, docUrl: `https://alidocs.dingtalk.com/i/nodes/${nodeId}?utm_scene=person_space`,
    folderId, logId: genLogId(), message: 'Folder created successfully.',
    name: params.name, nodeId, success: true
  };
}

function handleFileCreate(args) {
  const params = parseCommandArgs(args);
  if (!params.name) return validationError("name");
  if (!params.type) return validationError("type");

  const validTypes = ['adoc', 'axls', 'appt', 'adraw', 'amind', 'able', 'folder'];
  if (!validTypes.includes(params.type)) return apiError(`Invalid type '${params.type}'. Must be one of: ${validTypes.join(', ')}`);

  const now = Date.now();
  const nodeId = genNodeId();
  const folderId = params.folder || db.getDefaultFolderId();
  const ext = params.type;
  const ct = FILE_CREATE_TYPE_MAP[ext] || 'ALIDOC';

  db.insertDocument({
    nodeId, name: params.name, type: ext === 'folder' ? 'folder' : 'file', extension: ext,
    createTime: now, lastEditTime: now, creatorUid: db.getMockUser().userId,
    parentId: folderId, workspaceId: params.workspace || null, content: ''
  });

  const typeMessages = { adoc: 'Document', axls: 'DingTalk Sheet', appt: 'Presentation', adraw: 'Whiteboard', amind: 'Mind Map', able: 'Multi Table', folder: 'Folder' };
  return {
    contentType: ct, createTime: now, docUrl: `https://alidocs.dingtalk.com/i/nodes/${nodeId}?utm_scene=person_space`,
    extension: ext, folderId, logId: genLogId(), message: `${typeMessages[ext] || 'File'} created successfully.`,
    name: params.name, nodeId, nodeType: ext === 'folder' ? 'folder' : 'file', success: true
  };
}

// ─── Block handlers ───────────────────────────────────────

function handleBlockList(args, flags) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const startIdx = parseInt(params['start-index']) || 0;
  const endIdx = params['end-index'] !== undefined ? parseInt(params['end-index']) : undefined;
  const contentFormat = params['content-format'] || 'element';
  const blocks = db.getBlocks(nodeId, params['block-type'] || null, startIdx, endIdx);
  const totalCount = db.getBlockCount(nodeId);

  if (contentFormat === 'jsonml') {
    return {
      blocks: blocks.map((b, i) => {
        const idx = startIdx + i;
        const jsonmlStr = b._jsonml || blockToJsonML(b);
        return { blockId: b.blockId, blockType: b.blockType, index: idx, jsonml: jsonmlStr };
      }),
      hasMore: false, logId: genLogId(), success: true, totalCount
    };
  }

  const verbose = (flags && flags.verbose) || params.verbose;
  return {
    blocks: blocks.map((b, i) => {
      const idx = startIdx + i;
      const element = { blockType: b.blockType, id: b.blockId, index: idx };
      if (b.paragraph) element.paragraph = b.paragraph;
      if (b.heading) element.heading = b.heading;
      if (b.codeBlock) element.codeBlock = b.codeBlock;
      if (b.blockquote) element.blockquote = b.blockquote;
      if (b.callout) element.callout = b.callout;
      if (b.orderedList) element.orderedList = b.orderedList;
      if (b.unorderedList) element.unorderedList = b.unorderedList;
      const entry = { blockType: b.blockType, element, index: idx };
      if (verbose) {
        if (b.blockType === 'heading') {
          const h = b.heading || b;
          entry.text = h.text || '';
          entry.level = h.level || 1;
        } else {
          const p = b.paragraph || b;
          entry.text = p.text != null ? p.text : (b.text != null ? b.text : '');
        }
      }
      return entry;
    }),
    hasMore: false, logId: genLogId(), success: true, totalCount
  };
}

function buildElementFromShorthand(params) {
  if (params.element) return null;
  const type = params.type;
  if (type === 'heading' || params.heading) {
    const text = params.heading || params.text || '';
    const level = parseInt(params.level) || 1;
    return { blockType: 'heading', heading: { text, level } };
  }
  if (type === 'paragraph' || params.text) {
    return { blockType: 'paragraph', paragraph: { text: params.text || '' } };
  }
  if (type === 'code' || type === 'codeBlock') {
    return { blockType: 'codeBlock', codeBlock: { text: params.text || '', language: params.language || '' } };
  }
  if (type === 'blockquote') {
    return { blockType: 'blockquote', blockquote: { text: params.text || '' } };
  }
  if (type === 'callout') {
    return { blockType: 'callout', callout: { text: params.text || '' } };
  }
  if (type === 'divider') {
    return { blockType: 'divider' };
  }
  if (type === 'orderedList' || type === 'unorderedList') {
    return { blockType: type, [type]: { text: params.text || '', listId: params['list-id'] || genBlockId() } };
  }
  return null;
}

function handleBlockInsert(args, flags) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const contentFormat = params['content-format'] || 'element';
  let newBlock;
  let jsonmlData = null;

  if (contentFormat === 'jsonml') {
    if (!params.element) return validationError("element (JSONML array required with --content-format jsonml)");
    let parsed;
    try { parsed = JSON.parse(params.element); } catch (e) {
      const fixMode = params['fix-jsonml'] || (flags && flags.fixJsonml);
      if (fixMode) {
        try { parsed = JSON.parse(params.element.replace(/,\s*([}\]])/g, '$1')); }
        catch { return apiError(`JSON 语法错误且自动修复失败: ${e.message}`); }
      } else {
        return apiError(`JSON 语法错误: ${e.message}。如果输入来自 LLM 生成，可通过 --fix-jsonml 尝试自动修复`);
      }
    }
    if (!Array.isArray(parsed)) return apiError('--content-format jsonml 要求 --element 为 JSON 数组');
    const noFix = params['no-fix-jsonml'];
    if (!noFix) {
      const { fixed, notes } = jsonml.normalizeJsonMLNode(parsed);
      parsed = fixed;
      if (notes.length > 0 && flags && flags.verbose) {
        process.stderr.write(`[FIX] JSONML 自动修复（${notes.length} 项）:\n${notes.map((n, i) => `  ${i + 1}. ${n}`).join('\n')}\n`);
      }
    }
    const vr = jsonml.validateJsonMLNodeV2(parsed);
    if (vr.hasErrors()) return apiError(`JSONML 格式校验失败:\n${vr.summary()}`);
    jsonmlData = JSON.stringify(parsed);
    const tag = parsed[0] || 'p';
    const blockType = tag.startsWith('h') && tag.length === 2 ? 'heading' : (tag === 'code' ? 'codeBlock' : tag);
    const text = extractTextFromJsonML(parsed);
    newBlock = { blockId: genBlockId(), blockType, paragraph: { text }, _jsonml: jsonmlData };
  } else {
    const shorthand = buildElementFromShorthand(params);
    if (!params.element && !shorthand) return validationError("element or --type/--text");
    if (shorthand) {
      newBlock = shorthand;
      newBlock.blockId = genBlockId();
    } else {
      try { newBlock = JSON.parse(params.element); newBlock.blockId = genBlockId(); }
      catch { return apiError('Invalid element JSON'); }
    }
  }

  const validWhere = ['before', 'after'];
  if (params.where && !validWhere.includes(params.where)) return apiError(`Invalid where '${params.where}'. Must be one of: ${validWhere.join(', ')}`);

  let insertOrder = db.getMaxBlockOrder(nodeId) + 1;
  if (params['ref-block']) {
    const ref = db.getBlockByIdAndNode(params['ref-block'], nodeId);
    if (!ref) return apiError(`块未找到: ${params['ref-block']}`);
    insertOrder = params.where === 'before' ? ref.blockOrder : ref.blockOrder + 1;
    db.shiftBlockOrders(nodeId, insertOrder, 1);
  } else if (params['parent-block']) {
    const parent = db.getBlockByIdAndNode(params['parent-block'], nodeId);
    if (!parent) return apiError(`父容器块未找到: ${params['parent-block']}`);
    insertOrder = parent.blockOrder + 1 + (parseInt(params.index) || 0);
    db.shiftBlockOrders(nodeId, insertOrder, 1);
  } else if (params.index !== undefined) {
    insertOrder = parseInt(params.index);
    db.shiftBlockOrders(nodeId, insertOrder, 1);
  }

  db.insertBlock(nodeId, newBlock, insertOrder);
  const now = Date.now();
  db.updateDocumentContent(nodeId, db.rebuildContentFromBlocks(nodeId), now);

  return { blockType: newBlock.blockType, index: insertOrder, logId: genLogId(), message: 'Block inserted successfully.', success: true };
}

function blockToJsonML(b) {
  if (b._jsonml) return b._jsonml;
  const text = (b.paragraph && b.paragraph.text) || (b.heading && b.heading.text) || b.text || '';
  const textNode = ['span', { 'data-type': 'text' }, ['span', { 'data-type': 'leaf' }, text]];
  if (b.blockType === 'heading') {
    const level = (b.heading && b.heading.level) || b.level || 1;
    const tag = `h${level}`;
    return JSON.stringify([tag, { uuid: b.blockId }, textNode]);
  }
  return JSON.stringify(['p', { uuid: b.blockId }, textNode]);
}

function extractTextFromJsonML(node) {
  if (typeof node === 'string') return node;
  if (!Array.isArray(node)) return '';
  const tag = node[0];
  if (tag === 'code' && node.length > 1) {
    const attrs = typeof node[1] === 'object' && !Array.isArray(node[1]) ? node[1] : {};
    return attrs.code || '';
  }
  let text = '';
  const start = (node.length > 1 && typeof node[1] === 'object' && !Array.isArray(node[1])) ? 2 : 1;
  for (let i = start; i < node.length; i++) {
    if (typeof node[i] === 'string') text += node[i];
    else if (Array.isArray(node[i])) text += extractTextFromJsonML(node[i]);
  }
  return text;
}

function handleBlockUpdate(args, flags) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!params['block-id']) return validationError("block-id");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const existing = db.getBlockByIdAndNode(params['block-id'], nodeId);
  if (!existing) return apiError(`块未找到: ${params['block-id']}`);

  const contentFormat = params['content-format'] || 'element';
  let parsed;

  if (contentFormat === 'jsonml') {
    if (!params.element) return validationError("element (JSONML array required with --content-format jsonml)");
    try { parsed = JSON.parse(params.element); } catch (e) {
      if (params['fix-jsonml']) {
        try { parsed = JSON.parse(params.element.replace(/,\s*([}\]])/g, '$1')); }
        catch { return apiError(`JSON 语法错误且自动修复失败: ${e.message}`); }
      } else {
        return apiError(`JSON 语法错误: ${e.message}`);
      }
    }
    if (!Array.isArray(parsed)) return apiError('--content-format jsonml 要求 --element 为 JSON 数组');
    if (!params['no-fix-jsonml']) {
      const { fixed, notes } = jsonml.normalizeJsonMLNode(parsed);
      parsed = fixed;
      if (notes.length > 0 && flags && flags.verbose) {
        process.stderr.write(`[FIX] JSONML 自动修复（${notes.length} 项）:\n${notes.map((n, i) => `  ${i + 1}. ${n}`).join('\n')}\n`);
      }
    }
    const vr = jsonml.validateJsonMLNodeV2(parsed);
    if (vr.hasErrors()) return apiError(`JSONML 格式校验失败:\n${vr.summary()}`);
    const tag = parsed[0] || 'p';
    const blockType = tag.startsWith('h') && tag.length === 2 ? 'heading' : (tag === 'code' ? 'codeBlock' : tag);
    const text = extractTextFromJsonML(parsed);
    parsed = { blockId: params['block-id'], blockType, paragraph: { text }, _jsonml: JSON.stringify(parsed) };
  } else {
    const shorthand = buildElementFromShorthand(params);
    if (!params.element && !shorthand) return validationError("element or --type/--text");
    if (shorthand) {
      parsed = shorthand;
    } else {
      try { parsed = JSON.parse(params.element); } catch { return apiError('Invalid element JSON'); }
    }
    parsed.blockId = params['block-id'];
  }

  db.updateBlock(params['block-id'], parsed);
  const now = Date.now();
  db.updateDocumentContent(nodeId, db.rebuildContentFromBlocks(nodeId), now);

  return { blockId: params['block-id'], logId: genLogId(), message: 'Block updated successfully.', success: true };
}

function handleBlockDelete(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!params['block-id']) return validationError("block-id");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const existing = db.getBlockByIdAndNode(params['block-id'], nodeId);
  if (!existing) return apiError(`块未找到: ${params['block-id']}`);

  db.deleteBlock(params['block-id']);
  const now = Date.now();
  db.updateDocumentContent(nodeId, db.rebuildContentFromBlocks(nodeId), now);

  return { blockId: params['block-id'], logId: genLogId(), message: 'Block deleted successfully.', success: true };
}

function handleBlockMove(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!params['block-id']) return validationError("block-id");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const existing = db.getBlockByIdAndNode(params['block-id'], nodeId);
  if (!existing) return apiError(`块未找到: ${params['block-id']}`);

  const validWhere = ['before', 'after'];
  if (params.where && !validWhere.includes(params.where)) return apiError(`Invalid where '${params.where}'. Must be one of: ${validWhere.join(', ')}`);

  let targetOrder;
  if (params['ref-block']) {
    const ref = db.getBlockByIdAndNode(params['ref-block'], nodeId);
    if (!ref) return apiError(`目标块未找到: ${params['ref-block']}`);
    targetOrder = params.where === 'before' ? ref.blockOrder : ref.blockOrder + 1;
  } else if (params.index !== undefined) {
    targetOrder = parseInt(params.index);
  } else {
    return validationError("ref-block or --index");
  }

  const oldOrder = existing.blockOrder;
  db.deleteBlock(params['block-id']);
  if (targetOrder > oldOrder) targetOrder--;
  db.shiftBlockOrders(nodeId, targetOrder, 1);
  db.insertBlock(nodeId, existing, targetOrder);

  const now = Date.now();
  db.updateDocumentContent(nodeId, db.rebuildContentFromBlocks(nodeId), now);

  return { blockId: params['block-id'], from: oldOrder, to: targetOrder, logId: genLogId(), message: 'Block moved successfully.', success: true };
}

// ─── Comment handlers ─────────────────────────────────────

function handleCommentList(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const validCommentTypes = ['global', 'inline'];
  if (params.type && !validCommentTypes.includes(params.type)) return apiError(`Invalid type '${params.type}'. Must be one of: ${validCommentTypes.join(', ')}`);
  const validResolveStatuses = ['resolved', 'unresolved'];
  if (params['resolve-status'] && !validResolveStatuses.includes(params['resolve-status'])) return apiError(`Invalid resolve-status '${params['resolve-status']}'. Must be one of: ${validResolveStatuses.join(', ')}`);

  const pageSize = parseInt(params.limit || params['page-size']) || 50;
  const comments = db.getComments(nodeId, params.type || null, params['resolve-status'] || null, pageSize + 1);
  const hasMore = comments.length > pageSize;
  const paged = comments.slice(0, pageSize);

  return {
    commentList: paged.map(c => ({
      commentKey: c.commentKey, content: c.content, createTime: c.createTime,
      isGlobal: c.type !== 'inline', isSolved: !!c.resolved,
      quote: c.selectedText || null, updateTime: c.createTime
    })),
    hasMore, logId: genLogId(), success: true
  };
}

function handleCommentCreate(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!params.content) return validationError("content");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const now = Date.now();
  const commentKey = `${now}${genCommentSuffix()}`;
  db.insertComment({
    commentKey, nodeId, content: params.content, type: 'global',
    creatorUid: db.getMockUser().userId, createTime: now,
    mentions: params.mention ? params.mention.split(',') : []
  });
  return { commentKey, logId: genLogId(), message: `评论创建成功。commentKey: ${commentKey}`, success: true };
}

function handleCommentCreateInline(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!params['block-id']) return validationError("block-id");
  if (!params.content) return validationError("content");
  if (params.start === undefined) return validationError("start");
  if (params.end === undefined) return validationError("end");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const block = db.getBlockByIdAndNode(params['block-id'], nodeId);
  if (!block) return apiError(`块未找到: ${params['block-id']}`);

  const now = Date.now();
  const commentKey = `${now}${genCommentSuffix()}`;
  db.insertComment({
    commentKey, nodeId, content: params.content, type: 'inline',
    blockId: params['block-id'], startOffset: parseInt(params.start), endOffset: parseInt(params.end),
    selectedText: params['selected-text'] || null,
    creatorUid: db.getMockUser().userId, createTime: now,
    mentions: params.mention ? params.mention.split(',') : []
  });
  return { commentKey, logId: genLogId(), message: `划词评论创建成功。commentKey: ${commentKey}`, success: true };
}

function handleCommentReply(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!params['comment-key']) return validationError("comment-key");
  if (!params.content) return validationError("content");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);
  if (!db.commentExists(params['comment-key'])) return apiError(`Comment ${params['comment-key']} not found`);

  const now = Date.now();
  const replyKey = `${now}${genCommentSuffix()}`;
  db.insertReply({
    replyKey, commentKey: params['comment-key'], content: params.content,
    emoji: !!params.emoji, creatorUid: db.getMockUser().userId, createTime: now,
    mentions: params.mention ? params.mention.split(',') : []
  });
  return { commentKey: replyKey, logId: genLogId(), message: `回复评论成功。commentKey: ${replyKey}`, success: true };
}

// ─── Permission handlers ──────────────────────────────────

const VALID_ROLES = ['MANAGER', 'EDITOR', 'DOWNLOADER', 'READER'];

function handlePermissionAdd(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!params.user) return validationError("user");
  if (!params.role) return validationError("role");
  if (!VALID_ROLES.includes(params.role)) return apiError(`Invalid role '${params.role}'. Must be one of: ${VALID_ROLES.join(', ')} (大小写敏感，必须全大写)`);
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const users = params.user.split(',').map(u => u.trim()).filter(Boolean);
  if (users.length > 30) return apiError('单次最多授权 30 个用户');
  for (const uid of users) db.addPermission(nodeId, uid, params.role);
  return { logId: genLogId(), message: `已为 ${users.length} 位用户添加 ${params.role} 权限`, success: true, added: users.length };
}

function handlePermissionUpdate(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!params.user) return validationError("user");
  if (!params.role) return validationError("role");
  if (!VALID_ROLES.includes(params.role)) return apiError(`Invalid role '${params.role}'. Must be one of: ${VALID_ROLES.join(', ')}`);
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const users = params.user.split(',').map(u => u.trim()).filter(Boolean);
  let updated = 0;
  for (const uid of users) { if (db.updatePermission(nodeId, uid, params.role)) updated++; }
  return { logId: genLogId(), message: `已更新 ${updated} 位用户权限为 ${params.role}`, success: true, updated };
}

function handlePermissionList(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const maxResults = parseInt(params['max-results']) || 50;
  const filterRole = params['filter-role'] || null;
  if (filterRole && !VALID_ROLES.includes(filterRole)) return apiError(`Invalid filter-role '${filterRole}'`);

  const perms = db.listPermissions(nodeId, filterRole, maxResults);
  return {
    permissions: perms.map(p => ({ userId: p.userId, role: p.role, grantedAt: p.grantedAt })),
    logId: genLogId(), success: true, total: perms.length
  };
}

// ─── Export handler ───────────────────────────────────────

function handleExport(args, flags) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  const output = params.output || (flags && flags.output);
  if (!output) return validationError("output");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const doc = db.getDocument(nodeId);
  const format = params['export-format'] || 'docx';
  const localPath = output.endsWith('/') ? `${output}${doc.name}.${format}` : output;

  db.insertExport(nodeId, doc.name, format);

  return { localPath, logId: genLogId(), message: '导出成功', nodeId, success: true };
}

// ─── Media handlers ──────────────────────────────────────

function handleMediaInsert(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!params.file) return validationError("file");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  const resourceId = genNodeId();
  const name = params.name || require('path').basename(params.file);
  const block = {
    blockId: genBlockId(), blockType: 'attachment',
    attachment: { resourceId, name, type: params['mime-type'] || 'application/octet-stream' }
  };

  let insertOrder = db.getMaxBlockOrder(nodeId) + 1;
  if (params['ref-block']) {
    const ref = db.getBlockByIdAndNode(params['ref-block'], nodeId);
    if (ref) {
      insertOrder = params.where === 'before' ? ref.blockOrder : ref.blockOrder + 1;
      db.shiftBlockOrders(nodeId, insertOrder, 1);
    }
  } else if (params.index !== undefined) {
    insertOrder = parseInt(params.index);
    db.shiftBlockOrders(nodeId, insertOrder, 1);
  }

  db.insertBlock(nodeId, block, insertOrder);
  return { resourceId, blockId: block.blockId, logId: genLogId(), message: '附件已插入文档', name, success: true };
}

function handleMediaDownload(args) {
  const params = parseCommandArgs(args);
  const nodeId = resolveNodeId(params.node);
  if (!nodeId) return validationError("node");
  if (!params['resource-id']) return validationError("resource-id");
  if (!db.getDocument(nodeId)) return apiError(`文档未找到: ${nodeId}`);

  return {
    downloadUrl: `https://mock-cdn.dingtalk.com/res/${nodeId}/att/${params['resource-id']}?Expires=${Date.now() + 3600000}`,
    logId: genLogId(), resourceId: params['resource-id'], success: true
  };
}

module.exports = { register };
