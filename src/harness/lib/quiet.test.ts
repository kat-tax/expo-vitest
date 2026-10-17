import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import type {DeskRecord, DeskStore} from './quiet.ts';
import {QUIET_SECONDS, desk, fileStore, refusal} from './quiet.ts';

describe('refusal', () => {
  it('lets input go once the machine has been quiet long enough, and where idleness has no meaning', () => {
    expect(refusal('a press', QUIET_SECONDS, false)).toBeNull();
    expect(refusal('a press', 4000, false)).toBeNull();
    expect(refusal('a press', null, false)).toBeNull();
  });

  it('refuses while someone has used the machine lately, saying how to get past it', () => {
    expect(refusal('typing', 2.6, false)).toBe(
      'refusing typing: someone used this machine 3 seconds ago, and synthetic input goes to whatever is in front. ' +
        'Leave it alone for 180 seconds, or pass --force (HARNESS_FORCE=1 in a device test).',
    );
  });

  it('lets anything go when forced', () => {
    expect(refusal('a press', 0, true)).toBeNull();
  });
});

describe('desk', () => {
  const at = 1_000_000;

  it('is the machine idle time until the harness has sent anything', () => {
    expect(desk().quiet(200, at)).toBe(200);
    expect(desk().quiet(null, at)).toBeNull();
  });

  it('does not count its own input as someone using the machine', () => {
    const quiet = desk();
    expect(quiet.quiet(200, at)).toBe(200);
    // A press from at + 1000 to at + 1600, its last event at at + 1500, read 400 ms later.
    quiet.sent(at + 1000, at + 1600);
    expect(quiet.quiet(0.4, at + 1900)).toBe(201.9);
    // And again after a second press, the person's touch still the one from before the first.
    quiet.sent(at + 2000, at + 2500);
    expect(quiet.quiet(0.1, at + 2600)).toBe(202.6);
  });

  it('counts a touch that came after its own input', () => {
    const quiet = desk();
    quiet.quiet(200, at);
    quiet.sent(at + 1000, at + 1600);
    // The mouse moved at at + 5000, well after the press.
    expect(quiet.quiet(1, at + 6000)).toBe(1);
  });

  it('counts a touch from before its own input, as when the person was there all along', () => {
    const quiet = desk();
    quiet.quiet(200, at);
    quiet.sent(at + 10_000, at + 10_600);
    // The last input was at at + 2000, before the press: the press sent nothing that registered.
    expect(quiet.quiet(10, at + 12_000)).toBe(10);
  });

  it('takes the machine at its word when its own input is the first thing it saw', () => {
    const quiet = desk();
    quiet.sent(at, at + 600);
    expect(quiet.quiet(0.2, at + 700)).toBe(0.2);
  });

  it('never reads as less than nothing', () => {
    expect(desk().quiet(-0.01, at)).toBe(0);
  });

  it("keeps what it knows in a store, so the next driver does not take the last one's input for a person's", () => {
    let kept: DeskRecord = {};
    const store: DeskStore = {read: () => kept, write: record => void (kept = record)};
    const first = desk(store);
    expect(first.quiet(200, at)).toBe(200);
    first.sent(at + 1000, at + 1600);
    expect(kept).toEqual({person: at - 200_000, own: {from: at + 1000, to: at + 1600}});
    // The next test file's driver, a moment later, reads the same desk.
    expect(desk(store).quiet(0.4, at + 1900)).toBe(201.9);
  });
});

describe('fileStore', () => {
  it('reads back what it wrote, making the folder, and knows nothing from a file that is missing or not a record', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-'));
    const store = fileStore(path.join(folder, '.harness', 'windows-desk.json'));
    expect(store.read()).toEqual({});
    store.write({person: 5, own: {from: 6, to: 7}});
    expect(store.read()).toEqual({person: 5, own: {from: 6, to: 7}});
    fs.writeFileSync(path.join(folder, '.harness', 'windows-desk.json'), 'null');
    expect(store.read()).toEqual({});
    fs.writeFileSync(path.join(folder, '.harness', 'windows-desk.json'), '{ broken');
    expect(store.read()).toEqual({});
    fs.rmSync(folder, {recursive: true, force: true});
  });

  it('lets a write that cannot happen be', () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-'));
    const blocked = path.join(folder, 'file');
    fs.writeFileSync(blocked, '');
    expect(() => fileStore(path.join(blocked, 'windows-desk.json')).write({person: 1})).not.toThrow();
    fs.rmSync(folder, {recursive: true, force: true});
  });
});
