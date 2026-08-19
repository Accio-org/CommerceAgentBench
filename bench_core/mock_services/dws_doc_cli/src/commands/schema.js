'use strict';

const DOC_TOOLS = [
  {
    id: 'search_documents',
    name: 'search',
    command: 'dws doc search',
    description: 'Search DingTalk documents by keyword and metadata filters.',
    required: [],
    properties: {
      query: { type: 'string', description: 'Keyword to search in document names and content.' },
      'workspace-ids': { type: 'string', description: 'Comma-separated workspace IDs.' },
      extensions: { type: 'string', description: 'Comma-separated file extensions, such as adoc or folder.' },
      'page-size': { type: 'integer', description: 'Maximum documents to return.' },
      'page-token': { type: 'string', description: 'Pagination token.' },
      'created-from': { type: 'integer', description: 'Minimum create time in milliseconds.' },
      'created-to': { type: 'integer', description: 'Maximum create time in milliseconds.' },
      'creator-uids': { type: 'string', description: 'Comma-separated creator user IDs.' },
      'editor-uids': { type: 'string', description: 'Comma-separated editor user IDs.' },
      'mentioned-uids': { type: 'string', description: 'Comma-separated mentioned user IDs.' },
      'visited-from': { type: 'integer', description: 'Minimum visited time in milliseconds.' },
      'visited-to': { type: 'integer', description: 'Maximum visited time in milliseconds.' }
    }
  },
  {
    id: 'list_nodes',
    name: 'list',
    command: 'dws doc list',
    description: 'List document nodes in a workspace or folder.',
    required: [],
    properties: {
      workspace: { type: 'string', description: 'Workspace ID.' },
      folder: { type: 'string', description: 'Folder node ID.' },
      'page-size': { type: 'integer', description: 'Maximum nodes to return.' },
      'page-token': { type: 'string', description: 'Pagination token.' }
    }
  },
  {
    id: 'get_document_info',
    name: 'info',
    command: 'dws doc info',
    description: 'Get metadata for one document or folder node.',
    required: ['node'],
    properties: {
      node: { type: 'string', description: 'Node ID or /i/nodes/<nodeId> URL.' }
    }
  },
  {
    id: 'read_document',
    name: 'read',
    command: 'dws doc read',
    description: 'Read a document as Markdown.',
    required: ['node'],
    properties: {
      node: { type: 'string', description: 'Node ID or /i/nodes/<nodeId> URL.' }
    }
  },
  {
    id: 'create_document',
    name: 'create',
    command: 'dws doc create',
    description: 'Create a DingTalk document.',
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'Document title.' },
      markdown: { type: 'string', description: 'Initial Markdown content.' },
      workspace: { type: 'string', description: 'Target workspace ID.' },
      folder: { type: 'string', description: 'Target folder node ID.' }
    }
  },
  {
    id: 'update_document',
    name: 'update',
    command: 'dws doc update',
    description: 'Overwrite or append Markdown content to a document.',
    required: ['node', 'content'],
    properties: {
      node: { type: 'string', description: 'Node ID or /i/nodes/<nodeId> URL.' },
      content: { type: 'string', description: 'Markdown content literal.' },
      'content-file': { type: 'string', description: 'Mock accepts the provided value as content.' },
      mode: { type: 'string', enum: ['overwrite', 'append'], description: 'Write mode.' }
    }
  },
  {
    id: 'upload_file',
    name: 'upload',
    command: 'dws doc upload',
    description: 'Create an uploaded file node in mock state.',
    required: [],
    properties: {
      workspace: { type: 'string', description: 'Target workspace ID.' },
      folder: { type: 'string', description: 'Target folder node ID.' }
    }
  },
  {
    id: 'download_file',
    name: 'download',
    command: 'dws doc download',
    description: 'Generate a deterministic mock download URL.',
    required: ['node'],
    properties: {
      node: { type: 'string', description: 'Node ID or /i/nodes/<nodeId> URL.' }
    }
  },
  {
    id: 'copy_node',
    name: 'copy',
    command: 'dws doc copy',
    description: 'Copy a document or folder node.',
    required: ['node'],
    properties: {
      node: { type: 'string', description: 'Source node ID.' },
      workspace: { type: 'string', description: 'Target workspace ID.' },
      folder: { type: 'string', description: 'Target folder node ID.' }
    }
  },
  {
    id: 'move_node',
    name: 'move',
    command: 'dws doc move',
    description: 'Move a document or folder node.',
    required: ['node'],
    properties: {
      node: { type: 'string', description: 'Source node ID.' },
      workspace: { type: 'string', description: 'Target workspace ID.' },
      folder: { type: 'string', description: 'Target folder node ID.' }
    }
  },
  {
    id: 'rename_node',
    name: 'rename',
    command: 'dws doc rename',
    description: 'Rename a document or folder node.',
    required: ['node', 'name'],
    properties: {
      node: { type: 'string', description: 'Node ID.' },
      name: { type: 'string', description: 'New node name.' }
    }
  },
  {
    id: 'create_folder',
    name: 'folder create',
    command: 'dws doc folder create',
    description: 'Create a folder node.',
    required: ['name'],
    properties: {
      name: { type: 'string', description: 'Folder name.' },
      workspace: { type: 'string', description: 'Target workspace ID.' },
      folder: { type: 'string', description: 'Parent folder node ID.' }
    }
  },
  {
    id: 'create_file_node',
    name: 'file create',
    command: 'dws doc file create',
    description: 'Create a file node of a supported doc product file type.',
    required: ['name', 'type'],
    properties: {
      name: { type: 'string', description: 'File name.' },
      type: { type: 'string', enum: ['adoc', 'axls', 'appt', 'adraw', 'amind', 'able', 'folder'], description: 'File type.' },
      workspace: { type: 'string', description: 'Target workspace ID.' },
      folder: { type: 'string', description: 'Parent folder node ID.' }
    }
  },
  {
    id: 'list_blocks',
    name: 'block list',
    command: 'dws doc block list',
    description: 'List document blocks.',
    required: ['node'],
    properties: {
      node: { type: 'string', description: 'Document node ID.' },
      'block-type': { type: 'string', description: 'Optional block type filter.' },
      'start-index': { type: 'integer', description: 'Start block index.' },
      'end-index': { type: 'integer', description: 'End block index.' }
    }
  },
  {
    id: 'insert_block',
    name: 'block insert',
    command: 'dws doc block insert',
    description: 'Insert a block into a document. Use --type/--text shortcuts or --element JSON.',
    required: ['node'],
    properties: {
      node: { type: 'string', description: 'Document node ID.' },
      element: { type: 'string', description: 'Block element JSON (alternative to --type/--text).' },
      type: { type: 'string', enum: ['paragraph', 'heading', 'code', 'blockquote', 'callout', 'orderedList', 'unorderedList', 'divider'], description: 'Block type shortcut.' },
      text: { type: 'string', description: 'Paragraph text shortcut.' },
      heading: { type: 'string', description: 'Heading text shortcut.' },
      level: { type: 'integer', description: 'Heading level (1-6), default 1.' },
      index: { type: 'integer', description: 'Insert index.' },
      'ref-block': { type: 'string', description: 'Reference block ID.' },
      where: { type: 'string', enum: ['before', 'after'], description: 'Position relative to ref-block.' }
    }
  },
  {
    id: 'update_block',
    name: 'block update',
    command: 'dws doc block update',
    description: 'Update a document block. Use --type/--text shortcuts or --element JSON.',
    required: ['node', 'block-id'],
    properties: {
      node: { type: 'string', description: 'Document node ID.' },
      'block-id': { type: 'string', description: 'Block ID.' },
      element: { type: 'string', description: 'Replacement block element JSON (alternative to --type/--text).' },
      type: { type: 'string', description: 'Block type shortcut.' },
      text: { type: 'string', description: 'New paragraph text.' },
      heading: { type: 'string', description: 'New heading text.' },
      level: { type: 'integer', description: 'Heading level (1-6).' }
    }
  },
  {
    id: 'delete_block',
    name: 'block delete',
    command: 'dws doc block delete',
    description: 'Delete a document block.',
    required: ['node', 'block-id'],
    properties: {
      node: { type: 'string', description: 'Document node ID.' },
      'block-id': { type: 'string', description: 'Block ID.' }
    }
  },
  {
    id: 'list_comments',
    name: 'comment list',
    command: 'dws doc comment list',
    description: 'List document comments.',
    required: ['node'],
    properties: {
      node: { type: 'string', description: 'Document node ID.' },
      type: { type: 'string', description: 'Comment type.' },
      'resolve-status': { type: 'string', description: 'Resolve status filter.' },
      'page-size': { type: 'integer', description: 'Maximum comments to return.' },
      'next-token': { type: 'string', description: 'Pagination token.' }
    }
  },
  {
    id: 'create_comment',
    name: 'comment create',
    command: 'dws doc comment create',
    description: 'Create a document-level comment.',
    required: ['node', 'content'],
    properties: {
      node: { type: 'string', description: 'Document node ID.' },
      content: { type: 'string', description: 'Comment content.' },
      mention: { type: 'string', description: 'Comma-separated mentioned user IDs.' }
    }
  },
  {
    id: 'create_inline_comment',
    name: 'comment create-inline',
    command: 'dws doc comment create-inline',
    description: 'Create an inline comment on selected text.',
    required: ['node', 'block-id', 'content'],
    properties: {
      node: { type: 'string', description: 'Document node ID.' },
      'block-id': { type: 'string', description: 'Block ID.' },
      content: { type: 'string', description: 'Comment content.' },
      start: { type: 'integer', description: 'Selection start offset.' },
      end: { type: 'integer', description: 'Selection end offset.' },
      'selected-text': { type: 'string', description: 'Selected text.' },
      mention: { type: 'string', description: 'Comma-separated mentioned user IDs.' }
    }
  },
  {
    id: 'reply_comment',
    name: 'comment reply',
    command: 'dws doc comment reply',
    description: 'Reply to a document comment.',
    required: ['node', 'comment-key'],
    properties: {
      node: { type: 'string', description: 'Document node ID.' },
      'comment-key': { type: 'string', description: 'Target comment key.' },
      content: { type: 'string', description: 'Reply content.' },
      emoji: { type: 'string', description: 'Emoji reaction.' },
      mention: { type: 'string', description: 'Comma-separated mentioned user IDs.' }
    }
  }
];

const TOOL_BY_ID = new Map(DOC_TOOLS.map(tool => [tool.id, tool]));

function register(registerCommand) {
  registerCommand('schema', handleSchema);
}

function handleSchema(args) {
  if (args.length > 0 && !args[0].startsWith('--')) {
    return getToolSchema(args[0]);
  }

  return {
    success: true,
    result: {
      products: [
        {
          id: 'doc',
          description: 'DingTalk Doc mock product',
          tools: DOC_TOOLS.map(toProductTool)
        }
      ]
    }
  };
}

function toProductTool(tool) {
  return {
    id: tool.id,
    name: tool.name,
    command: tool.command,
    description: tool.description
  };
}

function getToolSchema(toolId) {
  const [product, toolName] = toolId.split('.');
  if (product !== 'doc' || !toolName) {
    return {
      success: false,
      errorCode: 'UNSUPPORTED_PRODUCT',
      errorMessage: 'dws_doc_cli currently exposes only the doc product. Use dws schema or dws doc --help for supported commands.'
    };
  }

  const tool = TOOL_BY_ID.get(toolName);
  if (!tool) {
    return {
      success: false,
      errorCode: 'UNKNOWN_DOC_TOOL',
      errorMessage: `Unknown doc tool: ${toolName}`
    };
  }

  return {
    success: true,
    tool: {
      id: tool.id,
      product: 'doc',
      command: tool.command,
      description: tool.description,
      parameters: {
        required: tool.required,
        properties: tool.properties
      }
    }
  };
}

module.exports = { register };
