import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {versionIn} from './plan.ts';
import {SKILL_FOLDER, SKILL_HOME, skillFiles, skillNames} from './skill.ts';

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('the skill', () => {
  it('is its Markdown files, SKILL.md first, as init copies them into a project', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-skill-'));
    for (const name of ['harness.md', 'SKILL.md', 'agent.md', 'device.md', 'notes.txt']) fs.writeFileSync(path.join(folder, name), `# ${name}\n`);
    expect(skillNames(folder)).toEqual(['SKILL.md', 'agent.md', 'device.md', 'harness.md']);
    expect(skillFiles(folder)[0]).toEqual({path: `${SKILL_HOME}/SKILL.md`, content: '# SKILL.md\n'});
    expect(SKILL_HOME).toBe('.claude/skills/expo-vitest');
    const topics = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-topics-'));
    fs.writeFileSync(path.join(topics, 'device.md'), '');
    expect(skillNames(topics)).toEqual(['device.md']);
  });

  it('is nothing where the package has no skill folder', () => {
    expect(skillNames(path.join(os.tmpdir(), 'expo-vitest-no-skill-here'))).toEqual([]);
    expect(skillFiles(path.join(os.tmpdir(), 'expo-vitest-no-skill-here'))).toEqual([]);
  });

  it('ships with the version of the package it came from, so init can tell a copy is old', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PACKAGE, 'package.json'), 'utf8')) as {version: string; files: string[]};
    const overview = fs.readFileSync(path.join(SKILL_FOLDER, 'SKILL.md'), 'utf8');
    expect(versionIn(overview)).toBe(manifest.version);
    expect(manifest.files).toContain('skills');
  });

  it('opens with a name and a quoted description, and keeps its overview short', () => {
    const overview = fs.readFileSync(path.join(SKILL_FOLDER, 'SKILL.md'), 'utf8');
    expect(overview).toMatch(/^---\nname: expo-vitest\ndescription: "[^"]+"\n/);
    expect(overview.split('\n').length).toBeLessThan(200);
    expect(skillNames()).toEqual(['SKILL.md', 'device.md', 'evidence.md', 'harness.md', 'projects.md']);
  });

  it("is read from the package's root, which is beside both src and dist", () => {
    expect(SKILL_FOLDER).toBe(path.join(PACKAGE, 'skills', 'expo-vitest'));
  });
});
