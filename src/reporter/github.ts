/**
 * The pull request comment: one per job, found again by a marker on its first
 * line and updated on a rerun rather than added to. It is posted only on a
 * pull request with a token to post with; otherwise one line says why. It
 * never throws, so it never changes how the run ends.
 */

/** The REST API version every call names, moved on deliberately. */
export const API_VERSION = '2022-11-28';

/** The most a comment may hold. */
export const COMMENT_LIMIT = 65_536;

/** The most a job summary may hold. */
export const SUMMARY_LIMIT = 1024 * 1024;

/** `fetch`, as much of it as the comment uses. */
export type Fetcher = (url: string, init: {method: string; headers: Record<string, string>; body?: string}) => Promise<{ok: boolean; status: number; json(): Promise<unknown>}>;

/** Where the comment goes. */
export interface Target {
  api: string;
  repository: string;
  issue: number;
  token: string;
}

/** The first line of the comment: the workflow and the job, and a key where a matrix runs the job several times. */
export function markerFor(environment: NodeJS.ProcessEnv, key?: string): string {
  const job = `${environment.GITHUB_WORKFLOW ?? 'workflow'}/${environment.GITHUB_JOB ?? 'job'}`;
  return `<!-- expo-vitest-reporter key=${key ? `${job}/${key}` : job} -->`;
}

/** The run's Artifacts section, where its evidence is uploaded, on GitHub Actions. */
export function artifactsOf(environment: NodeJS.ProcessEnv): string | undefined {
  const {GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: run} = environment;
  return server && repository && run ? `${server}/${repository}/actions/runs/${run}#artifacts` : undefined;
}

/** The pull request a run is for: from the event's payload, or else from a ref like `refs/pull/12/merge`. */
export function pullRequestOf(environment: NodeJS.ProcessEnv, readEvent: (file: string) => string | undefined): number | null {
  const file = environment.GITHUB_EVENT_PATH;
  if (file) {
    try {
      const number = (JSON.parse(readEvent(file) ?? 'null') as {pull_request?: {number?: unknown}} | null)?.pull_request?.number;
      if (typeof number === 'number') return number;
    } catch {
      // A payload that does not parse says nothing; the ref may.
    }
  }
  const ref = environment.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//);
  return ref ? Number(ref[1]) : null;
}

/** Where the comment goes, or why there is none. */
export function targetOf(environment: NodeJS.ProcessEnv, readEvent: (file: string) => string | undefined): {target: Target} | {why: string} {
  if (environment.GITHUB_ACTIONS !== 'true') return {why: 'this is not GitHub Actions, so there is no pull request to comment on'};
  const event = environment.GITHUB_EVENT_NAME;
  if (event !== 'pull_request' && event !== 'pull_request_target') return {why: `a ${event ?? 'run with no'} event is not a pull request, so there is no comment`};
  const token = environment.GITHUB_TOKEN || environment.GH_TOKEN;
  if (!token) return {why: "there is no GITHUB_TOKEN or GH_TOKEN in the step's env, so there is no comment"};
  const repository = environment.GITHUB_REPOSITORY;
  if (!repository) return {why: 'GITHUB_REPOSITORY is not set, so there is no comment'};
  const issue = pullRequestOf(environment, readEvent);
  if (issue === null) return {why: 'neither the event nor the ref names a pull request, so there is no comment'};
  return {target: {api: environment.GITHUB_API_URL || 'https://api.github.com', repository, issue, token}};
}

/** Why GitHub refused, in a line that says what to do. */
function refusal(status: number, doing: string): string {
  const why = status === 403 ? `GitHub answered 403, as it does to a fork's token, which may only read` : `GitHub answered ${status}`;
  return `the pull request comment was not ${doing}: ${why}; the job summary has the text`;
}

/** Posts the comment, or updates ours where it is there; answers a line saying which, or why neither. */
export async function upsertComment(target: Target, marker: string, body: string, fetcher: Fetcher): Promise<string> {
  const headers = {Authorization: `Bearer ${target.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION, 'Content-Type': 'application/json'};
  const issues = `${target.api}/repos/${target.repository}/issues`;
  const text = JSON.stringify({body: body.startsWith(marker) ? body : `${marker}\n${body}`});
  try {
    let ours: number | null = null;
    for (let page = 1; ours === null; page++) {
      const listed = await fetcher(`${issues}/${target.issue}/comments?per_page=100&page=${page}`, {method: 'GET', headers});
      if (!listed.ok) return refusal(listed.status, 'read');
      const comments = (await listed.json()) as {id: number; body?: string}[];
      ours = comments.find(comment => comment.body?.startsWith(marker))?.id ?? null;
      if (comments.length < 100) break;
    }
    const answer = ours === null ? await fetcher(`${issues}/${target.issue}/comments`, {method: 'POST', headers, body: text}) : await fetcher(`${issues}/comments/${ours}`, {method: 'PATCH', headers, body: text});
    if (!answer.ok) return refusal(answer.status, ours === null ? 'posted' : 'updated');
    return ours === null ? `posted the summary on pull request #${target.issue}` : `updated the summary on pull request #${target.issue}`;
  } catch (error) {
    return `the pull request comment was not posted: ${(error as Error).message}; the job summary has the text`;
  }
}
