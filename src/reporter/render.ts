/**
 * A run's summary as Markdown: the counts, each failure with its error and
 * its evidence, the flaky tests and every test folded away, and a footer.
 * The same text goes to `.harness/summary.md`, the job summary and the pull
 * request comment; only where the evidence links point differs.
 */
import path from 'node:path';

/** One test, as the reporter keeps it: plain data, so the summary is a function of it. */
export interface TestRecord {
  /** The Vitest project, as `ios` or `device:web`. */
  project: string;
  /** From the project root, with forward slashes. */
  file: string;
  /** The suites and the test, as Vitest names them. */
  name: string;
  line?: number;
  state: 'passed' | 'failed' | 'skipped' | 'pending';
  /** Passed, but only on a retry. */
  flaky: boolean;
  /** In ms. */
  duration: number;
  error?: {code?: string; message: string};
  /** Where the test's evidence is, from the project root. */
  evidence?: {folder: string; trace: string; screenshot?: string};
}

/** What the footer says of the run. */
export interface RunFacts {
  version: string;
  /** In ms. */
  duration: number;
  /** `GITHUB_RUN_ATTEMPT`, so a rerun shows as one. */
  attempt?: string;
  /** The run's Artifacts section, where its evidence is uploaded. */
  artifacts?: string;
}

/**
 * Where an evidence link points: relative to the summary file, which opens in
 * an editor, or at the run's Artifacts section on GitHub, which serves no
 * artifact file by URL, with the file's path beside it.
 */
export type Links = {kind: 'relative'; from: string} | {kind: 'artifacts'; url: string};

/** A project's platform: `device:web` is web. */
export function platformOf(project: string): string {
  return project.replace(/^device:/, '');
}

export function countsOf(records: TestRecord[]): {failed: number; flaky: number; passed: number; skipped: number} {
  const count = (test: (record: TestRecord) => boolean) => records.filter(test).length;
  return {
    failed: count(record => record.state === 'failed'),
    flaky: count(record => record.state === 'passed' && record.flaky),
    passed: count(record => record.state === 'passed'),
    skipped: count(record => record.state === 'skipped' || record.state === 'pending'),
  };
}

/** The first line: the counts that are not nothing, and always what passed. */
export function headline(records: TestRecord[]): string {
  const {failed, flaky, passed, skipped} = countsOf(records);
  const parts = [failed ? `${failed} failed` : '', flaky ? `${flaky} flaky` : '', `${passed} passed`, skipped ? `${skipped} skipped` : ''].filter(Boolean);
  return `## expo-vitest · ${parts.join(' · ')}`;
}

/** Text that sits in a table cell: one line, its pipes escaped. */
export function cell(text: string): string {
  return text.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
}

/** A failure in a cell: its code, and the first line of what it said, cut to a sentence's length. */
export function errorText(error: TestRecord['error']): string {
  if (!error) return '';
  const first = error.message.split(/\r?\n/).find(line => line.trim()) ?? '';
  const said = first.length > 200 ? `${first.slice(0, 199)}…` : first;
  return cell(error.code ? `${error.code}: ${said}` : said);
}

/** A span of time as a person says it: 840 ms, 6.4 s, 3 m 12 s. */
export function spoken(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)} m ${seconds % 60} s`;
}

/** The evidence of a test as links: the screenshot where there is one, the tree and the trace. */
export function evidenceLinks(evidence: TestRecord['evidence'], links: Links): string {
  if (!evidence) return '';
  const files: [string, string][] = [...(evidence.screenshot ? ([['screenshot', evidence.screenshot]] as [string, string][]) : []), ['tree', path.posix.join(evidence.folder, 'tree.txt')], ['trace', evidence.trace]];
  if (links.kind === 'artifacts') return `${files.map(([word]) => `[${word}](${links.url})`).join(' · ')}<br>\`${evidence.folder}\``;
  const from = path.posix.dirname(links.from);
  return files.map(([word, file]) => `[${word}](${path.posix.relative(from, file)})`).join(' · ');
}

const where = (record: TestRecord) => `${record.name} (${record.file}${record.line === undefined ? '' : `:${record.line}`})`;

/** The run in Markdown, cut to `limit` characters by folding away first every test, then the flaky ones, then the failures past what fits. */
export function renderSummary(records: TestRecord[], facts: RunFacts, links: Links, limit: number = Number.POSITIVE_INFINITY): string {
  const failures = records.filter(record => record.state === 'failed');
  const flaky = records.filter(record => record.state === 'passed' && record.flaky);
  const platforms = [...new Set(records.map(record => platformOf(record.project)))];
  const footer = [`expo-vitest ${facts.version}`, spoken(facts.duration), platforms.join(', ') || 'no tests', ...(facts.attempt ? [`attempt ${facts.attempt}`] : []), ...(facts.artifacts ? [`[artifacts](${facts.artifacts})`] : [])].join(' · ');
  const failureRows = failures.map(record => `| ${platformOf(record.project)} | ${cell(where(record))} | ${errorText(record.error)} | ${evidenceLinks(record.evidence, links)} |`);
  const failureTable = (rows: string[]) => (rows.length ? ['', '| Platform | Test | Error | Evidence |', '| --- | --- | --- | --- |', ...rows] : []);
  const folded = (title: string, head: string, rows: string[]) =>
    rows.length ? ['', `<details><summary>${title} (${rows.length})</summary>`, '', head, `| ${head.split('|').slice(1, -1).map(() => '---').join(' | ')} |`, ...rows, '', '</details>'] : [];
  const flakyPart = folded('Flaky, passed on retry', '| Platform | Test | Time |', flaky.map(record => `| ${platformOf(record.project)} | ${cell(where(record))} | ${spoken(record.duration)} |`));
  const everyPart = folded(
    'Every test',
    '| Platform | Test | Result | Time |',
    records.map(record => `| ${platformOf(record.project)} | ${cell(where(record))} | ${record.flaky && record.state === 'passed' ? 'passed on retry' : record.state} | ${spoken(record.duration)} |`),
  );
  const compose = (parts: string[][], note?: string) => [headline(records), ...parts.flat(), ...(note ? ['', note] : []), '', footer, ''].join('\n');
  const whole = compose([failureTable(failureRows), flakyPart, everyPart]);
  if (whole.length <= limit) return whole;
  const withoutEvery = compose([failureTable(failureRows), flakyPart], '_Every test is left out, to fit._');
  if (withoutEvery.length <= limit) return withoutEvery;
  const failuresOnly = compose([failureTable(failureRows)], '_Every test and the flaky ones are left out, to fit._');
  if (failuresOnly.length <= limit) return failuresOnly;
  // As many failures as fit, and how many more there are.
  for (let kept = failureRows.length - 1; kept >= 0; kept--) {
    const cut = compose([failureTable(failureRows.slice(0, kept))], `_${failureRows.length - kept} more failures, every test and the flaky ones are left out, to fit._`);
    if (cut.length <= limit || kept === 0) return cut;
  }
  // No failures to cut, and still too long: the headline and the footer are all there is.
  return failuresOnly;
}
