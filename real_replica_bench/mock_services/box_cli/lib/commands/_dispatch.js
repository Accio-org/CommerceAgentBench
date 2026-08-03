// Command dispatcher — routes "files:get" etc. to the right handler
// Handles colon-separated subcommands and aliases

import * as loginCmd from './login.js';
import * as logoutCmd from './logout.js';
import * as filesCmd from './files.js';
import * as foldersCmd from './folders.js';
import * as searchCmd from './search.js';
import * as commentsCmd from './comments.js';
import * as collaborationsCmd from './collaborations.js';
import * as sharedLinksCmd from './shared_links.js';
import * as usersCmd from './users.js';
import * as tasksCmd from './tasks.js';
import * as trashCmd from './trash.js';

/**
 * Dispatch a parsed command to its handler.
 * @param {string} command — e.g. "files:get", "folders:create", "login"
 * @param {object} db — SQLite database
 * @param {string[]} args — positional arguments
 * @param {object} flags — parsed flags
 * @param {string} userId — current user ID
 * @param {object} output — { write, writeErr } functions
 * @returns {*} result object or null
 */
export function dispatch(command, db, args, flags, userId, output) {
  switch (command) {
    // Auth
    case 'login':
      loginCmd.run(db, args, flags, output);
      return { _handled: true };
    case 'logout':
      logoutCmd.run(db, args, flags, output);
      return { _handled: true };

    // Files
    case 'files:get':
      return filesCmd.get(db, args, flags, userId);
    case 'files:download':
      return filesCmd.download(db, args, flags, userId);
    case 'files:upload':
      return filesCmd.upload(db, args, flags, userId);
    case 'files:delete':
      return filesCmd.del(db, args, flags, userId);
    case 'files:copy':
      return filesCmd.copy(db, args, flags, userId);
    case 'files:move':
      return filesCmd.move(db, args, flags, userId);
    case 'files:update':
      return filesCmd.update(db, args, flags, userId);
    case 'files:comments':
      return filesCmd.comments(db, args, flags, userId);
    case 'files:tasks':
    case 'files:tasks:list':
      return tasksCmd.listForFile(db, args, flags, userId);

    // Folders
    case 'folders:get':
      return foldersCmd.get(db, args, flags, userId);
    case 'folders:items':
    case 'folders:list-items':
      return foldersCmd.items(db, args, flags, userId);
    case 'folders:create':
      return foldersCmd.create(db, args, flags, userId);
    case 'folders:delete':
      return foldersCmd.del(db, args, flags, userId);
    case 'folders:copy':
      return foldersCmd.copy(db, args, flags, userId);
    case 'folders:move':
      return foldersCmd.move(db, args, flags, userId);
    case 'folders:update':
      return foldersCmd.update(db, args, flags, userId);

    // Search
    case 'search':
      return searchCmd.run(db, args, flags, userId);

    // Comments
    case 'comments:create':
      return commentsCmd.create(db, args, flags, userId);
    case 'comments:get':
      return commentsCmd.get(db, args, flags, userId);
    case 'comments:delete':
      return commentsCmd.del(db, args, flags, userId);

    // Collaborations
    case 'collaborations:create':
    case 'collaborations:add':
      return collaborationsCmd.create(db, args, flags, userId);
    case 'collaborations:get':
      return collaborationsCmd.get(db, args, flags, userId);
    case 'collaborations:delete':
      return collaborationsCmd.del(db, args, flags, userId);

    // Shared links
    case 'shared-links:create':
      return sharedLinksCmd.create(db, args, flags, userId);
    case 'shared-links:delete':
      return sharedLinksCmd.del(db, args, flags, userId);

    // Users
    case 'users':
    case 'users:list':
      return usersCmd.list(db, args, flags);
    case 'users:get':
      return usersCmd.get(db, args, flags);

    // Tasks
    case 'tasks:create':
      return tasksCmd.create(db, args, flags, userId);
    case 'tasks:get':
      return tasksCmd.get(db, args, flags, userId);
    case 'tasks:update':
      return tasksCmd.update(db, args, flags, userId);
    case 'tasks:delete':
      return tasksCmd.del(db, args, flags, userId);

    // Trash
    case 'trash':
    case 'trash:list':
      return trashCmd.list(db, args, flags, userId);
    case 'trash:delete':
      return trashCmd.del(db, args, flags, userId);
    case 'trash:restore':
      return trashCmd.restore(db, args, flags, userId);

    default:
      return { error: `Unknown command: ${command}\nRun "box --help" for usage.` };
  }
}
