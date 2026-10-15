/**
 * `expo-vitest guide`: the skill this package ships, printed from the copy
 * that is installed, so it always matches the version in use. `guide` prints
 * the overview, `guide <topic>` one topic, `guide --list` the topics.
 */
import fs from 'node:fs';
import path from 'node:path';
import {SKILL_FOLDER, skillNames} from './skill.ts';

/** What `guide` prints for its arguments, and the exit code it ends with. */
export function guideText(args: string[], folder: string = SKILL_FOLDER): {code: number; text: string} {
  const names = skillNames(folder);
  if (names.length === 0) return {code: 1, text: 'this copy of expo-vitest ships no skill to print'};
  const topics = names.filter(name => name !== 'SKILL.md').map(name => name.replace(/\.md$/, ''));
  const [asked, ...rest] = args;
  if (rest.length) return {code: 2, text: `guide takes one topic, or --list; the topics are ${topics.join(', ')}`};
  if (asked === '--list') {
    const lines = topics.map(topic => {
      const heading = fs.readFileSync(path.join(folder, `${topic}.md`), 'utf8').match(/^#\s+(.+)$/m)?.[1] ?? '';
      return `  ${topic.padEnd(10)} ${heading}`;
    });
    return {code: 0, text: `the topics, each printed by guide <topic>:\n${lines.join('\n')}`};
  }
  const file = asked === undefined ? 'SKILL.md' : `${asked}.md`;
  if (!names.includes(file)) return {code: 2, text: `there is no topic ${asked}; the topics are ${topics.join(', ')}`};
  return {code: 0, text: fs.readFileSync(path.join(folder, file), 'utf8')};
}

export function guide(args: string[], folder: string = SKILL_FOLDER): number {
  const {code, text} = guideText(args, folder);
  if (code === 0) console.log(text);
  else console.error(text);
  return code;
}
