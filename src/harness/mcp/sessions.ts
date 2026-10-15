/**
 * The MCP server's sessions: what each open one holds, by an id a model
 * copies back by hand, `s1`, `s2` and on for the life of the process. A
 * session's calls run one at a time, since a driver is one window or one
 * device, while two sessions run side by side. A session closes after 30
 * idle minutes or 4 hours, whichever comes first, the way `close` closes it.
 * An open answers within 3 minutes, as a call does within its own limit, so
 * a driver that never answers does not hold a client's call for ever.
 */

/** How long a session may sit unused, and live at all, in ms. */
export const IDLE_MS = 30 * 60_000;
export const TOTAL_MS = 4 * 3_600_000;
/** How long an open may take, a cold simulator's boot among it, in ms. */
export const OPEN_MS = 3 * 60_000;

/** Why the table refused, in e2e's words for it. */
export class SessionError extends Error {
  override readonly name = 'SessionError';
  readonly code: 'NO_SESSION' | 'SESSION_REQUIRED' | 'SESSION_OPEN' | 'OPEN_TIMEOUT';

  constructor(code: SessionError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export interface Session<T> {
  readonly id: string;
  /** What it holds: its driver, its hands, its tools. */
  readonly value: T;
  readonly openedAt: number;
  touchedAt: number;
}

interface Row<T> {
  session: Session<T>;
  /** The calls in turn: each starts when the one before has ended, however it ended. */
  queue: Promise<unknown>;
  idle: ReturnType<typeof setTimeout>;
  total: ReturnType<typeof setTimeout>;
}

export interface SessionOptions<T> {
  /** At most this many open at once. */
  max: number;
  /** Lets go of what a session holds. */
  close(value: T): Promise<void>;
  now?: () => number;
  idleMs?: number;
  totalMs?: number;
  openMs?: number;
}

export class Sessions<T> {
  private readonly rows = new Map<string, Row<T>>();
  private readonly options: SessionOptions<T>;
  private opened = 0;
  /** Opens begun and not yet in the table, which count toward the most. */
  private opening = 0;

  constructor(options: SessionOptions<T>) {
    this.options = options;
  }

  get size(): number {
    return this.rows.size;
  }

  get ids(): string[] {
    return [...this.rows.keys()];
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** A timer that does not keep the process alive, which closes the session when it fires. */
  private timer(id: string, ms: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => void this.close(id).catch(() => undefined), ms);
    (timer as unknown as {unref?: () => void}).unref?.();
    return timer;
  }

  /** A new session around what `make` answers; SESSION_OPEN where the most are open already. */
  async open(make: () => Promise<T>): Promise<Session<T>> {
    if (this.rows.size + this.opening >= this.options.max) {
      throw new SessionError('SESSION_OPEN', `${this.options.max} session${this.options.max === 1 ? ' is' : 's are'} open, the most there may be: close one first (${this.ids.join(', ')})`);
    }
    this.opening += 1;
    let value: T;
    try {
      value = await this.bounded(make());
    } finally {
      this.opening -= 1;
    }
    this.opened += 1;
    const id = `s${this.opened}`;
    const at = this.now();
    const session: Session<T> = {id, value, openedAt: at, touchedAt: at};
    this.rows.set(id, {session, queue: Promise.resolve(), idle: this.timer(id, this.options.idleMs ?? IDLE_MS), total: this.timer(id, this.options.totalMs ?? TOTAL_MS)});
    return session;
  }

  /** What an open answers, or OPEN_TIMEOUT once it has taken too long; what it answers after that is let go of. */
  private bounded(pending: Promise<T>): Promise<T> {
    const ms = this.options.openMs ?? OPEN_MS;
    return new Promise((resolve, reject) => {
      let late = false;
      const timer = setTimeout(() => {
        late = true;
        reject(new SessionError('OPEN_TIMEOUT', `the session did not open in ${ms / 1000} s, and is closed if it opens after; expo-harness doctor says what this machine can drive`));
      }, ms);
      (timer as unknown as {unref?: () => void}).unref?.();
      pending.then(
        value => {
          clearTimeout(timer);
          if (late) void this.options.close(value).catch(() => undefined);
          else resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  /** The session an id names, or the one open where it names none. */
  get(id?: string): Session<T> {
    return this.row(id).session;
  }

  private row(id?: string): Row<T> {
    if (id !== undefined) {
      const row = this.rows.get(id);
      if (!row) throw new SessionError('NO_SESSION', `there is no session ${id}${this.rows.size > 0 ? `; the open ones are ${this.ids.join(', ')}` : '; open one with open_session'}`);
      return row;
    }
    if (this.rows.size === 0) throw new SessionError('NO_SESSION', 'no session is open; open one with open_session');
    if (this.rows.size > 1) throw new SessionError('SESSION_REQUIRED', `${this.rows.size} sessions are open; name one with session (${this.ids.join(', ')})`);
    return [...this.rows.values()][0] as Row<T>;
  }

  /** Runs work on a session once its calls before have ended, and starts its idle time again. */
  run<R>(id: string | undefined, work: (session: Session<T>) => Promise<R>): Promise<R> {
    const row = this.row(id);
    const turn = row.queue.then(() => {
      clearTimeout(row.idle);
      row.idle = this.timer(row.session.id, this.options.idleMs ?? IDLE_MS);
      row.session.touchedAt = this.now();
      return work(row.session);
    });
    row.queue = turn.catch(() => undefined);
    return turn;
  }

  /** Closes a session, once its calls under way have ended, and drops its row. */
  async close(id?: string): Promise<Session<T>> {
    const row = this.row(id);
    this.rows.delete(row.session.id);
    clearTimeout(row.idle);
    clearTimeout(row.total);
    await row.queue;
    await this.options.close(row.session.value);
    return row.session;
  }

  /** Closes every session at once, giving them `budget` ms between them before it goes on regardless. */
  async closeAll(budget = 10_000): Promise<void> {
    const closing = Promise.allSettled(this.ids.map(id => this.close(id)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<void>(resolve => {
      timer = setTimeout(resolve, budget);
      (timer as unknown as {unref?: () => void}).unref?.();
    });
    await Promise.race([closing, late]);
    clearTimeout(timer);
  }
}
