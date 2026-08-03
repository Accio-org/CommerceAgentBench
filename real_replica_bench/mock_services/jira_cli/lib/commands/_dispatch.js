/**
 * _dispatch.js — Command dispatcher for Jira CLI mock.
 * Maps argv to the correct command handler.
 */

import * as initCmd from "./init.js";
import * as issueList from "./issue_list.js";
import * as issueCreate from "./issue_create.js";
import * as issueView from "./issue_view.js";
import * as issueEdit from "./issue_edit.js";
import * as issueMove from "./issue_move.js";
import * as issueAssign from "./issue_assign.js";
import * as issueDelete from "./issue_delete.js";
import * as issueComment from "./issue_comment.js";
import * as issueLink from "./issue_link.js";
import * as issueClone from "./issue_clone.js";
import * as projectList from "./project_list.js";
import * as boardList from "./board_list.js";
import * as sprintList from "./sprint_list.js";
import * as epic from "./epic.js";
import * as me from "./me.js";
import * as open from "./open.js";

import { configExists } from "../auth.js";
import { ERR_CONFIG_MISSING, failMsg } from "../errors.js";

/**
 * Parse argv and dispatch to command handler.
 * @param {string[]} argv - process.argv.slice(2)
 */
export function dispatch(argv) {
  const { command, positional, flags } = parseArgs(argv);

  // `init` does not require config
  if (command === "init") {
    return initCmd.run(flags);
  }

  // All other commands require config to exist. Real CLI emits this via
  // cmdutil.Failed (✗ marker, stderr) at internal/cmd/root/root.go:94.
  if (!configExists()) {
    process.stderr.write(failMsg(ERR_CONFIG_MISSING));
    process.exit(1);
  }

  switch (command) {
    // --- issue commands ---
    case "issue list":
    case "issue ls":
    case "issue search":
      return issueList.run(flags);

    case "issue create":
      return issueCreate.run(flags);

    case "issue view":
    case "issue show":
      return issueView.run(positional[0], flags);

    case "issue edit":
    case "issue update":
    case "issue modify":
      return issueEdit.run(positional[0], flags);

    case "issue move":
    case "issue transition":
    case "issue mv":
      return issueMove.run(positional[0], positional.slice(1).join(" "), flags);

    case "issue assign":
    case "issue asg":
      return issueAssign.run(positional[0], positional[1]);

    case "issue delete":
    case "issue remove":
    case "issue rm":
    case "issue del":
      return issueDelete.run(positional[0], flags);

    case "issue comment add":
      return issueComment.run(positional[0], positional.slice(1).join(" ") || flags.body, flags);

    case "issue link":
      return issueLink.run(positional[0], positional[1], positional.slice(2).join(" "));

    case "issue clone":
      return issueClone.run(positional[0], flags);

    // --- project commands ---
    case "project list":
    case "project ls":
      return projectList.run(flags);

    // --- board commands ---
    case "board list":
    case "board ls":
      return boardList.run(flags);

    // --- sprint commands ---
    case "sprint list":
    case "sprint ls":
      return sprintList.run(positional[0] || null, flags);

    // --- epic commands ---
    case "epic list":
    case "epic ls":
      return epic.runList(positional[0] || null, flags);

    case "epic create":
      return epic.runCreate(flags);

    // --- misc ---
    case "me":
      return me.run();

    case "open":
      return open.run(positional[0] || null, flags);

    case "help":
    case "--help":
    case "-h":
      return printHelp();

    case "version":
    case "--version":
      return printVersion();

    default:
      process.stderr.write(failMsg(`Unknown command: ${command || "(none)"}`));
      printHelp();
      process.exit(1);
  }
}

/**
 * Parse argv into command, positional args, and flags.
 *
 * Supports:
 *   jira issue list --type Bug --status "In Progress" --status Done
 *   jira issue view PROJ-1 --plain
 *   jira issue move PROJ-1 "In Progress"
 *   jira issue comment add PROJ-1 "comment body"
 */
function parseArgs(argv) {
  // Consume leading subcommands (non-flag, no-dash tokens that form the command path)
  const commandParts = [];
  const rest = [];
  let inCommand = true;

  // Known top-level commands and subcommands
  const topLevel = new Set([
    "init", "issue", "project", "board", "sprint", "epic", "me", "open",
    "help", "version", "--help", "-h", "--version",
  ]);
  const issueSubcmds = new Set([
    "list", "ls", "search", "create", "view", "show",
    "edit", "update", "modify", "move", "transition", "mv",
    "assign", "asg", "delete", "remove", "rm", "del",
    "comment", "link", "clone",
  ]);
  const commentSubcmds = new Set(["add"]);
  const entitySubcmds = new Set(["list", "ls", "create"]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // Special case: --help/-h/--version at top level are commands, not flags
    if (inCommand && commandParts.length === 0 && (arg === "--help" || arg === "-h" || arg === "--version")) {
      commandParts.push(arg);
      inCommand = false;
    } else if (inCommand && !arg.startsWith("-")) {
      if (commandParts.length === 0 && topLevel.has(arg)) {
        commandParts.push(arg);
      } else if (commandParts.length === 1 && commandParts[0] === "issue" && issueSubcmds.has(arg)) {
        commandParts.push(arg);
      } else if (commandParts.length === 2 && commandParts[0] === "issue" && commandParts[1] === "comment" && commentSubcmds.has(arg)) {
        commandParts.push(arg);
      } else if (commandParts.length === 1 &&
                 ["project", "board", "sprint", "epic"].includes(commandParts[0]) &&
                 entitySubcmds.has(arg)) {
        commandParts.push(arg);
      } else {
        inCommand = false;
        rest.push(arg);
      }
    } else {
      inCommand = false;
      rest.push(arg);
    }
  }

  const command = commandParts.join(" ");

  // Parse flags and positional args from rest
  const flags = {};
  const positional = [];

  // StringArray flags that can be repeated
  const arrayFlags = new Set(["status", "label", "component"]);
  // Short-to-long flag map
  const shortMap = {
    t: "type", s: "summary", b: "body", y: "priority",
    a: "assignee", l: "label", C: "component", q: "jql",
    n: "name", p: "project",
  };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];

    if (arg === "--") {
      positional.push(...rest.slice(i + 1));
      break;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      let key, val;
      if (eqIdx >= 0) {
        key = arg.slice(2, eqIdx);
        val = arg.slice(eqIdx + 1);
      } else {
        key = arg.slice(2);
        val = undefined;
      }

      // Normalize key: kebab-case to camelCase
      const camelKey = kebabToCamel(key);

      // Boolean flags
      if (["plain", "raw", "csv", "noHeaders", "noTruncate", "reverse",
           "noInput", "force", "insecure", "cascade", "current",
           "prev", "next", "noBrowser"].includes(camelKey)) {
        flags[camelKey] = true;
        continue;
      }

      // Value flags
      if (val === undefined) {
        val = rest[++i];
      }

      if (arrayFlags.has(key) || arrayFlags.has(camelKey.toLowerCase())) {
        const arrKey = camelKey.toLowerCase() === "status" ? "status" :
                       camelKey.toLowerCase() === "label" ? "label" : "component";
        if (!flags[arrKey]) flags[arrKey] = [];
        flags[arrKey].push(val);
      } else {
        flags[camelKey] = val;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const shortKey = arg[1];
      const longKey = shortMap[shortKey];

      if (!longKey) {
        // Try as boolean
        if (shortKey === "n" && command === "open") {
          flags.noBrowser = true;
          continue;
        }
        positional.push(arg);
        continue;
      }

      // Status uses -s for summary in create/edit, status in list
      if (shortKey === "s" && (command === "issue list" || command === "issue ls" || command === "issue search")) {
        const val = rest[++i];
        if (!flags.status) flags.status = [];
        flags.status.push(val);
        continue;
      }

      const val = rest[++i];
      if (arrayFlags.has(longKey)) {
        if (!flags[longKey]) flags[longKey] = [];
        flags[longKey].push(val);
      } else {
        flags[longKey] = val;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

function kebabToCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function printHelp() {
  process.stdout.write(`Usage:
  jira init                                    Initialize configuration
  jira issue list                              List issues (aliases: ls, search)
  jira issue create                            Create an issue
  jira issue view <KEY>                        View an issue (alias: show)
  jira issue edit <KEY>                        Edit an issue (aliases: update, modify)
  jira issue move <KEY> <STATE>                Transition issue (aliases: transition, mv)
  jira issue assign <KEY> <ASSIGNEE>           Assign issue (alias: asg)
  jira issue delete <KEY>                      Delete issue (aliases: remove, rm, del)
  jira issue comment add <KEY> [BODY]          Add a comment
  jira issue link <INWARD> <OUTWARD> <TYPE>    Link two issues
  jira issue clone <KEY>                       Clone an issue
  jira project list                            List projects (alias: ls)
  jira board list                              List boards (alias: ls)
  jira sprint list [SPRINT_ID]                 List sprints (alias: ls)
  jira epic list [EPIC-KEY]                    List epics or issues in epic
  jira epic create                             Create an epic
  jira me                                      Print current user
  jira open [KEY]                              Open issue URL

Use --help with any command for more details.
`);
}

function printVersion() {
  // Real CLI: `jira version` prints v.Info() (internal/version/version.go:20-40):
  //   (Version=%q, GitCommit=%q, CommitDate=%q, GoVersion=%q, Compiler=%q, Platform=%q)
  // The non-Version fields are injected at build time via ldflags and are NOT
  // bit-reproducible offline (GitCommit/CommitDate/GoVersion are unknowable from
  // source). Only the Version field (upstream v1.7.0) is meaningful here.
  process.stdout.write(
    '(Version="v1.7.0", GitCommit="", CommitDate="", GoVersion="", Compiler="gc", Platform="linux/amd64")\n'
  );
}
