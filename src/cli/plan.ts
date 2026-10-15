/**
 * What `init` will do to a project, worked out before it does any of it:
 * the files to create, the edits to make, and what it leaves alone and why.
 * A file that is there is never overwritten; the three it edits,
 * `package.json`, `.gitignore` and a `tsconfig.json` that is plain JSON, only
 * gain what they lack, and each edit carries the diff it is shown as.
 */
import type {Detection, Manifest} from './detect.ts';
import type {Choices} from './templates.ts';
import {deviceExampleTest, deviceVitestConfig, harnessConfig, IGNORED, MCP_FILES, MCP_SERVER, platformTest, scripts, TYPES, vitestConfig} from './templates.ts';

export type Step =
  /** A file that is not there, written whole. */
  | {kind: 'create'; path: string; content: string}
  /** A file that is there, with what it gains, and the diff from what it was. */
  | {kind: 'edit'; path: string; content: string; diff: string}
  /** A file left as it is, and what init would have written or added. */
  | {kind: 'keep'; path: string; why: string; content?: string}
  /** A change init cannot make itself, printed for a person to make. */
  | {kind: 'print'; path: string; why: string; content: string};

/** A file the package ships for a project to copy, such as the skill's, with the version it came from. */
export interface Shipped {
  path: string;
  content: string;
}

/** The project as init sees it: the text of a file, where it is there. */
export type Reader = (path: string) => string | undefined;

/** The indent a JSON file was written with, so an edit keeps it. */
export function indentOf(text: string): string | number {
  const indented = text.match(/^[{[]\s*\n([ \t]+)\S/);
  return indented?.[1] ?? 2;
}

/** A JSON value written as the file it came from was: the same indent, and a newline at the end where it had one. */
function rewrite(original: string, value: unknown): string {
  return `${JSON.stringify(value, null, indentOf(original))}${original.endsWith('\n') ? '\n' : ''}`;
}

/**
 * The lines two texts share, by the longest common subsequence: the edit
 * script a unified diff is drawn from. Small files only, which is all init
 * edits.
 */
function editScript(before: string[], after: string[]): {kind: ' ' | '-' | '+'; line: string}[] {
  const rows = before.length;
  const columns = after.length;
  const longest: number[][] = Array.from({length: rows + 1}, () => Array.from({length: columns + 1}, () => 0));
  for (let row = rows - 1; row >= 0; row--) {
    for (let column = columns - 1; column >= 0; column--) {
      longest[row]![column] = before[row] === after[column] ? longest[row + 1]![column + 1]! + 1 : Math.max(longest[row + 1]![column]!, longest[row]![column + 1]!);
    }
  }
  const script: {kind: ' ' | '-' | '+'; line: string}[] = [];
  let row = 0;
  let column = 0;
  while (row < rows || column < columns) {
    if (row < rows && column < columns && before[row] === after[column]) {
      script.push({kind: ' ', line: before[row++]!});
      column++;
    } else if (row < rows && (column === columns || longest[row + 1]![column]! >= longest[row]![column + 1]!)) {
      // What goes comes before what replaces it, as a unified diff shows it.
      script.push({kind: '-', line: before[row++]!});
    } else {
      script.push({kind: '+', line: after[column++]!});
    }
  }
  return script;
}

/** A unified diff of a file, with three lines of context about each change. */
export function unifiedDiff(path: string, before: string, after: string): string {
  const split = (text: string) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));
  const script = editScript(split(before), split(after));
  const changed = script.map((step, at) => (step.kind === ' ' ? -1 : at)).filter(at => at >= 0);
  if (changed.length === 0) return '';
  // Each change with its context, runs that touch merged into one hunk.
  const hunks: [number, number][] = [];
  for (const at of changed) {
    const from = Math.max(0, at - 3);
    const to = Math.min(script.length, at + 4);
    const last = hunks.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else hunks.push([from, to]);
  }
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  for (const [from, to] of hunks) {
    const oldStart = script.slice(0, from).filter(step => step.kind !== '+').length;
    const newStart = script.slice(0, from).filter(step => step.kind !== '-').length;
    const body = script.slice(from, to);
    const oldCount = body.filter(step => step.kind !== '+').length;
    const newCount = body.filter(step => step.kind !== '-').length;
    // A side with no lines names the line before it, and one with one line leaves out its count, as diff writes them.
    const range = (start: number, count: number) => (count === 1 ? `${start + 1}` : `${count ? start + 1 : start},${count}`);
    lines.push(`@@ -${range(oldStart, oldCount)} +${range(newStart, newCount)} @@`, ...body.map(step => `${step.kind}${step.line}`));
  }
  return `${lines.join('\n')}\n`;
}

/** A file to write, where it is not there, or left alone and said so. */
function created(read: Reader, path: string, content: string, others: string[] = []): Step {
  const there = [path, ...others].find(each => read(each) !== undefined);
  return there ? {kind: 'keep', path: there, why: `${there} is there, so init leaves it as it is`, content} : {kind: 'create', path, content};
}

/** `package.json` with the scripts it lacks. */
function scriptsStep(read: Reader, choices: Choices): Step {
  const text = read('package.json') as string;
  const manifest = JSON.parse(text) as Manifest;
  const wanted = scripts(choices);
  const missing = Object.entries(wanted).filter(([name]) => manifest.scripts?.[name] === undefined);
  if (missing.length === 0) return {kind: 'keep', path: 'package.json', why: `package.json has ${Object.keys(wanted).join(', ')} among its scripts already`};
  const content = rewrite(text, {...manifest, scripts: {...manifest.scripts, ...Object.fromEntries(missing)}});
  return {kind: 'edit', path: 'package.json', content, diff: unifiedDiff('package.json', text, content)};
}

/** `tsconfig.json` with the types it lacks, where it is plain JSON; a file with comments gets the snippet to add by hand. */
function typesStep(read: Reader): Step | null {
  const text = read('tsconfig.json');
  if (text === undefined) return null;
  const snippet = `{"compilerOptions": {"types": ${JSON.stringify(TYPES)}}}`;
  let config: {compilerOptions?: {types?: string[]}};
  try {
    config = JSON.parse(text) as typeof config;
  } catch {
    return {kind: 'print', path: 'tsconfig.json', why: 'tsconfig.json is not plain JSON, as one with comments is not, so init cannot edit it; add the types by hand', content: snippet};
  }
  const types = config.compilerOptions?.types ?? [];
  const missing = TYPES.filter(each => !types.includes(each));
  if (missing.length === 0) return {kind: 'keep', path: 'tsconfig.json', why: 'tsconfig.json has the types already'};
  const content = rewrite(text, {...config, compilerOptions: {...config.compilerOptions, types: [...types, ...missing]}});
  return {kind: 'edit', path: 'tsconfig.json', content, diff: unifiedDiff('tsconfig.json', text, content)};
}

/** `.gitignore` with the lines it lacks, or new with them. */
function ignoreStep(read: Reader): Step {
  const text = read('.gitignore');
  if (text === undefined) return {kind: 'create', path: '.gitignore', content: `${IGNORED.join('\n')}\n`};
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const missing = IGNORED.filter(line => !lines.includes(line) && !lines.includes(line.replace(/\/$/, '')));
  if (missing.length === 0) return {kind: 'keep', path: '.gitignore', why: '.gitignore has the harness folder already'};
  const content = `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n`;
  return {kind: 'edit', path: '.gitignore', content, diff: unifiedDiff('.gitignore', text, content)};
}

/**
 * A coding agent's MCP config with the server in it: new where there is
 * none, merged where there is one, every other server kept, and left where
 * it has the entry already. One that is not plain JSON gets the entry to
 * add by hand.
 */
function mcpStep(read: Reader, file: string): Step {
  const text = read(file);
  const entry = {mcpServers: {'expo-harness': MCP_SERVER}};
  if (text === undefined) return {kind: 'create', path: file, content: `${JSON.stringify(entry, null, 2)}\n`};
  let config: unknown;
  try {
    config = JSON.parse(text);
  } catch {
    config = undefined;
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return {kind: 'print', path: file, why: `${file} is not a plain JSON object, so init cannot edit it; add the server to its mcpServers by hand`, content: JSON.stringify(entry)};
  }
  const servers = (config as {mcpServers?: Record<string, unknown>}).mcpServers ?? {};
  if (JSON.stringify(servers['expo-harness']) === JSON.stringify(MCP_SERVER)) return {kind: 'keep', path: file, why: `${file} has the expo-harness server already`};
  const content = rewrite(text, {...config, mcpServers: {...servers, 'expo-harness': MCP_SERVER}});
  return {kind: 'edit', path: file, content, diff: unifiedDiff(file, text, content)};
}

/** The version a copy of a skill file says it came from. */
export function versionIn(text: string): string | null {
  return text.match(/^\s*version:\s*["']?([^"'\s]+)/m)?.[1] ?? null;
}

/** A shipped file copied into the project: new where it is not there, refreshed where its version is older, and left where it is current. */
function shippedStep(read: Reader, file: Shipped): Step {
  const text = read(file.path);
  if (text === undefined) return {kind: 'create', path: file.path, content: file.content};
  if (text === file.content) return {kind: 'keep', path: file.path, why: `${file.path} is the one this version ships`};
  const ours = versionIn(file.content);
  const theirs = versionIn(text);
  if (!ours || ours === theirs) return {kind: 'keep', path: file.path, why: `${file.path} has been changed, so init leaves it as it is`};
  return {kind: 'edit', path: file.path, content: file.content, diff: unifiedDiff(file.path, text, file.content)};
}

/** Everything init would do, in the order it shows it. */
export function planInit(detection: Detection, choices: Choices, read: Reader, shipped: Shipped[] = []): Step[] {
  const steps: Step[] = [created(read, 'vitest.config.mts', vitestConfig(choices), ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs', 'vitest.config.cts'])];
  if (choices.device) {
    steps.push(created(read, 'vitest.config.device.mts', deviceVitestConfig(choices)));
    steps.push(created(read, 'harness.config.ts', harnessConfig(detection, choices), ['harness.config.mts', 'harness.config.js', 'harness.config.mjs']));
  }
  if (!detection.hasTests) steps.push(created(read, 'src/platform.test.ts', platformTest()));
  if (choices.device) steps.push(created(read, 'device/example.test.ts', deviceExampleTest()));
  steps.push(scriptsStep(read, choices));
  const types = typesStep(read);
  if (types) steps.push(types);
  steps.push(ignoreStep(read));
  if (choices.agent) steps.push(...shipped.map(file => shippedStep(read, file)));
  if (choices.mcp) steps.push(...MCP_FILES.map(file => mcpStep(read, file)));
  return steps;
}
