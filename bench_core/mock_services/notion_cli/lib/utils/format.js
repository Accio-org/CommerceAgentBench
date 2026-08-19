import Table from 'cli-table3';
import chalk from 'chalk';

export function formatOutput(data, options = {}) {
  if (options.json) return JSON.stringify(data, null, 2);
  if (options.plain) return toPlainText(data);
  if (Array.isArray(data)) return toTable(data);
  return JSON.stringify(data, null, 2);
}

function toPlainText(data) {
  if (!Array.isArray(data)) data = [data];
  if (data.length === 0) return '';
  const keys = Object.keys(data[0]);
  return data.map(row => keys.map(k => row[k] ?? '').join('\t')).join('\n');
}

function toTable(data) {
  if (!Array.isArray(data) || data.length === 0) return 'No results.';
  const keys = Object.keys(data[0]);
  const table = new Table({
    head: keys.map(k => chalk.bold(k)),
    style: { head: [], border: [] },
  });
  for (const row of data) {
    table.push(keys.map(k => {
      const v = row[k];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }));
  }
  return table.toString();
}

export function printSuccess(msg) {
  console.log(chalk.green('✓ ' + msg));
}

export function printError(msg) {
  console.error(chalk.red('✗ ' + msg));
}

export function printInfo(msg) {
  console.log(chalk.blue('ℹ ' + msg));
}
