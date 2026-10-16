import {describe, expect, it} from 'vitest';
import type {Detection} from './detect.ts';
import type {Reader, Shipped, Step} from './plan.ts';
import {indentOf, planInit, unifiedDiff, versionIn} from './plan.ts';
import type {Choices} from './templates.ts';

const found = (extra: Partial<Detection> = {}): Detection => ({
  manager: 'npm',
  expoSdk: 57,
  rntl: 14,
  platforms: ['web', 'android', 'ios'],
  typescript: true,
  identity: {},
  hasTests: false,
  warnings: [],
  ...extra,
});
const chose = (extra: Partial<Choices> = {}): Choices => ({platforms: ['web', 'android'], device: true, agent: false, ...extra});
const project = (files: Record<string, string>): Reader => path => files[path];
const manifest = `{\n  "name": "shop",\n  "scripts": {\n    "start": "expo start"\n  }\n}\n`;

describe('the plan for a new project', () => {
  it('creates the configs and the examples, and edits the three files it may', () => {
    const steps = planInit(found(), chose(), project({'package.json': manifest, 'tsconfig.json': '{\n  "extends": "expo/tsconfig.base"\n}\n'}));
    expect(steps.map(step => [step.kind, step.path])).toEqual([
      ['create', 'vitest.config.mts'],
      ['create', 'vitest.config.device.mts'],
      ['create', 'harness.config.ts'],
      ['create', 'src/platform.test.ts'],
      ['create', 'device/example.test.ts'],
      ['edit', 'package.json'],
      ['edit', 'tsconfig.json'],
      ['create', '.gitignore'],
    ]);
    const scripts = steps.find(step => step.path === 'package.json');
    expect(scripts?.kind === 'edit' && JSON.parse(scripts.content).scripts).toEqual({
      start: 'expo start',
      test: 'vitest run',
      'test:watch': 'vitest',
      'test:device': 'vitest run --config vitest.config.device.mts',
    });
    expect(scripts?.kind === 'edit' && scripts.diff).toBe(
      [
        '--- a/package.json',
        '+++ b/package.json',
        '@@ -1,6 +1,9 @@',
        ' {',
        '   "name": "shop",',
        '   "scripts": {',
        '-    "start": "expo start"',
        '+    "start": "expo start",',
        '+    "test": "vitest run",',
        '+    "test:watch": "vitest",',
        '+    "test:device": "vitest run --config vitest.config.device.mts"',
        '   }',
        ' }',
        '',
      ].join('\n'),
    );
    const types = steps.find(step => step.path === 'tsconfig.json');
    expect(types?.kind === 'edit' && JSON.parse(types.content)).toEqual({extends: 'expo/tsconfig.base', compilerOptions: {types: ['expo-vitest/types']}});
    expect(steps.at(-1)).toEqual({kind: 'create', path: '.gitignore', content: '.harness/\n'});
  });

  it('leaves out the device files without device tests, and the example where there are tests', () => {
    const paths = planInit(found({hasTests: true}), chose({device: false}), project({'package.json': manifest})).map(step => step.path);
    expect(paths).toEqual(['vitest.config.mts', 'package.json', '.gitignore']);
  });
});

describe('a project that has some of it', () => {
  it('keeps every file that is there, and says what init would have written', () => {
    const steps = planInit(
      found({hasTests: true}),
      chose(),
      project({'package.json': manifest, 'vitest.config.ts': 'mine', 'harness.config.mjs': 'mine', 'vitest.config.device.mts': 'mine', 'device/example.test.ts': 'mine'}),
    );
    const kept = steps.filter(step => step.kind === 'keep');
    expect(kept.map(step => step.path)).toEqual(['vitest.config.ts', 'vitest.config.device.mts', 'harness.config.mjs', 'device/example.test.ts']);
    expect(kept[0]).toMatchObject({why: 'vitest.config.ts is there, so init leaves it as it is', content: expect.stringContaining('expoProjects')});
  });

  it('adds only the scripts that are missing, and nothing when none are', () => {
    const all = JSON.stringify({scripts: {test: 'jest', 'test:watch': 'x', 'test:device': 'y'}}, null, 2);
    expect(planInit(found(), chose(), project({'package.json': all})).find(step => step.path === 'package.json')).toEqual({
      kind: 'keep',
      path: 'package.json',
      why: 'package.json has test, test:watch, test:device among its scripts already',
    });
  });

  it('prints the types for a tsconfig.json that is not plain JSON, and keeps one that has them', () => {
    const commented = planInit(found(), chose(), project({'package.json': manifest, 'tsconfig.json': '{\n  // strict\n  "compilerOptions": {}\n}\n'}));
    expect(commented.find(step => step.path === 'tsconfig.json')).toEqual({
      kind: 'print',
      path: 'tsconfig.json',
      why: 'tsconfig.json is not plain JSON, as one with comments is not, so init cannot edit it; add the types by hand',
      content: '{"compilerOptions": {"types": ["expo-vitest/types"]}}',
    });
    const typed = JSON.stringify({compilerOptions: {types: ['vitest-expo/types', 'expo-vitest/types', 'node']}});
    expect(planInit(found(), chose(), project({'package.json': manifest, 'tsconfig.json': typed})).find(step => step.path === 'tsconfig.json')?.kind).toBe('keep');
    const partly = JSON.stringify({compilerOptions: {strict: true, types: ['vitest-expo/types']}}, null, '\t');
    const edited = planInit(found(), chose(), project({'package.json': manifest, 'tsconfig.json': partly})).find(step => step.path === 'tsconfig.json');
    expect(edited?.kind === 'edit' && edited.content).toBe(JSON.stringify({compilerOptions: {strict: true, types: ['vitest-expo/types', 'expo-vitest/types']}}, null, '\t'));
  });

  it("adds the harness's folder to a .gitignore without it, and keeps one with it", () => {
    const edited = planInit(found(), chose(), project({'package.json': manifest, '.gitignore': 'node_modules'})).find(step => step.path === '.gitignore');
    expect(edited).toEqual({kind: 'edit', path: '.gitignore', content: 'node_modules\n.harness/\n', diff: '--- a/.gitignore\n+++ b/.gitignore\n@@ -1 +1,2 @@\n node_modules\n+.harness/\n'});
    const empty = planInit(found(), chose(), project({'package.json': manifest, '.gitignore': ''})).find(step => step.path === '.gitignore');
    expect(empty?.kind === 'edit' && empty.content).toBe('.harness/\n');
    for (const has of ['.harness/\n', 'dist\r\n.harness\r\n']) {
      expect(planInit(found(), chose(), project({'package.json': manifest, '.gitignore': has})).find(step => step.path === '.gitignore')?.kind).toBe('keep');
    }
  });
});

describe('the files the package ships', () => {
  const skill: Shipped = {path: '.claude/skills/expo-vitest/SKILL.md', content: '---\nname: expo-vitest\nmetadata:\n  version: 0.2.0\n---\nNew text\n'};
  const plan = (files: Record<string, string>, agent = true, shipped = [skill]) => planInit(found(), chose({agent}), project({'package.json': manifest, ...files}), shipped).filter(step => step.path === skill.path);

  it('are copied where they are not there, with the coding-agent files only', () => {
    expect(plan({})).toEqual([{kind: 'create', path: skill.path, content: skill.content}]);
    expect(plan({}, false)).toEqual([]);
  });

  it('are refreshed where the copy is from an older version, and left where it is current or was changed', () => {
    const old = skill.content.replace('0.2.0', '0.1.0').replace('New text', 'Old text');
    expect(plan({[skill.path]: old})[0]).toMatchObject({kind: 'edit', diff: expect.stringContaining('-  version: 0.1.0\n+  version: 0.2.0')});
    expect(plan({[skill.path]: skill.content})[0]).toMatchObject({kind: 'keep', why: `${skill.path} is the one this version ships`});
    expect(plan({[skill.path]: skill.content.replace('New text', 'Edited')})[0]).toMatchObject({kind: 'keep', why: `${skill.path} has been changed, so init leaves it as it is`});
    const unversioned = {path: skill.path, content: 'no front matter\n'};
    expect(plan({[skill.path]: old}, true, [unversioned])[0]?.kind).toBe('keep');
  });

  it('say which version they came from', () => {
    expect(versionIn('metadata:\n  version: "0.2.0"\n')).toBe('0.2.0');
    expect(versionIn('version: 1.0.0')).toBe('1.0.0');
    expect(versionIn('nothing')).toBeNull();
  });
});

describe("the MCP server's files", () => {
  const entry = {type: 'stdio', command: 'npx', args: ['expo-harness', 'mcp']};
  const plan = (files: Record<string, string>, mcp = true) => planInit(found(), chose({mcp}), project({'package.json': manifest, ...files})).filter(step => step.path.endsWith('mcp.json'));
  const written = (step: Step | undefined) => (step && 'content' in step ? (step.content as string) : '');

  it("are written where they are not there, Claude Code's and Cursor's, and only when asked for", () => {
    const steps = plan({});
    expect(steps.map(step => [step.kind, step.path])).toEqual([
      ['create', '.mcp.json'],
      ['create', '.cursor/mcp.json'],
    ]);
    expect(written(steps[0])).toBe(`${JSON.stringify({mcpServers: {'expo-harness': entry}}, null, 2)}\n`);
    expect(plan({}, false)).toEqual([]);
  });

  it('gain the server where they name others, keeping each in its own indent, and are left where they have it', () => {
    const others = '{\n    "mcpServers": {\n        "agent-device": {"command": "agent-device", "args": ["mcp"]}\n    }\n}\n';
    const [merged] = plan({'.mcp.json': others});
    expect(merged?.kind).toBe('edit');
    expect(JSON.parse(written(merged))).toEqual({mcpServers: {'agent-device': {command: 'agent-device', args: ['mcp']}, 'expo-harness': entry}});
    expect(merged && 'diff' in merged ? merged.diff : '').toContain('+        "expo-harness": {');
    const stale = JSON.stringify({mcpServers: {'expo-harness': {command: 'node', args: ['old.js']}}});
    expect(JSON.parse(written(plan({'.mcp.json': stale})[0])).mcpServers['expo-harness']).toEqual(entry);
    expect(JSON.parse(written(plan({'.mcp.json': '{"name": "shop"}'})[0]))).toEqual({name: 'shop', mcpServers: {'expo-harness': entry}});
    expect(plan({'.mcp.json': JSON.stringify({mcpServers: {'expo-harness': entry}})})[0]).toEqual({kind: 'keep', path: '.mcp.json', why: '.mcp.json has the expo-harness server already'});
  });

  it('are left to a person where one is not a plain JSON object', () => {
    for (const text of ['{\n  // the servers\n}\n', '[]', 'null']) {
      expect(plan({'.cursor/mcp.json': text})[1]).toEqual({
        kind: 'print',
        path: '.cursor/mcp.json',
        why: '.cursor/mcp.json is not a plain JSON object, so init cannot edit it; add the server to its mcpServers by hand',
        content: JSON.stringify({mcpServers: {'expo-harness': entry}}),
      });
    }
  });
});

describe('the indent of a JSON file', () => {
  it('is what its first nested line uses, or two spaces', () => {
    expect(indentOf('{\n    "a": 1\n}')).toBe('    ');
    expect(indentOf('{\n\t"a": 1\n}')).toBe('\t');
    expect(indentOf('{"a":1}')).toBe(2);
  });
});

describe('a unified diff', () => {
  it('is nothing between a file and itself', () => {
    expect(unifiedDiff('a', 'x\ny\n', 'x\ny\n')).toBe('');
  });

  it('shows a change with three lines of context, and merges changes whose context touches', () => {
    const before = Array.from({length: 14}, (_, at) => `line ${at + 1}`).join('\n');
    const after = before.replace('line 2\n', 'line two\n').replace('line 5\n', 'line five\n').replace('line 14', 'line fourteen');
    expect(unifiedDiff('f', before, after)).toBe(
      [
        '--- a/f',
        '+++ b/f',
        '@@ -1,8 +1,8 @@',
        ' line 1',
        '-line 2',
        '+line two',
        ' line 3',
        ' line 4',
        '-line 5',
        '+line five',
        ' line 6',
        ' line 7',
        ' line 8',
        '@@ -11,4 +11,4 @@',
        ' line 11',
        ' line 12',
        ' line 13',
        '-line 14',
        '+line fourteen',
        '',
      ].join('\n'),
    );
  });

  it('makes one hunk of two changes whose contexts meet', () => {
    const before = Array.from({length: 12}, (_, at) => `line ${at + 1}`).join('\n');
    const after = before.replace('line 5\n', 'line five\n').replace('line 12', 'line twelve');
    expect(unifiedDiff('f', before, after).match(/^@@/gm)).toHaveLength(1);
  });

  it('names the line before a side with nothing in the hunk', () => {
    expect(unifiedDiff('new', '', 'a\nb\n')).toBe('--- a/new\n+++ b/new\n@@ -0,0 +1,2 @@\n+a\n+b\n');
    expect(unifiedDiff('gone', 'a\nb\n', '')).toBe('--- a/gone\n+++ b/gone\n@@ -1,2 +0,0 @@\n-a\n-b\n');
  });
});
