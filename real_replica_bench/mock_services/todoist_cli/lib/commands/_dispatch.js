// Command dispatcher — parse argv and route to command handlers
// Mirrors urfave/cli v2 command routing from main.go

import { cmdList, formatListRow, LIST_HEADER } from './list.js';
import { cmdAdd } from './add.js';
import { cmdModify } from './modify.js';
import { cmdClose } from './close.js';
import { cmdDelete } from './delete.js';
import { cmdReopen } from './reopen.js';
import { cmdShow } from './show.js';
import { cmdProjects, cmdAddProject, PROJECTS_HEADER } from './projects.js';
import { cmdLabels, LABELS_HEADER } from './labels.js';
import {
  cmdSectionsList, cmdSectionsAdd, cmdSectionsDelete,
  cmdSectionsArchive, cmdSectionsUnarchive, cmdSectionsUpdate,
  cmdSectionsMove, cmdSectionsReorder, SECTIONS_HEADER
} from './sections.js';
import { cmdSync } from './sync.js';
import { cmdFilters, FILTERS_HEADER } from './filters.js';
import { formatDueDate, resolveSectionSuffix, formatPriority, formatLabels, projectFormat } from './_helpers.js';
import { writeTSV, writeKV } from '../output/table.js';
import { writeCSV } from '../output/csv.js';
import { NO_TASKS_TODAY } from '../errors.js';

// Upstream is built with `app.Version = version` where `version` is an
// ldflags-injected string left empty in an ordinary build. The `version`
// command (version.go:14-17) prints "todoist (dev build)" when it is empty.
const VERSION_DEV_BUILD = 'todoist (dev build)';

/**
 * Parse argv into { command, subcommand, positional, flags }.
 * Handles global flags, command-specific flags, aliases.
 */
export function parseArgv(argv) {
  // argv[0] = bun/node, argv[1] = script path
  const args = argv.slice(2);

  const globalFlags = {};
  const cmdFlags = {};
  const positional = [];
  let command = null;
  let subcommand = null;
  let i = 0;

  // Pass 1: extract global flags (before command)
  while (i < args.length) {
    const a = args[i];
    if (a === '--header') { globalFlags.header = true; i++; continue; }
    if (a === '--color') { globalFlags.color = true; i++; continue; }
    if (a === '--csv') { globalFlags.csv = true; i++; continue; }
    if (a === '--debug') { globalFlags.debug = true; i++; continue; }
    if (a === '--namespace') { globalFlags.namespace = true; i++; continue; }
    if (a === '--indent') { globalFlags.indent = true; i++; continue; }
    if (a === '--project-namespace') { globalFlags.projectNamespace = true; i++; continue; }
    if (a === '-h' || a === '--help') { globalFlags.help = true; i++; continue; }
    if (a === '-v' || a === '--version' || a === '-version') {
      globalFlags.version = true;
      // Go's flag package reports a double-dash long flag with a single dash,
      // and accepts the single-dash long spelling `-version` identically.
      globalFlags.versionToken = (a === '-v' ? '-v' : '-version');
      i++; continue;
    }
    // First non-flag is the command
    break;
  }

  if (i < args.length) {
    command = args[i];
    i++;
  }

  // Pass 2: extract command-specific flags and positional args
  while (i < args.length) {
    const a = args[i];

    // Flags with values
    if ((a === '--filter' || a === '-f') && i + 1 < args.length) {
      cmdFlags.filter = args[++i]; i++; continue;
    }
    if ((a === '--priority' || a === '-p') && i + 1 < args.length) {
      // Could be sort-bool for list/today, or int for add/modify
      // We detect context later; store raw
      cmdFlags.priorityRaw = args[++i]; i++; continue;
    }
    if (a === '-p' && command !== 'add' && command !== 'a' && command !== 'modify' && command !== 'm') {
      // In list/today context, -p is --priority (sort bool, no value)
      cmdFlags.sortPriority = true; i++; continue;
    }
    if ((a === '--label-names' || a === '-L') && i + 1 < args.length) {
      cmdFlags.labelNames = args[++i]; i++; continue;
    }
    if ((a === '--project-id' || a === '-P') && i + 1 < args.length) {
      cmdFlags.projectId = args[++i]; i++; continue;
    }
    if ((a === '--project-name' || a === '-N') && i + 1 < args.length) {
      cmdFlags.projectName = args[++i]; i++; continue;
    }
    if ((a === '--date' || a === '-d') && i + 1 < args.length) {
      cmdFlags.date = args[++i]; i++; continue;
    }
    if ((a === '--content' || a === '-c') && i + 1 < args.length) {
      cmdFlags.content = args[++i]; i++; continue;
    }
    if (a === '--description' && i + 1 < args.length) {
      cmdFlags.description = args[++i]; i++; continue;
    }
    if (a === '--deadline' && i + 1 < args.length) {
      cmdFlags.deadline = args[++i]; i++; continue;
    }
    if (a === '--section-id' && i + 1 < args.length) {
      cmdFlags.sectionId = args[++i]; i++; continue;
    }
    if (a === '--section-name' && i + 1 < args.length) {
      cmdFlags.sectionName = args[++i]; i++; continue;
    }
    if ((a === '--browse' || a === '-o')) {
      cmdFlags.browse = true; i++; continue;
    }
    if ((a === '--remote' || a === '-r') && (command === 'list' || command === 'l' || command === 'today' || command === 'tod')) {
      cmdFlags.remote = true; i++; continue;
    }
    if ((a === '--reminder' || a === '-r') && (command === 'add' || command === 'a')) {
      cmdFlags.reminder = true; i++; continue;
    }
    if (a === '--limit' && i + 1 < args.length) {
      cmdFlags.limit = parseInt(args[++i], 10); i++; continue;
    }
    if (a === '--color' && i + 1 < args.length && (command === 'add-project' || command === 'ap')) {
      cmdFlags.color = args[++i]; i++; continue;
    }
    if (a === '--item-order' && i + 1 < args.length) {
      cmdFlags.itemOrder = parseInt(args[++i], 10); i++; continue;
    }
    if (a === '--name' && i + 1 < args.length) {
      cmdFlags.name = args[++i]; i++; continue;
    }
    if (a === '-h' || a === '--help') {
      globalFlags.help = true; i++; continue;
    }

    // Handle -p as sort-priority bool for list/today
    if (a === '-p' || a === '--priority') {
      if (command === 'list' || command === 'l' || command === 'today' || command === 'tod') {
        cmdFlags.sortPriority = true;
        i++; continue;
      }
    }

    // Anything else is positional
    positional.push(a);
    i++;
  }

  // Handle priority: for add/modify it's an integer; for list/today it's a sort bool
  if (cmdFlags.priorityRaw !== undefined) {
    if (command === 'add' || command === 'a' || command === 'modify' || command === 'm') {
      cmdFlags.priority = parseInt(cmdFlags.priorityRaw, 10);
    } else {
      cmdFlags.sortPriority = true;
    }
    delete cmdFlags.priorityRaw;
  }

  // Detect subcommand for 'sections'
  if ((command === 'sections') && positional.length > 0) {
    const sub = positional[0];
    if (['list', 'add', 'delete', 'archive', 'unarchive', 'update', 'move', 'reorder'].includes(sub)) {
      subcommand = sub;
      positional.shift();
    }
  }

  return { command, subcommand, positional, globalFlags, cmdFlags };
}

/**
 * Dispatch parsed command to handler, write output, return exit code.
 */
export function dispatch(db, parsed) {
  const { command, subcommand, positional, globalFlags, cmdFlags } = parsed;
  const useCSV = globalFlags.csv;
  const showHeader = globalFlags.header;

  // Alias resolution
  const cmd = resolveAlias(command);

  // Help / version (skip auth)
  if (globalFlags.help || cmd === 'help') {
    printUsage();
    return 0;
  }
  // `version` command -> version.go Version(): "todoist (dev build)".
  if (cmd === 'version') {
    process.stdout.write(VERSION_DEV_BUILD + '\n');
    return 0;
  }
  // `-v` / `--version` are NOT valid flags: upstream sets App.Version="" which
  // makes urfave/cli hide the version flag entirely, so they parse as unknown
  // flags. urfave writes "Incorrect Usage: <err>\n\n" + the app help to stdout,
  // main.go:535-538 writes "Error: <err>" to stderr, and the process exits 1
  // (captured byte-for-byte from the real binary).
  if (globalFlags.version) {
    const msg = `flag provided but not defined: ${globalFlags.versionToken || '-version'}`;
    process.stdout.write(`Incorrect Usage: ${msg}\n\n`);
    printUsage();
    process.stderr.write(`Error: ${msg}\n`);
    return 1;
  }

  if (!cmd) {
    printUsage();
    return 0;
  }

  // === Commands ===

  switch (cmd) {
    case 'list': {
      const rows = cmdList(db, {
        filter: cmdFlags.filter,
        sortPriority: cmdFlags.sortPriority,
        limit: cmdFlags.limit,
      });
      const writer = useCSV ? writeCSV : writeTSV;
      writer(rows, { header: showHeader, headerRow: LIST_HEADER });
      return 0;
    }

    case 'today': {
      const todayStr = formatToday();
      const conditions = ['i.is_deleted = 0', 'i.is_completed = 0', 'i.due_date = ?'];
      const params = [todayStr];

      if (cmdFlags.filter) {
        conditions.push("(i.content LIKE ? OR i.labels_json LIKE ?)");
        params.push(`%${cmdFlags.filter}%`, `%${cmdFlags.filter}%`);
      }

      const sql = `
        SELECT i.*, p.name as project_name
        FROM items i
        LEFT JOIN projects p ON i.project_id = p.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY i.item_order ASC, i.created_at ASC
      `;
      let rows = db.prepare(sql).all(...params);

      if (rows.length === 0) {
        process.stderr.write(NO_TASKS_TODAY + '\n');
        return 0;
      }

      if (cmdFlags.sortPriority) {
        rows = [...rows].sort((a, b) => b.priority - a.priority);
      }

      if (cmdFlags.limit && cmdFlags.limit > 0) {
        rows = rows.slice(0, cmdFlags.limit);
      }

      const formatted = rows.map(row => formatListRow(db, row));
      const writer = useCSV ? writeCSV : writeTSV;
      writer(formatted, { header: showHeader, headerRow: LIST_HEADER });
      return 0;
    }

    case 'completed-list': {
      const conditions = ['i.is_deleted = 0', 'i.is_completed = 1'];
      const params = [];

      if (cmdFlags.filter) {
        conditions.push("(i.content LIKE ? OR i.labels_json LIKE ?)");
        params.push(`%${cmdFlags.filter}%`, `%${cmdFlags.filter}%`);
      }

      const sql = `
        SELECT i.id, i.content, i.completed_at, i.project_id, p.name as project_name
        FROM items i
        LEFT JOIN projects p ON i.project_id = p.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY i.completed_at DESC
      `;
      const rows = db.prepare(sql).all(...params);
      // completed.go:42-47 writes [IdFormat, CompletedDateFormat, ProjectFormat,
      // ContentFormat]. ProjectFormat -> "#name" or literal "Unknown" (no '#').
      const formatted = rows.map(r => [
        r.id,
        r.completed_at || '',
        projectFormat(db, r.project_id),
        r.content,
      ]);
      const writer = useCSV ? writeCSV : writeTSV;
      writer(formatted, { header: showHeader, headerRow: ['ID', 'CompletedDate', 'Project', 'Content'] });
      return 0;
    }

    case 'show': {
      const result = cmdShow(db, positional);
      if (result.error) {
        process.stderr.write('Error: ' + result.error + '\n');
        return 1;
      }
      writeKV(result.kv);
      return 0;
    }

    case 'add': {
      const result = cmdAdd(db, positional, cmdFlags);
      if (result.error) {
        process.stderr.write('Error: ' + result.error + '\n');
        return 1;
      }
      // Real CLI does Sync which doesn't print anything visible
      // We print a brief confirmation for scripting convenience
      return 0;
    }

    case 'quick': {
      // quick.go: same as add, but the content is all positional args joined
      const content = positional.join(' ');
      if (!content) {
        process.stderr.write('Error: command failed\n');
        return 1;
      }
      const result = cmdAdd(db, [content], cmdFlags);
      if (result.error) {
        process.stderr.write('Error: ' + result.error + '\n');
        return 1;
      }
      return 0;
    }

    case 'modify': {
      const result = cmdModify(db, positional, cmdFlags);
      if (result.error) {
        process.stderr.write('Error: ' + result.error + '\n');
        return 1;
      }
      return 0;
    }

    case 'close': {
      const result = cmdClose(db, positional);
      if (result.error) {
        process.stderr.write('Error: ' + result.error + '\n');
        return 1;
      }
      return 0;
    }

    case 'delete': {
      const result = cmdDelete(db, positional);
      if (result.error) {
        process.stderr.write('Error: ' + result.error + '\n');
        return 1;
      }
      return 0;
    }

    case 'reopen': {
      const result = cmdReopen(db, positional);
      if (result.error) {
        process.stderr.write('Error: ' + result.error + '\n');
        return 1;
      }
      return 0;
    }

    case 'projects': {
      const rows = cmdProjects(db);
      const writer = useCSV ? writeCSV : writeTSV;
      writer(rows, { header: showHeader, headerRow: PROJECTS_HEADER });
      return 0;
    }

    case 'add-project': {
      const result = cmdAddProject(db, positional, cmdFlags);
      if (result.error) {
        process.stderr.write('Error: ' + result.error + '\n');
        return 1;
      }
      return 0;
    }

    case 'labels': {
      const rows = cmdLabels(db);
      const writer = useCSV ? writeCSV : writeTSV;
      writer(rows, { header: showHeader, headerRow: LABELS_HEADER });
      return 0;
    }

    case 'filters': {
      const rows = cmdFilters(db);
      const writer = useCSV ? writeCSV : writeTSV;
      writer(rows, { header: showHeader, headerRow: FILTERS_HEADER });
      return 0;
    }

    case 'sections': {
      return dispatchSections(db, subcommand, positional, cmdFlags, globalFlags);
    }

    case 'sync': {
      cmdSync();
      return 0;
    }

    case 'karma': {
      const session = db.prepare('SELECT karma FROM auth_session LIMIT 1').get();
      process.stdout.write(String(session?.karma ?? 0) + '\n');
      return 0;
    }

    default:
      // urfave/cli has no command "<x>" and no CommandNotFound handler, so it
      // falls through to ShowCommandHelp, which prints "No help topic for '<x>'"
      // to stderr and exits 3 (captured from the real binary).
      process.stderr.write(`No help topic for '${command}'\n`);
      return 3;
  }
}

function dispatchSections(db, subcommand, positional, cmdFlags, globalFlags) {
  const useCSV = globalFlags.csv;
  const showHeader = globalFlags.header;

  const sub = subcommand || 'list';

  switch (sub) {
    case 'list': {
      const rows = cmdSectionsList(db);
      const writer = useCSV ? writeCSV : writeTSV;
      writer(rows, { header: showHeader, headerRow: SECTIONS_HEADER });
      return 0;
    }
    case 'add': {
      const result = cmdSectionsAdd(db, positional, cmdFlags);
      if (result.error) { process.stderr.write('Error: ' + result.error + '\n'); return 1; }
      return 0;
    }
    case 'delete': {
      const result = cmdSectionsDelete(db, positional);
      if (result.error) { process.stderr.write('Error: ' + result.error + '\n'); return 1; }
      return 0;
    }
    case 'archive': {
      const result = cmdSectionsArchive(db, positional);
      if (result.error) { process.stderr.write('Error: ' + result.error + '\n'); return 1; }
      return 0;
    }
    case 'unarchive': {
      const result = cmdSectionsUnarchive(db, positional);
      if (result.error) { process.stderr.write('Error: ' + result.error + '\n'); return 1; }
      return 0;
    }
    case 'update': {
      const result = cmdSectionsUpdate(db, positional, cmdFlags);
      if (result.error) { process.stderr.write('Error: ' + result.error + '\n'); return 1; }
      return 0;
    }
    case 'move': {
      const result = cmdSectionsMove(db, positional, cmdFlags);
      if (result.error) { process.stderr.write('Error: ' + result.error + '\n'); return 1; }
      return 0;
    }
    case 'reorder': {
      const result = cmdSectionsReorder(db, positional);
      if (result.error) { process.stderr.write('Error: ' + result.error + '\n'); return 1; }
      return 0;
    }
    default:
      process.stderr.write(`Error: unknown sections subcommand "${sub}"\n`);
      return 1;
  }
}

/**
 * Resolve command aliases to canonical names.
 */
function resolveAlias(cmd) {
  if (!cmd) return null;
  const aliases = {
    'l': 'list',
    'a': 'add',
    'm': 'modify',
    'c': 'close',
    'd': 'delete',
    's': 'sync',
    'q': 'quick',
    'ap': 'add-project',
    'cl': 'completed-list',
    'c-l': 'completed-list',
    'tod': 'today',
    'h': 'help',
  };
  return aliases[cmd] || cmd;
}

/**
 * Get today's date as YYYY-MM-DD string for comparison.
 */
function formatToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Print usage help. Byte-identical to urfave/cli's ShowAppHelp output for the
 * real todoist app (captured from the binary). Commands and global options are
 * left-justified into columns; the version flag is absent because upstream sets
 * App.Version="" which makes urfave hide it. Goes to stdout, exit 0.
 */
function printUsage() {
  process.stdout.write(`NAME:
   todoist - Todoist CLI Client

USAGE:
   todoist [global options] command [command options] [arguments...]

COMMANDS:
   list, l                  Show all tasks
   show                     Show task detail
   completed-list, c-l, cl  Show all completed tasks (only premium user)
   today, tod               Show tasks due today
   add, a                   Add task
   modify, m                Modify task
   close, c                 Close task
   reopen                   Reopen (uncomplete) a closed task
   delete, d                Delete task
   labels                   Show all labels
   filters                  Show all filters
   projects                 Show all projects
   add-project, ap          Add new project
   sections                 Manage sections
   karma                    Show karma
   sync, s                  Sync cache
   quick, q                 Quick add a task
   version                  Show version information
   help, h                  Shows a list of commands or help for one command

GLOBAL OPTIONS:
   --header             output with header (default: false)
   --color              colorize output (default: false)
   --csv                output in CSV format (default: false)
   --debug              output logs (default: false)
   --namespace          display parent task like namespace (default: false)
   --indent             display children task with indent (default: false)
   --project-namespace  display parent project like namespace (default: false)
   --help, -h           show help
`);
}
