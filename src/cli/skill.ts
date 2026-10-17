/**
 * The skill this package ships for coding agents: the files under
 * `skills/expo-vitest/` in the package, read from wherever the package is,
 * source or installed, since both keep the folder at the package's root.
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Shipped} from './plan.ts';

/** The skill's folder in the package. */
export const SKILL_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'expo-vitest');

/** Where a project keeps the skill, which Claude Code reads. */
export const SKILL_HOME = '.claude/skills/expo-vitest';

/** The skill's files by name, `SKILL.md` first; none where the package has no skill folder. */
export function skillNames(folder: string = SKILL_FOLDER): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(folder).filter(name => name.endsWith('.md'));
  } catch {
    return [];
  }
  const rest = names.filter(name => name !== 'SKILL.md').sort((a, b) => a.localeCompare(b));
  return names.includes('SKILL.md') ? ['SKILL.md', ...rest] : rest;
}

/** The skill's files as init copies them into a project. */
export function skillFiles(folder: string = SKILL_FOLDER): Shipped[] {
  return skillNames(folder).map(name => ({path: `${SKILL_HOME}/${name}`, content: fs.readFileSync(path.join(folder, name), 'utf8')}));
}
