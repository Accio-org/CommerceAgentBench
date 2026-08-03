'use strict';

// ─── drive_validation.js ──────────────────────────────────────────────────────
// Server-side enum + DSL validation for the Google Drive API v3 mock surface.
// All sets are cross-checked against the fact sheet:
//   scratch/docs/api_alignment/google_docs_workspace.md  §3+4, §4.2, §4.3, §4.5
// CLAUDE.md rule #10: closed-set fields MUST be validated server-side.
// This module is shared by /api/workspace/call and /mcp tools/call via
// callWorkspaceTool() in server.js.
// ─────────────────────────────────────────────────────────────────────────────

// ── §4.5  Permission enums ─────────────────────────────────────────────────
// Source: drive_v3.json .schemas.Permission.properties.role.description
//   "Supported values include: owner, organizer, fileOrganizer, writer, commenter, reader."
// Source: .properties.type.description
//   "user, group, domain, anyone …"
const PERMISSION_ROLES = new Set(['owner', 'organizer', 'fileOrganizer', 'writer', 'commenter', 'reader']);
const PERMISSION_TYPES = new Set(['user', 'group', 'domain', 'anyone']);

// ── §4.3  Docs-export MIME set (for drive.files.export / MCP export_doc_to_pdf)
// Source: export-formats guide (Citations §C1); exactly 8 values for document source.
// The mock also accepts short aliases (docx/odt/…) — validated at the alias-resolution
// layer in server.js::resolveExportFormat; here we validate only full MIME strings.
const EXPORT_MIME_SET = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/vnd.oasis.opendocument.text', // odt
  'application/rtf',                         // rtf
  'application/pdf',                         // pdf
  'text/plain',                              // txt  (real Drive omits "; charset=utf-8")
  'application/zip',                         // html-as-zip
  'application/epub+zip',                    // epub
  'text/markdown'                            // md   (real Drive omits "; charset=utf-8")
]);

// Short-alias set used in resolveExportFormat; mirrored here for completeness.
const EXPORT_SHORT_ALIASES = new Set(['docx', 'odt', 'rtf', 'pdf', 'txt', 'html', 'epub', 'md', 'markdown']);

// ── §4.1 orderBy valid keys ────────────────────────────────────────────────
// Source: drive_v3.json .resources.files.methods.list.parameters.orderBy.description
const ORDER_BY_KEYS = new Set([
  'createdTime', 'folder', 'modifiedByMeTime', 'modifiedTime',
  'name', 'name_natural', 'quotaBytesUsed', 'recency',
  'sharedWithMeTime', 'starred', 'viewedByMeTime'
]);

// ── §4.1 corpora/spaces valid values ─────────────────────────────────────
// Source: .resources.files.methods.list.parameters.corpora.description
const CORPORA_VALUES = new Set(['user', 'domain', 'drive', 'allDrives']);
// Source: .parameters.spaces.description
const SPACES_VALUES = new Set(['drive', 'appDataFolder']);

// ── §4.2  q DSL — per-field valid operators ───────────────────────────────
// Source: ref-search-terms (Citations §C3) "File-specific query terms" table.
// Map: fieldName → Set of allowed operator strings.
const Q_FIELD_OPS = {
  name:                    new Set(['contains', '=', '!=']),
  fullText:                new Set(['contains']),
  mimeType:                new Set(['contains', '=', '!=']),
  modifiedTime:            new Set(['<', '<=', '=', '!=', '>', '>=']),
  viewedByMeTime:          new Set(['<', '<=', '=', '!=', '>', '>=']),
  createdTime:             new Set(['<', '<=', '=', '!=', '>', '>=']),
  trashed:                 new Set(['=', '!=']),
  starred:                 new Set(['=', '!=']),
  sharedWithMe:            new Set(['=', '!=']),
  parents:                 new Set(['in']),
  owners:                  new Set(['in']),
  writers:                 new Set(['in']),
  readers:                 new Set(['in']),
  properties:              new Set(['has']),
  appProperties:           new Set(['has']),
  visibility:              new Set(['=', '!=']),
  'shortcutDetails.targetId': new Set(['=', '!='])
};

const Q_KNOWN_FIELDS = new Set(Object.keys(Q_FIELD_OPS));

// ── §4.2  visibility closed set ───────────────────────────────────────────
const VISIBILITY_VALUES = new Set([
  'anyoneCanFind', 'anyoneWithLink', 'domainCanFind', 'domainWithLink', 'limited'
]);

// ─────────────────────────────────────────────────────────────────────────────
// Google error envelope builder
// §3.4 / error envelope: {error:{code,message,status,errors:[{message,domain,reason}]}}
// ─────────────────────────────────────────────────────────────────────────────
function googleError(httpCode, statusStr, message, reason) {
  const err = new Error(message);
  err.status = httpCode;
  err.googleError = {
    error: {
      code: httpCode,
      message,
      status: statusStr,
      errors: [{ message, domain: 'global', reason: reason || statusStr }]
    }
  };
  return err;
}

function notFound(message, reason) {
  return googleError(404, 'NOT_FOUND', message, reason || 'notFound');
}

function invalidArgument(message, reason) {
  return googleError(400, 'INVALID_ARGUMENT', message, reason || 'invalid');
}

// ─────────────────────────────────────────────────────────────────────────────
// validatePermission(role, type)
// Throws 400 INVALID_ARGUMENT if role/type are not in the closed sets.
// Source: §4.5, §3+4 consolidated table.
// ─────────────────────────────────────────────────────────────────────────────
function validatePermission(role, type) {
  if (role !== undefined && !PERMISSION_ROLES.has(role)) {
    throw invalidArgument(
      `Invalid role '${role}'. Supported values: ${[...PERMISSION_ROLES].join(', ')}.`,
      'invalidPermissionRole'
    );
  }
  if (type !== undefined && !PERMISSION_TYPES.has(type)) {
    throw invalidArgument(
      `Invalid type '${type}'. Supported values: ${[...PERMISSION_TYPES].join(', ')}.`,
      'invalidPermissionType'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// validateExportMime(mimeTypeOrAlias)
// For the drive.files.export tool path (full MIME strings or aliases).
// Short aliases are accepted (§4.3 note: mock normalises them).
// Returns the resolved short-key (docx/odt/…) for use with exportDocument().
// Throws 400 INVALID_ARGUMENT for anything outside the 8-member set.
// ─────────────────────────────────────────────────────────────────────────────
function validateExportMime(mimeTypeOrAlias) {
  if (!mimeTypeOrAlias) return null; // caller will use default
  const v = String(mimeTypeOrAlias).trim();
  // Short alias?
  if (EXPORT_SHORT_ALIASES.has(v.toLowerCase())) return v.toLowerCase() === 'markdown' ? 'md' : v.toLowerCase();
  // Full MIME (strip trailing charset suffix before checking)
  const bare = v.split(';')[0].trim();
  if (EXPORT_MIME_SET.has(bare)) return null; // signal "already valid full mime, let resolver handle"
  throw invalidArgument(
    `Export mimeType '${v}' is not supported for Google Docs. ` +
    `Supported MIME types: ${[...EXPORT_MIME_SET].join(', ')} (or short aliases: docx/odt/rtf/pdf/txt/html/epub/md).`,
    'exportMimeTypeNotSupported'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// validateOrderBy(orderByStr)
// Validates comma-separated orderBy keys, each optionally followed by " desc".
// Unknown key → 400 INVALID_ARGUMENT.
// ─────────────────────────────────────────────────────────────────────────────
function validateOrderBy(orderByStr) {
  if (!orderByStr) return;
  const parts = String(orderByStr).split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const key = part.replace(/\s+desc\s*$/i, '').replace(/\s+asc\s*$/i, '').trim();
    if (!ORDER_BY_KEYS.has(key)) {
      throw invalidArgument(
        `Invalid orderBy key '${key}'. Valid keys: ${[...ORDER_BY_KEYS].join(', ')}.`,
        'invalidOrderByKey'
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// validateCorpora(corporaStr)
// If provided, must be one of the valid corpora values.
// ─────────────────────────────────────────────────────────────────────────────
function validateCorpora(corporaStr) {
  if (!corporaStr) return;
  const v = String(corporaStr).trim();
  if (!CORPORA_VALUES.has(v)) {
    throw invalidArgument(
      `Invalid corpora '${v}'. Valid values: ${[...CORPORA_VALUES].join(', ')}.`,
      'invalidCorpora'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// validateSpaces(spacesStr)
// If provided, must be comma-separated values from SPACES_VALUES.
// ─────────────────────────────────────────────────────────────────────────────
function validateSpaces(spacesStr) {
  if (!spacesStr) return;
  const parts = String(spacesStr).split(',').map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    if (!SPACES_VALUES.has(part)) {
      throw invalidArgument(
        `Invalid spaces value '${part}'. Valid values: ${[...SPACES_VALUES].join(', ')}.`,
        'invalidSpaces'
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// parseAndValidateQ(qStr)
// Parses the Drive files.list `q` DSL into an array of condition objects.
// Each condition: { field, op, value } OR { collection, op:'in', value } for parents/owners/…
// Validates per-field operator rules from §4.2 and throws 400 on violation.
// Returns parsed conditions (array), ready for applyQFilter().
//
// Grammar supported (subset per §5):
//   q := term ( ' and ' term )*
//   term :=
//     field op 'value'            -- string/time comparisons
//     | 'value' in collection     -- collection membership (parents/owners/writers/readers)
//     | field op bool             -- boolean comparisons (trashed/starred/sharedWithMe)
//     | field has {key='val'}     -- properties/appProperties (not filtered, just validated)
//
// Single-quoted string values; backslash escapes \' and \\ within.
// ─────────────────────────────────────────────────────────────────────────────
function parseAndValidateQ(qStr) {
  if (!qStr) return [];
  const q = String(qStr).trim();
  if (!q) return [];

  const conditions = [];

  // Split on ' and ' (case-insensitive) — we only support `and` as combinator
  // (§5 "skip-vs-match": `or`/`not` are real but outside our validated subset)
  const rawTerms = splitByAnd(q);

  for (const rawTerm of rawTerms) {
    const term = rawTerm.trim();
    if (!term) continue;

    // Try: 'value' in collection   (e.g. '1234567' in parents; 'me' in owners)
    const inMatch = term.match(/^'((?:[^'\\]|\\.)*)'\s+in\s+([a-zA-Z.]+)$/);
    if (inMatch) {
      const value = unescapeSingleQuoted(inMatch[1]);
      const collection = inMatch[2];
      if (!Q_KNOWN_FIELDS.has(collection)) {
        throw invalidArgument(`Unknown q field '${collection}'.`, 'unknownQField');
      }
      if (!Q_FIELD_OPS[collection].has('in')) {
        throw invalidArgument(
          `Field '${collection}' does not support operator 'in'. ` +
          `Valid operators: ${[...Q_FIELD_OPS[collection]].join(', ')}.`,
          'invalidQOperator'
        );
      }
      conditions.push({ field: collection, op: 'in', value });
      continue;
    }

    // Try: field has {...}  (properties/appProperties)
    const hasMatch = term.match(/^([a-zA-Z.]+)\s+has\s+\{(.+)\}$/i);
    if (hasMatch) {
      const field = hasMatch[1];
      if (!Q_KNOWN_FIELDS.has(field)) {
        throw invalidArgument(`Unknown q field '${field}'.`, 'unknownQField');
      }
      if (!Q_FIELD_OPS[field].has('has')) {
        throw invalidArgument(
          `Field '${field}' does not support operator 'has'. ` +
          `Valid operators: ${[...Q_FIELD_OPS[field]].join(', ')}.`,
          'invalidQOperator'
        );
      }
      conditions.push({ field, op: 'has', value: hasMatch[2] });
      continue;
    }

    // Try: field op 'value'  or  field op bool
    // Operators: contains, =, !=, <, <=, >, >=
    const fieldOpMatch = term.match(/^([a-zA-Z.]+)\s+(contains|!=|<=|>=|=|<|>)\s+(.+)$/i);
    if (fieldOpMatch) {
      const field = fieldOpMatch[1];
      const op = fieldOpMatch[2].toLowerCase() === 'contains' ? 'contains' : fieldOpMatch[2];
      const rawValue = fieldOpMatch[3].trim();

      if (!Q_KNOWN_FIELDS.has(field)) {
        throw invalidArgument(`Unknown q field '${field}'.`, 'unknownQField');
      }

      // Validate operator for this field
      const allowedOps = Q_FIELD_OPS[field];
      if (!allowedOps.has(op)) {
        throw invalidArgument(
          `Field '${field}' does not support operator '${op}'. ` +
          `Valid operators: ${[...allowedOps].join(', ')}.`,
          'invalidQOperator'
        );
      }

      // Parse value: single-quoted string, or bare boolean true/false
      let value;
      if (rawValue.startsWith("'") && rawValue.endsWith("'")) {
        value = unescapeSingleQuoted(rawValue.slice(1, -1));
      } else if (rawValue === 'true') {
        value = true;
      } else if (rawValue === 'false') {
        value = false;
      } else {
        // Unquoted non-boolean — treat as string for tolerance
        value = rawValue;
      }

      // Validate visibility values if applicable
      if (field === 'visibility' && typeof value === 'string' && !VISIBILITY_VALUES.has(value)) {
        throw invalidArgument(
          `Invalid visibility value '${value}'. Valid: ${[...VISIBILITY_VALUES].join(', ')}.`,
          'invalidVisibilityValue'
        );
      }

      conditions.push({ field, op, value });
      continue;
    }

    // Could not parse this term
    throw invalidArgument(`Cannot parse q term: '${term}'.`, 'malformedQ');
  }

  return conditions;
}

// Split `q` string by ' and ' (case-insensitive), respecting single-quoted strings.
function splitByAnd(q) {
  const results = [];
  let current = '';
  let inQuote = false;
  let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (ch === '\\' && inQuote) {
      current += ch + (q[i + 1] || '');
      i += 2;
      continue;
    }
    if (ch === "'") {
      inQuote = !inQuote;
      current += ch;
      i++;
      continue;
    }
    if (!inQuote) {
      // Check for ' and ' pattern (space-and-space)
      const rest = q.slice(i);
      const andMatch = rest.match(/^(\s+and\s+)/i);
      if (andMatch) {
        results.push(current);
        current = '';
        i += andMatch[0].length;
        continue;
      }
    }
    current += ch;
    i++;
  }
  if (current.trim()) results.push(current);
  return results;
}

function unescapeSingleQuoted(s) {
  return s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

// ─────────────────────────────────────────────────────────────────────────────
// applyQFilter(files, conditions)
// Applies parsed q conditions to an array of mock file objects.
// Implements the subset of field comparisons described in §4.2 + §5.
// ─────────────────────────────────────────────────────────────────────────────
function applyQFilter(files, conditions) {
  if (!conditions || !conditions.length) return files;
  return files.filter((file) => conditions.every((cond) => matchCondition(file, cond)));
}

function matchCondition(file, cond) {
  const { field, op, value } = cond;
  switch (field) {
    case 'name': {
      const fname = String(file.name || '');
      if (op === '=') return fname === value;
      if (op === '!=') return fname !== value;
      if (op === 'contains') return fname.toLowerCase().includes(String(value).toLowerCase());
      return false;
    }
    case 'fullText': {
      // fullText: contains — match name or plain-text content
      const haystack = (String(file.name || '') + ' ' + extractPlainText(file)).toLowerCase();
      return haystack.includes(String(value).toLowerCase());
    }
    case 'mimeType': {
      const fileMime = toGoogleMimeType(file);
      if (op === '=') return fileMime === value;
      if (op === '!=') return fileMime !== value;
      if (op === 'contains') return fileMime.includes(String(value));
      return false;
    }
    case 'modifiedTime':
    case 'createdTime':
    case 'viewedByMeTime': {
      const mockField = field === 'modifiedTime' ? 'modifiedAt'
        : field === 'createdTime' ? 'createdAt'
          : 'lastOpenedAt';
      const fileTs = Date.parse(file[mockField] || 0);
      const condTs = Date.parse(String(value));
      if (isNaN(condTs)) return false;
      if (op === '=') return fileTs === condTs;
      if (op === '!=') return fileTs !== condTs;
      if (op === '<') return fileTs < condTs;
      if (op === '<=') return fileTs <= condTs;
      if (op === '>') return fileTs > condTs;
      if (op === '>=') return fileTs >= condTs;
      return false;
    }
    case 'trashed':
      if (op === '=') return Boolean(file.trashed) === Boolean(value);
      if (op === '!=') return Boolean(file.trashed) !== Boolean(value);
      return false;
    case 'starred':
      if (op === '=') return Boolean(file.starred) === Boolean(value);
      if (op === '!=') return Boolean(file.starred) !== Boolean(value);
      return false;
    case 'sharedWithMe':
      // Mock: shared files are those with non-empty sharedWith, not owned by me
      if (op === '=') return value ? (Array.isArray(file.sharedWith) && file.sharedWith.length > 0) : true;
      if (op === '!=') return !Boolean(value || (Array.isArray(file.sharedWith) && file.sharedWith.length > 0));
      return false;
    case 'parents': {
      // 'FOLDER_ID' in parents — mock stores parentId (singular)
      const parentId = file.parentId || 'root';
      return op === 'in' && (parentId === value || (value === 'root' && !file.parentId));
    }
    case 'owners': {
      // 'me' in owners or 'email' in owners
      const ownerId = file.ownerId || 'me';
      return op === 'in' && (value === 'me' ? ownerId === 'me' : ownerId === value);
    }
    case 'writers':
    case 'readers': {
      // Check sharedWith list for matching role
      const expectedRole = field === 'writers' ? 'editor' : 'viewer';
      return op === 'in' && Array.isArray(file.sharedWith) &&
        file.sharedWith.some((sw) => sw.personId === value || sw.email === value) &&
        file.sharedWith.some((sw) => sw.role === expectedRole);
    }
    case 'visibility': {
      // Mock: check linkAccess for approximation
      const access = file.linkAccess || 'restricted';
      const mockVis = access === 'anyone' ? 'anyoneWithLink' : 'limited';
      if (op === '=') return mockVis === value;
      if (op === '!=') return mockVis !== value;
      return false;
    }
    case 'properties':
    case 'appProperties':
    case 'shortcutDetails.targetId':
      // Not deeply implemented — return true to not silently exclude files
      return true;
    default:
      return true;
  }
}

function toGoogleMimeType(file) {
  if (file.mimeType) return file.mimeType; // already set
  if (file.type === 'folder') return 'application/vnd.google-apps.folder';
  if (file.type === 'document') return 'application/vnd.google-apps.document';
  return 'application/octet-stream';
}

function extractPlainText(file) {
  if (!file.content || !Array.isArray(file.content.blocks)) return '';
  return file.content.blocks.map((b) => b.text || '').join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// projectFileToDrive(mockFile, ownerAccount)
// Project the mock's internal file shape to a Drive `File` object per §4.4.
// Additive — mock-native fields are preserved alongside real Drive fields.
// The projection is applied at READ TIME and does not mutate the stored object.
// ─────────────────────────────────────────────────────────────────────────────
function projectFileToDrive(mockFile, ownerAccount) {
  const googleMime = toGoogleMimeType(mockFile);
  const owner = ownerAccount || { displayName: '李明', email: 'liming.demo@example.com' };
  return {
    // ── real Drive fields per §4.4 ─────────────────────────────────────────
    kind: 'drive#file',
    id: mockFile.id,
    name: mockFile.name,
    mimeType: googleMime,
    parents: [mockFile.parentId || 'root'],
    starred: Boolean(mockFile.starred),
    trashed: Boolean(mockFile.trashed),
    createdTime: mockFile.createdAt || mockFile.createdTime || null,
    modifiedTime: mockFile.modifiedAt || mockFile.modifiedTime || null,
    owners: [{
      kind: 'drive#user',
      displayName: owner.displayName || owner.name || '李明',
      emailAddress: owner.email || 'liming.demo@example.com',
      me: (mockFile.ownerId || 'me') === 'me'
    }],
    // ── mock-native fields (additive, keeps existing UI/API working) ───────
    ...mockFile
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// drivePermissionShape(mockShareEntry, permId)
// Convert a mock sharedWith entry to a Drive Permission object per §4.5.
// kind:'drive#permission', id, type, role, emailAddress?
// ─────────────────────────────────────────────────────────────────────────────
function drivePermissionShape(entry, permId, peopleMap) {
  // Map mock roles (viewer/commenter/editor) → Drive roles (reader/commenter/writer)
  const driveRole = mockRoleToDrive(entry.role || 'viewer');
  const person = peopleMap ? peopleMap[entry.personId] : null;
  return {
    kind: 'drive#permission',
    id: permId || entry.permId || entry.personId || 'perm-unknown',
    type: entry.type || 'user',
    role: driveRole,
    emailAddress: entry.email || (person && person.email) || undefined,
    displayName: (person && (person.displayName || person.name)) || undefined
  };
}

// Drive role → mock role mapping (for creating permissions)
function driveRoleToMock(driveRole) {
  switch (driveRole) {
    case 'reader': return 'viewer';
    case 'commenter': return 'commenter';
    case 'writer': return 'editor';
    case 'owner':
    case 'organizer':
    case 'fileOrganizer': return 'editor'; // all elevated → editor in mock
    default: return 'viewer';
  }
}

// Mock role → Drive role mapping (for reading permissions)
function mockRoleToDrive(mockRole) {
  switch (mockRole) {
    case 'viewer': return 'reader';
    case 'commenter': return 'commenter';
    case 'editor': return 'writer';
    default: return 'reader';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// applyOrderBy(files, orderByStr)
// Sort files[] by the comma-list orderBy keys (with optional " desc").
// Falls back to mock's default sort on unknown keys (already validated before).
// ─────────────────────────────────────────────────────────────────────────────
function applyOrderBy(files, orderByStr) {
  if (!orderByStr) return files;
  const parts = String(orderByStr).split(',').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return files;

  return files.slice().sort((a, b) => {
    for (const part of parts) {
      const desc = /\s+desc\s*$/i.test(part);
      const key = part.replace(/\s+(desc|asc)\s*$/i, '').trim();
      const dir = desc ? -1 : 1;
      let av, bv;
      switch (key) {
        case 'name':
        case 'name_natural':
          av = String(a.name || '').toLocaleLowerCase();
          bv = String(b.name || '').toLocaleLowerCase();
          break;
        case 'folder':
          // folders first (lower sort value)
          av = a.type === 'folder' ? 0 : 1;
          bv = b.type === 'folder' ? 0 : 1;
          break;
        case 'starred':
          av = a.starred ? 0 : 1;
          bv = b.starred ? 0 : 1;
          break;
        case 'modifiedTime':
        case 'modifiedByMeTime':
          av = Date.parse(a.modifiedAt || 0);
          bv = Date.parse(b.modifiedAt || 0);
          break;
        case 'createdTime':
          av = Date.parse(a.createdAt || 0);
          bv = Date.parse(b.createdAt || 0);
          break;
        case 'recency':
        case 'viewedByMeTime':
        case 'sharedWithMeTime':
          av = Date.parse(a.lastOpenedAt || a.modifiedAt || 0);
          bv = Date.parse(b.lastOpenedAt || b.modifiedAt || 0);
          break;
        case 'quotaBytesUsed':
          av = 0; bv = 0; // not tracked in mock
          break;
        default:
          av = 0; bv = 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }
    return 0;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// driveRevisionShape(version)
// Convert a mock version snapshot to a Drive Revision per §4.6.
// ─────────────────────────────────────────────────────────────────────────────
function driveRevisionShape(version) {
  return {
    kind: 'drive#revision',
    id: version.id,
    mimeType: 'application/vnd.google-apps.document',
    modifiedTime: version.timestamp || version.modifiedTime || null,
    lastModifyingUser: {
      kind: 'drive#user',
      displayName: version.authorName || '李明',
      emailAddress: 'liming.demo@example.com',
      me: true
    },
    keepForever: false,
    published: false,
    // mock-native extras
    label: version.label || version.name || '',
    named: Boolean(version.named),
    title: version.title || ''
  };
}

module.exports = {
  // validation functions
  validatePermission,
  validateExportMime,
  validateOrderBy,
  validateCorpora,
  validateSpaces,
  parseAndValidateQ,
  // filter / sort
  applyQFilter,
  applyOrderBy,
  // projection helpers
  projectFileToDrive,
  drivePermissionShape,
  driveRevisionShape,
  driveRoleToMock,
  mockRoleToDrive,
  toGoogleMimeType,
  // error builders
  notFound,
  invalidArgument,
  googleError,
  // enums (exported for tests)
  PERMISSION_ROLES,
  PERMISSION_TYPES,
  EXPORT_MIME_SET,
  EXPORT_SHORT_ALIASES,
  ORDER_BY_KEYS,
  CORPORA_VALUES,
  SPACES_VALUES,
  Q_FIELD_OPS,
  VISIBILITY_VALUES
};
