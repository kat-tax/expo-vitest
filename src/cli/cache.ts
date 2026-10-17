/**
 * `expo-harness cache`: the agent's replay cache from the command line.
 * `ls` lists its entries, newest first; `stats` counts them; `clear`
 * empties the folder. The folder is the harness config's `cache.dir`,
 * else `.harness/cache`; the entry point works it out.
 */
import {cacheStats, clearCache, listEntries} from '../agent/cache.ts';

/** How long ago something was, in the largest unit that fits. */
export function ageOf(recordedAt: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(recordedAt)) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

const entriesIn = (count: number) => `${count} ${count === 1 ? 'entry' : 'entries'}`;

/** What `cache` prints for its arguments, and the exit code it ends with. */
export function cacheText(args: string[], dir: string, now: number = Date.now()): {code: number; text: string} {
  const [action = 'ls', ...rest] = args;
  if (rest.length > 0 || !['ls', 'stats', 'clear'].includes(action)) return {code: 2, text: 'cache takes ls, stats or clear'};
  if (action === 'clear') return {code: 0, text: `removed ${entriesIn(clearCache(dir))} from ${dir}`};
  if (action === 'stats') {
    const {entries, bytes} = cacheStats(dir);
    return {code: 0, text: `${entriesIn(entries)}, ${bytes} bytes, in ${dir}`};
  }
  const entries = listEntries(dir);
  if (entries.length === 0) return {code: 0, text: `no entries in ${dir}`};
  // The key's start, which tells entries apart, how old each is, and what it replays.
  const lines = entries.map(entry => [entry.key.slice(0, 12), ageOf(entry.recordedAt, now).padStart(8), entry.platform.padEnd(7), entry.test, JSON.stringify(entry.instruction)].join('  '));
  return {code: 0, text: lines.join('\n')};
}

export function cache(args: string[], dir: string): number {
  const {code, text} = cacheText(args, dir);
  if (code === 0) console.log(text);
  else console.error(text);
  return code;
}
