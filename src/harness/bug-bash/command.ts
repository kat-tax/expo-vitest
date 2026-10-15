/**
 * `expo-harness bug-bash`: the feature map's charters explored a few at a
 * time on one platform, their findings merged, a skeleton test written for
 * each issue in device/bug-bash/, and the skeletons run with the device
 * config, so an issue counts as a bug only when its check fails. A
 * charter's report goes in <area>-<n>/ of the run's folder, beside
 * findings.json and report.md.
 */
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {ResolvedAgent} from '../../agent/config.ts';
import {resolveAgent} from '../../agent/config.ts';
import {runExplore} from '../explore/run.ts';
import type {OpenedApp} from '../lib/app.ts';
import {firstReady, openApp, projectAt, startConfigured} from '../lib/app.ts';
import type {BugBash, Charter, CharterRun, Judged, RunRecord, Verdict} from '../lib/charters.ts';
import {bugBashExit, chartersOf, foundIn, merge, readFeatureMap, renderBugBash, skeletonOf, skeletonPath, totalUsage, verdictOf} from '../lib/charters.ts';
import {HarnessError} from '../lib/errors.ts';
import {costLine, findingLine, outcomeLine, renderReport, reportFolder} from '../lib/report.ts';
import type {Platform} from '../lib/types.ts';
import type {BugBashArgs} from './args.ts';
import {BUG_BASH_USAGE, parallelOn, parseBugBashArgs} from './args.ts';

const DEVICE_CONFIGS = ['vitest.config.device.mts', 'vitest.config.device.ts', 'vitest.config.device.mjs', 'vitest.config.device.js'];

/** This command's reporter, beside it: `.ts` from source and `.js` compiled, as this file is. */
const REPORTER = fileURLToPath(new URL(`./reporter${path.extname(fileURLToPath(import.meta.url))}`, import.meta.url));

/** What something thrown says: its code where it has one, then what went wrong. */
const saidOf = (error: unknown) => {
  const {code, explanation} = error as {code?: unknown; explanation?: unknown};
  const message = typeof explanation === 'string' ? explanation : (error as Error).message;
  return typeof code === 'string' ? `${code}: ${message}` : String(message ?? error);
};

/** Runs the skeletons with the device config and HARNESS_BUGBASH set, and answers each test's outcome. */
async function confirm(root: string, config: string, platform: Platform, files: string[], folder: string): Promise<RunRecord[]> {
  const results = path.join(folder, 'confirmation.json');
  const vitest = path.join(path.dirname(createRequire(path.join(root, 'package.json')).resolve('vitest/package.json')), 'vitest.mjs');
  const child = spawn(process.execPath, [vitest, 'run', '--config', config, '--reporter=default', `--reporter=${REPORTER}`, ...files], {
    cwd: root,
    stdio: 'inherit',
    env: {...process.env, HARNESS_BUGBASH: '1', HARNESS_BUGBASH_RESULTS: results, HARNESS_PLATFORM: platform},
  });
  await new Promise(resolve => child.once('exit', resolve));
  try {
    return JSON.parse(fs.readFileSync(results, 'utf8')) as RunRecord[];
  } catch {
    return [];
  }
}

export async function bugBash(args: readonly string[], root: string): Promise<number> {
  let options: BugBashArgs;
  try {
    options = parseBugBashArgs(args);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  if (options.help) {
    console.log(BUG_BASH_USAGE);
    return 0;
  }
  const started = new Date();
  const rel = (file: string) => path.relative(root, file).split(path.sep).join('/');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const project = await projectAt(root, options.config);
    const mapFile = path.resolve(root, options.featureMap);
    if (!fs.existsSync(mapFile)) throw new HarnessError('INVALID_ARGUMENT', `there is no feature map at ${rel(mapFile)}: write one, or name it with --feature-map`);
    const charters = chartersOf(readFeatureMap(fs.readFileSync(mapFile, 'utf8'), rel(mapFile)));
    // Every charter's agent, before anything starts, so a name the config lacks or an agent with no model is said first.
    const agents = new Map<string, ResolvedAgent>();
    for (const name of new Set(charters.map(charter => charter.agent ?? options.agent))) {
      const agent = resolveAgent(project.config?.agents, name);
      if (!agent.model) throw new HarnessError('MODEL_UNAVAILABLE', `the agent ${name} has no model; give it one under agents in ${project.file ?? 'the harness config'}`);
      agents.set(name, agent);
    }
    const platform = options.platform ?? (await firstReady(root));
    const {parallel, why} = parallelOn(platform, options.parallel, charters.length);
    const out = options.out ? path.resolve(root, options.out) : reportFolder(root, started, 'bug-bash');
    fs.mkdirSync(out, {recursive: true});
    console.log(`bug-bash on ${platform}: ${charters.length} ${charters.length === 1 ? 'charter' : 'charters'} from ${rel(mapFile)}, ${parallel} at a time`);
    if (why) console.log(`  ${why}`);
    console.log(`  the run goes in ${rel(out)}`);

    const explore = async (charter: Charter): Promise<CharterRun> => {
      const folder = path.join(out, charter.folder);
      const scratch = path.join(folder, '.scratch');
      fs.mkdirSync(folder, {recursive: true});
      let app: OpenedApp | undefined;
      try {
        // The command is the bug bash's, started once for every charter.
        app = await openApp(project, {platform, headed: options.headed, force: options.force, scratch, command: false}, root);
        const report = await runExplore({
          host: app.host,
          agent: agents.get(charter.agent ?? options.agent) as ResolvedAgent,
          goal: charter.goal,
          maxSteps: options.maxSteps,
          timeout: options.timeout,
          secrets: app.secrets,
          out: folder,
          signal: controller.signal,
          onFinding: finding => console.log(`  [${charter.folder}] ${findingLine(finding)}`),
        });
        fs.writeFileSync(path.join(folder, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
        fs.writeFileSync(path.join(folder, 'report.md'), renderReport(report));
        console.log(`  [${charter.folder}] ${outcomeLine(report.outcome)} · ${costLine(report.usage)}`);
        return {charter, report};
      } catch (error) {
        console.log(`  [${charter.folder}] could not explore: ${saidOf(error)}`);
        return {charter, error: saidOf(error)};
      } finally {
        await app?.close();
        fs.rmSync(scratch, {recursive: true, force: true});
      }
    };

    const command = await startConfigured(project, platform, root);
    const runs: CharterRun[] = [];
    try {
      const queue = [...charters];
      const worker = async () => {
        for (let charter = queue.shift(); charter && !controller.signal.aborted; charter = queue.shift()) runs.push(await explore(charter));
      };
      await Promise.all(Array.from({length: parallel}, worker));
    } finally {
      // The confirmation run starts the command for itself, or uses the one the person serves.
      await command?.stop();
    }
    runs.sort((a, b) => charters.indexOf(a.charter) - charters.indexOf(b.charter));

    const merged = merge(runs.flatMap(run => (run.report ? foundIn(run.charter, run.report) : [])));
    fs.writeFileSync(path.join(out, 'findings.json'), `${JSON.stringify(merged, null, 1)}\n`);
    const issues = merged.filter(found => found.severity === 'issue');
    // A skeleton from an earlier bash is kept: this one's are numbered after it.
    const folder = path.join(root, 'device', 'bug-bash');
    const taken = new Set(fs.existsSync(folder) ? fs.readdirSync(folder).map(name => `device/bug-bash/${name}`) : []);
    const date = `${started.getFullYear()}-${String(started.getMonth() + 1).padStart(2, '0')}-${String(started.getDate()).padStart(2, '0')}`;
    const skeletons = issues.map(found => {
      const file = skeletonPath(found, taken);
      fs.mkdirSync(folder, {recursive: true});
      fs.writeFileSync(path.join(root, file), skeletonOf(found, platform, date));
      console.log(`  wrote ${file}`);
      return file;
    });

    const config = options.vitestConfig ? path.resolve(root, options.vitestConfig) : DEVICE_CONFIGS.map(name => path.join(root, name)).find(each => fs.existsSync(each));
    let unchecked: Verdict | undefined;
    let records: RunRecord[] = [];
    if (!options.confirm) unchecked = {status: 'unchecked', reason: 'it was not checked: the bug bash ran with --no-confirm'};
    else if (!config) unchecked = {status: 'unchecked', reason: `it was not checked: there is no ${DEVICE_CONFIGS.join(', ')} to run its skeleton with`};
    else if (controller.signal.aborted) unchecked = {status: 'unchecked', reason: 'it was not checked: the bug bash was stopped'};
    else if (skeletons.length > 0) {
      console.log(`  checking ${skeletons.length} ${skeletons.length === 1 ? 'skeleton' : 'skeletons'} with ${rel(config)} and HARNESS_BUGBASH=1`);
      records = await confirm(root, config, platform, skeletons, out);
    }
    const judged: Judged[] = issues.map((found, index) => ({found, skeleton: skeletons[index] as string, verdict: unchecked ?? verdictOf(records, skeletons[index] as string)}));
    const bash: BugBash = {
      map: rel(mapFile),
      platform,
      parallel,
      startedAt: started.toISOString(),
      durationMs: Date.now() - started.getTime(),
      runs,
      issues: judged,
      warnings: merged.filter(found => found.severity === 'warning'),
      usage: totalUsage(runs),
    };
    fs.writeFileSync(path.join(out, 'report.md'), renderBugBash(bash));
    const count = (status: Verdict['status']) => judged.filter(each => each.verdict.status === status).length;
    console.log(`  ${count('confirmed')} confirmed, ${count('unverified') + count('unchecked')} not verified, ${count('rejected')} rejected, ${bash.warnings.length} warnings · ${costLine(bash.usage)}`);
    console.log(`  ${rel(path.join(out, 'report.md'))}`);
    return bugBashExit(bash);
  } catch (error) {
    console.error(saidOf(error));
    return 2;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}
