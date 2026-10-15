import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it, vi} from 'vitest';
import {guide, guideText} from './guide.ts';

function skill(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-vitest-guide-'));
  fs.writeFileSync(path.join(folder, 'SKILL.md'), '---\nname: expo-vitest\n---\n# expo-vitest\nThe overview.\n');
  fs.writeFileSync(path.join(folder, 'device.md'), '# Device tests\nAgainst a running app.\n');
  fs.writeFileSync(path.join(folder, 'harness.md'), 'no heading here\n');
  return folder;
}

describe('the guide', () => {
  it('prints the overview, or one topic', () => {
    const folder = skill();
    expect(guideText([], folder)).toEqual({code: 0, text: '---\nname: expo-vitest\n---\n# expo-vitest\nThe overview.\n'});
    expect(guideText(['device'], folder)).toEqual({code: 0, text: '# Device tests\nAgainst a running app.\n'});
  });

  it('lists the topics with their headings', () => {
    expect(guideText(['--list'], skill())).toEqual({code: 0, text: 'the topics, each printed by guide <topic>:\n  device     Device tests\n  harness    '});
  });

  it('says which topics there are when asked for one there is not, or for two', () => {
    const folder = skill();
    expect(guideText(['agents'], folder)).toEqual({code: 2, text: 'there is no topic agents; the topics are device, harness'});
    expect(guideText(['device', 'harness'], folder)).toEqual({code: 2, text: 'guide takes one topic, or --list; the topics are device, harness'});
  });

  it('says so where the package ships no skill', () => {
    expect(guideText([], path.join(os.tmpdir(), 'expo-vitest-no-guide'))).toEqual({code: 1, text: 'this copy of expo-vitest ships no skill to print'});
  });

  it('prints to the output, or the reason to the error output', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const folder = skill();
      expect(guide(['device'], folder)).toBe(0);
      expect(log).toHaveBeenCalledWith('# Device tests\nAgainst a running app.\n');
      expect(guide(['no-such-topic'], folder)).toBe(2);
      expect(error).toHaveBeenCalledWith('there is no topic no-such-topic; the topics are device, harness');
      expect(typeof guide(['--list'])).toBe('number');
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
