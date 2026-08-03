// Closed-set enum validation for Notion API mock.
// Values from Notion API reference (developers.notion.com/reference).
// CLAUDE.md rule #10: closed-set fields MUST be validated server-side.

export const BLOCK_TYPES = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3',
  'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle',
  'code', 'child_page', 'child_database', 'embed', 'image',
  'video', 'file', 'pdf', 'bookmark', 'callout', 'quote',
  'equation', 'divider', 'table_of_contents', 'column',
  'column_list', 'link_preview', 'synced_block', 'template',
  'link_to_page', 'audio', 'breadcrumb', 'table', 'table_row',
]);

export const PARENT_TYPES = new Set([
  'page_id', 'database_id', 'workspace', 'block_id',
]);

export const FILE_UPLOAD_STATUS = new Set([
  'uploaded', 'expired', 'failed',
]);

export const COLOR_VALUES = new Set([
  'default', 'gray', 'brown', 'orange', 'yellow', 'green',
  'blue', 'purple', 'pink', 'red',
  'gray_background', 'brown_background', 'orange_background',
  'yellow_background', 'green_background', 'blue_background',
  'purple_background', 'pink_background', 'red_background',
]);

export const NUMBER_FORMAT = new Set([
  'number', 'number_with_commas', 'percent', 'dollar',
  'canadian_dollar', 'euro', 'pound', 'yen', 'ruble',
  'rupee', 'won', 'yuan', 'real', 'lira', 'rupiah',
  'franc', 'hong_kong_dollar', 'new_zealand_dollar',
  'krona', 'norwegian_krone', 'mexican_peso',
  'rand', 'new_taiwan_dollar', 'danish_krone',
  'zloty', 'baht', 'forint', 'koruna', 'shekel',
  'chilean_peso', 'philippine_peso', 'dirham',
  'colombian_peso', 'riyal', 'ringgit', 'leu',
  'argentine_peso', 'uruguayan_peso', 'singapore_dollar',
]);

export const PROPERTY_TYPES = new Set([
  'title', 'rich_text', 'number', 'select', 'multi_select',
  'date', 'people', 'files', 'checkbox', 'url', 'email',
  'phone_number', 'formula', 'relation', 'rollup',
  'created_time', 'created_by', 'last_edited_time',
  'last_edited_by', 'status', 'unique_id', 'verification',
]);

export function validateBlockType(type) {
  if (type && !BLOCK_TYPES.has(type)) {
    return { error: `Invalid block type '${type}'. Valid: ${[...BLOCK_TYPES].slice(0, 10).join(', ')}...`, status: 400 };
  }
  return null;
}

export function validateParentType(parent) {
  if (!parent) return null;
  const keys = Object.keys(parent);
  for (const key of keys) {
    if (!PARENT_TYPES.has(key) && key !== 'type') {
      return { error: `Invalid parent type '${key}'. Valid: ${[...PARENT_TYPES].join(', ')}`, status: 400 };
    }
  }
  return null;
}

export function validateBlockChildren(children) {
  if (!Array.isArray(children)) return null;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type) {
      const err = validateBlockType(child.type);
      if (err) return { ...err, error: `children[${i}]: ${err.error}` };
    }
  }
  return null;
}
