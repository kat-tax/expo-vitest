import {describe, expect, it, vi} from 'vitest';
import type {Fetcher, Target} from './github.ts';
import {API_VERSION, artifactsOf, COMMENT_LIMIT, markerFor, pullRequestOf, SUMMARY_LIMIT, targetOf, upsertComment} from './github.ts';

const env = (values: Record<string, string> = {}) => values as unknown as NodeJS.ProcessEnv;
const pullRequest = {
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_TOKEN: 'token',
  GITHUB_REPOSITORY: 'kat-tax/expo-vitest',
  GITHUB_EVENT_PATH: '/event.json',
};
const event = (body: unknown) => () => JSON.stringify(body);

describe('where the comment goes', () => {
  it('is the pull request a pull request event names, with the token in the env', () => {
    expect(targetOf(env(pullRequest), event({pull_request: {number: 12}}))).toEqual({target: {api: 'https://api.github.com', repository: 'kat-tax/expo-vitest', issue: 12, token: 'token'}});
    expect(targetOf(env({...pullRequest, GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_TOKEN: '', GH_TOKEN: 'gh', GITHUB_API_URL: 'https://ghe.example/api/v3'}), event({pull_request: {number: 3}}))).toEqual({
      target: {api: 'https://ghe.example/api/v3', repository: 'kat-tax/expo-vitest', issue: 3, token: 'gh'},
    });
  });

  it('is nowhere off GitHub Actions, off a pull request, without a token, a repository or a number, and says why', () => {
    const why = (values: Record<string, string>, read = event({pull_request: {number: 1}})) => (targetOf(env(values), read) as {why: string}).why;
    expect(why({})).toBe('this is not GitHub Actions, so there is no pull request to comment on');
    expect(why({...pullRequest, GITHUB_EVENT_NAME: 'push'})).toBe('a push event is not a pull request, so there is no comment');
    expect(why({GITHUB_ACTIONS: 'true'})).toBe('a run with no event is not a pull request, so there is no comment');
    expect(why({...pullRequest, GITHUB_TOKEN: ''})).toBe("there is no GITHUB_TOKEN or GH_TOKEN in the step's env, so there is no comment");
    expect(why({...pullRequest, GITHUB_REPOSITORY: ''})).toBe('GITHUB_REPOSITORY is not set, so there is no comment');
    expect(why(pullRequest, event({}))).toBe('neither the event nor the ref names a pull request, so there is no comment');
  });
});

describe('the pull request number', () => {
  it("is the event payload's, or the ref's where the payload has none", () => {
    expect(pullRequestOf(env({GITHUB_EVENT_PATH: '/e.json'}), event({pull_request: {number: 7}}))).toBe(7);
    expect(pullRequestOf(env({GITHUB_EVENT_PATH: '/e.json', GITHUB_REF: 'refs/pull/9/merge'}), () => 'not json')).toBe(9);
    expect(pullRequestOf(env({GITHUB_EVENT_PATH: '/e.json', GITHUB_REF: 'refs/pull/9/merge'}), () => undefined)).toBe(9);
    expect(pullRequestOf(env({GITHUB_REF: 'refs/heads/main'}), () => undefined)).toBeNull();
    expect(pullRequestOf(env(), () => undefined)).toBeNull();
  });
});

describe('the marker and the links', () => {
  it('keys the comment by the workflow and the job, and a matrix entry', () => {
    expect(markerFor(env({GITHUB_WORKFLOW: 'ci', GITHUB_JOB: 'device'}))).toBe('<!-- expo-vitest-reporter key=ci/device -->');
    expect(markerFor(env({GITHUB_WORKFLOW: 'ci', GITHUB_JOB: 'device'}), 'android')).toBe('<!-- expo-vitest-reporter key=ci/device/android -->');
    expect(markerFor(env())).toBe('<!-- expo-vitest-reporter key=workflow/job -->');
  });

  it("point at the run's artifacts where the run is known", () => {
    expect(artifactsOf(env({GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '9'}))).toBe('https://github.com/o/r/actions/runs/9#artifacts');
    expect(artifactsOf(env({GITHUB_SERVER_URL: 'https://github.com'}))).toBeUndefined();
  });

  it('fit what GitHub holds', () => {
    expect([COMMENT_LIMIT, SUMMARY_LIMIT, API_VERSION]).toEqual([65_536, 1_048_576, '2022-11-28']);
  });
});

describe('posting the comment', () => {
  const target: Target = {api: 'https://api.github.com', repository: 'o/r', issue: 12, token: 't'};
  const marker = '<!-- expo-vitest-reporter key=ci/device -->';
  const answer = (status: number, json: unknown = {}) => ({ok: status < 300, status, json: async () => json});

  it('updates ours where it is there, found by its marker across the pages', async () => {
    const page1 = Array.from({length: 100}, (_, at) => ({id: at, body: 'someone else'}));
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce(answer(200, page1)).mockResolvedValueOnce(answer(200, [{id: 555, body: `${marker}\nold`}])).mockResolvedValueOnce(answer(200));
    expect(await upsertComment(target, marker, 'new summary', fetcher)).toBe('updated the summary on pull request #12');
    expect(fetcher.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'GET https://api.github.com/repos/o/r/issues/12/comments?per_page=100&page=1',
      'GET https://api.github.com/repos/o/r/issues/12/comments?per_page=100&page=2',
      'PATCH https://api.github.com/repos/o/r/issues/comments/555',
    ]);
    const [, init] = fetcher.mock.calls[2]!;
    expect(JSON.parse(init.body as string)).toEqual({body: `${marker}\nnew summary`});
    expect(init.headers).toEqual({Authorization: 'Bearer t', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'});
  });

  it('stops looking at the page ours is on, even a full one', async () => {
    const full = Array.from({length: 100}, (_, at) => ({id: at, body: at === 40 ? marker : 'someone else'}));
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce(answer(200, full)).mockResolvedValueOnce(answer(200));
    expect(await upsertComment(target, marker, 'summary', fetcher)).toBe('updated the summary on pull request #12');
    expect(fetcher.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual(['GET https://api.github.com/repos/o/r/issues/12/comments?per_page=100&page=1', 'PATCH https://api.github.com/repos/o/r/issues/comments/40']);
  });

  it('posts a new one where ours is not there, and keeps a marker the body has already', async () => {
    const fetcher = vi.fn<Fetcher>().mockResolvedValueOnce(answer(200, [{id: 1}, {id: 2, body: 'hi'}])).mockResolvedValueOnce(answer(201));
    expect(await upsertComment(target, marker, `${marker}\nsummary`, fetcher)).toBe('posted the summary on pull request #12');
    expect(fetcher.mock.calls[1]?.[0]).toBe('https://api.github.com/repos/o/r/issues/12/comments');
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body as string)).toEqual({body: `${marker}\nsummary`});
  });

  it("says why it did not, and never throws: a fork's 403, another refusal, a network failure", async () => {
    expect(await upsertComment(target, marker, 's', vi.fn<Fetcher>().mockResolvedValueOnce(answer(403)))).toBe(
      "the pull request comment was not read: GitHub answered 403, as it does to a fork's token, which may only read; the job summary has the text",
    );
    expect(await upsertComment(target, marker, 's', vi.fn<Fetcher>().mockResolvedValueOnce(answer(200, [])).mockResolvedValueOnce(answer(422)))).toBe(
      'the pull request comment was not posted: GitHub answered 422; the job summary has the text',
    );
    expect(await upsertComment(target, marker, 's', vi.fn<Fetcher>().mockResolvedValueOnce(answer(200, [{id: 4, body: marker}])).mockResolvedValueOnce(answer(500)))).toBe(
      'the pull request comment was not updated: GitHub answered 500; the job summary has the text',
    );
    expect(await upsertComment(target, marker, 's', vi.fn<Fetcher>().mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND')))).toBe(
      'the pull request comment was not posted: getaddrinfo ENOTFOUND; the job summary has the text',
    );
  });
});
