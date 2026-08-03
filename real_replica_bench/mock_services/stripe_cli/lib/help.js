/**
 * help.js — help / version / resources 文本。
 * 静态文本服务自 lib/help_text/ 的固定副本（与 golden/ 同源真品捕获，做回归保护）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEXT = join(dirname(fileURLToPath(import.meta.url)), "help_text");

function emit(file) {
  process.stdout.write(readFileSync(join(TEXT, file), "utf8"));
}

// 真品 --help 文案随登录态变：已登录省略 "Before using the CLI, you'll need to login" 引导段
export function printTopLevelHelp(authed) {
  emit(authed ? "top_authed.txt" : "top.txt");
}

export function printResources() {
  emit("resources.txt");
}

export function printResourceUsage(resource) {
  try {
    emit(`${resource}_usage.txt`);
    return true;
  } catch {
    return false;
  }
}

export function printOperationHelp(resource, operation) {
  const filename = operation ? `${resource}_${operation}.txt` : `${resource}.txt`;
  try {
    process.stdout.write(readFileSync(join(TEXT, "ops", filename), "utf8"));
    return true;
  } catch {
    return printResourceUsage(resource);
  }
}

export function printVersion() {
  // 真品输出 "stripe version 1.42.1\n\n"（尾部空行是 version-check 的分隔行；联网行已略）
  process.stdout.write("stripe version 1.42.1\n\n");
}
