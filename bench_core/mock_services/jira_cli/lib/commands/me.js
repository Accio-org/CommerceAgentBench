/**
 * me.js — `jira me` command.
 * Prints the current login user.
 */

import { currentUser } from "../auth.js";

export function run() {
  process.stdout.write(currentUser() + "\n");
}
