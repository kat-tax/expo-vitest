import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {IDLE_MS, SessionError, Sessions, TOTAL_MS} from './sessions.ts';

/** A table over fake drivers, each a name, every close kept. */
function tableOf(max = 2, close: (value: string) => Promise<void> = () => Promise.resolve()) {
  const closed: string[] = [];
  const sessions = new Sessions<string>({
    max,
    close: async value => {
      await close(value);
      closed.push(value);
    },
  });
  return {sessions, closed};
}

/** What a promise rejected with, as its code and message. */
const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return [(error as SessionError).code, (error as Error).message];
  }
  return null;
};

describe('the session table', () => {
  it('numbers its sessions s1, s2 and on for the life of the process, and resolves the one open where a call names none', async () => {
    const {sessions} = tableOf();
    const first = await sessions.open(async () => 'web');
    expect([first.id, first.value, sessions.get().id, sessions.size]).toEqual(['s1', 'web', 's1', 1]);
    await sessions.close();
    const second = await sessions.open(async () => 'android');
    expect(second.id).toBe('s2');
  });

  it('refuses one more than the most, a call that names none where several are open, and an id it has not got', async () => {
    const {sessions} = tableOf(2);
    await sessions.open(async () => 'web');
    await sessions.open(async () => 'android');
    await expect(sessions.open(async () => 'ios')).rejects.toMatchObject({code: 'SESSION_OPEN', message: '2 sessions are open, the most there may be: close one first (s1, s2)'});
    expect(refusal(() => sessions.get())).toEqual(['SESSION_REQUIRED', '2 sessions are open; name one with session (s1, s2)']);
    expect(refusal(() => sessions.get('s9'))).toEqual(['NO_SESSION', 'there is no session s9; the open ones are s1, s2']);
    await sessions.closeAll();
    expect(refusal(() => sessions.get())).toEqual(['NO_SESSION', 'no session is open; open one with open_session']);
    expect(refusal(() => sessions.get('s1'))).toEqual(['NO_SESSION', 'there is no session s1; open one with open_session']);
    expect(refusal(() => sessions.get('s1'))?.[0]).toBe('NO_SESSION');
    const one = tableOf(1);
    await one.sessions.open(async () => 'web');
    await expect(one.sessions.open(async () => 'android')).rejects.toThrow('1 session is open, the most there may be');
  });

  it('counts an open under way toward the most, and frees its place where it failed', async () => {
    const {sessions} = tableOf(1);
    let finish: (value: string) => void = () => undefined;
    const slow = sessions.open(() => new Promise<string>(resolve => (finish = resolve)));
    await expect(sessions.open(async () => 'android')).rejects.toBeInstanceOf(SessionError);
    finish('web');
    await slow;
    await sessions.close();
    await expect(sessions.open(() => Promise.reject(new Error('no browser')))).rejects.toThrow('no browser');
    expect((await sessions.open(async () => 'web')).id).toBe('s2');
  });

  it("runs a session's calls one at a time, however each ended, and two sessions' side by side", async () => {
    const {sessions} = tableOf();
    await sessions.open(async () => 'web');
    await sessions.open(async () => 'android');
    const order: string[] = [];
    let release = () => undefined as void;
    const first = sessions.run('s1', () => new Promise<void>(resolve => (release = () => (order.push('s1 first'), resolve()))));
    const second = sessions.run('s1', async () => void order.push('s1 second'));
    const failing = sessions.run('s1', () => Promise.reject(new Error('the tap failed')));
    const third = sessions.run('s1', async () => 's1 third');
    await sessions.run('s2', async () => void order.push('s2'));
    expect(order).toEqual(['s2']);
    release();
    await first;
    await second;
    await expect(failing).rejects.toThrow('the tap failed');
    expect(await third).toBe('s1 third');
    expect(order).toEqual(['s2', 's1 first', 's1 second']);
  });

  it('closes a session once its calls under way have ended', async () => {
    const {sessions, closed} = tableOf();
    await sessions.open(async () => 'web');
    let release = () => undefined as void;
    const running = sessions.run(undefined, () => new Promise<void>(resolve => (release = resolve)));
    const closing = sessions.close('s1');
    expect(sessions.size).toBe(0);
    await Promise.resolve();
    expect(closed).toEqual([]);
    release();
    await running;
    expect((await closing).value).toBe('web');
    expect(closed).toEqual(['web']);
  });
});

describe("a session's time", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('ends after 30 idle minutes, each call starting them again', async () => {
    const {sessions, closed} = tableOf();
    await sessions.open(async () => 'web');
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1000);
    await sessions.run(undefined, async () => undefined);
    expect(sessions.get().touchedAt).toBe(Date.now());
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1000);
    expect(closed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect([closed, sessions.size]).toEqual([['web'], 0]);
  });

  it('drops a session whose time ran out even where letting it go failed', async () => {
    const {sessions} = tableOf(1, () => Promise.reject(new Error('the browser would not close')));
    await sessions.open(async () => 'web');
    await vi.advanceTimersByTimeAsync(IDLE_MS);
    expect(sessions.size).toBe(0);
  });

  it('ends after 4 hours however busy it is', async () => {
    const {sessions, closed} = tableOf();
    await sessions.open(async () => 'web');
    for (let at = 0; at < TOTAL_MS; at += IDLE_MS / 2) {
      await sessions.run(undefined, async () => undefined).catch(() => undefined);
      await vi.advanceTimersByTimeAsync(IDLE_MS / 2);
    }
    expect(closed).toEqual(['web']);
  });

  it('closes every session together, and goes on regardless once its budget is spent', async () => {
    const stuck = tableOf(3, value => (value === 'windows' ? new Promise(() => undefined) : Promise.resolve()));
    await stuck.sessions.open(async () => 'web');
    await stuck.sessions.open(async () => 'windows');
    const closing = stuck.sessions.closeAll(10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    await closing;
    expect([stuck.closed, stuck.sessions.size]).toEqual([['web'], 0]);
  });

  it('keeps the times a clock it is given says', async () => {
    let now = 5;
    const sessions = new Sessions<string>({max: 1, close: () => Promise.resolve(), now: () => now, idleMs: 100, totalMs: 1000});
    const session = await sessions.open(async () => 'web');
    now = 9;
    await sessions.run(undefined, async () => undefined);
    expect([session.openedAt, session.touchedAt]).toEqual([5, 9]);
    await vi.advanceTimersByTimeAsync(100);
    expect(sessions.size).toBe(0);
  });
});
