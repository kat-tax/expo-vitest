/**
 * Whether synthetic input may go to the desktop now. It goes to whatever
 * window is in front, so while someone is using the machine a press meant for
 * the app lands in their window instead, and nothing says so.
 *
 * Windows counts the harness's own input as use: after a press, the machine
 * reads as touched a moment ago, and a test's second press would be refused
 * because of its first. So the desk remembers when the harness sent input, and
 * an idle time that ends inside that input is the harness's own. The person's
 * last touch is then still the one seen before it.
 */

/** How long the machine must have been quiet before synthetic input is sent. */
export const QUIET_SECONDS = 180;

/**
 * How far the machine's last input can fall outside the harness's own and
 * still be its own: the machine's clock and Node's are read a request apart.
 */
const SLACK_MS = 500;

export interface Desk {
  /**
   * The seconds since a person last used the machine, from the seconds since
   * the machine last saw any input. Null, where the question has no meaning,
   * stays null.
   */
  quiet(idle: number | null, now?: number): number | null;
  /** Says the harness sent input from `from` to `to`, in milliseconds since the epoch. */
  sent(from: number, to: number): void;
}

export function desk(): Desk {
  let person: number | undefined;
  let own: {from: number; to: number} | undefined;
  return {
    quiet(idle, now = Date.now()) {
      if (idle === null) return null;
      const last = now - idle * 1000;
      const ours = own !== undefined && last >= own.from - SLACK_MS && last <= own.to + SLACK_MS;
      if (!ours || person === undefined) person = last;
      return Math.max(0, (now - person) / 1000);
    },
    sent(from, to) {
      own = {from, to};
    },
  };
}

/**
 * Why synthetic input must not go now, or null when it may. `quiet` is the
 * seconds since a person last used the machine, null where that has no
 * meaning; `force` sends it whatever the desk is doing.
 */
export function refusal(what: string, quiet: number | null, force: boolean): string | null {
  if (force || quiet === null || quiet >= QUIET_SECONDS) return null;
  return (
    `refusing ${what}: someone used this machine ${Math.round(quiet)} seconds ago, and synthetic input goes to whatever is in front. ` +
    `Leave it alone for ${QUIET_SECONDS} seconds, or pass --force (HARNESS_FORCE=1 in a device test).`
  );
}
