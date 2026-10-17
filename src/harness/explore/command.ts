/**
 * `expo-harness explore [goal]`: one explore on the app the project's
 * harness config names, with an agent from its `agents`, the report written
 * to its folder as the run goes and when it ends. The terminal prints each
 * finding as it is made, each step under HARNESS_DEBUG, and the cost at the
 * end. The exit code is 1 when an issue was reported, 2 when the run could
 * not explore, else 0.
 */
import fs from 'node:fs';
import path from 'node:path';
import {resolveAgent} from '../../agent/config.ts';
import {uploadsFrom} from '../../agent/hands.ts';
import {openApp, projectAt} from '../lib/app.ts';
import type {OpenedApp} from '../lib/app.ts';
import {costLine, exitCodeOf, findingLine, outcomeLine, renderReport, reportFolder, stepLine} from '../lib/report.ts';
import type {ExploreArgs} from './args.ts';
import {EXPLORE_USAGE, parseExploreArgs} from './args.ts';
import {runExplore} from './run.ts';

const on = (value: string | undefined) => Boolean(value) && value !== '0' && value !== 'false';

export async function explore(args: readonly string[], root: string): Promise<number> {
  let options: ExploreArgs;
  try {
    options = parseExploreArgs(args);
  } catch (error) {
    console.error((error as Error).message);
    return 2;
  }
  if (options.help) {
    console.log(EXPLORE_USAGE);
    return 0;
  }
  let app: OpenedApp | undefined;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const project = await projectAt(root, options.config);
    const agent = resolveAgent(project.config?.agents, options.agent);
    if (!agent.model) {
      console.error(`MODEL_UNAVAILABLE: the agent ${agent.name} has no model; give it one under agents in ${project.file ?? 'the harness config'}`);
      return 2;
    }
    const out = options.out ? path.resolve(root, options.out) : reportFolder(root, new Date());
    fs.mkdirSync(out, {recursive: true});
    app = await openApp(project, {platform: options.platform, headed: options.headed, force: options.force, scratch: path.join(out, '.scratch')}, root);
    console.log(`explore on ${app.platform} (${app.state.found ?? 'ready'}), agent ${agent.name}: ${JSON.stringify(options.goal)}`);
    console.log(`  the report goes in ${path.relative(root, out) || '.'}`);
    const debug = on(process.env.HARNESS_DEBUG);
    const report = await runExplore({
      host: app.host,
      agent,
      goal: options.goal,
      maxSteps: options.maxSteps,
      timeout: options.timeout,
      secrets: app.secrets,
      out,
      uploads: uploadsFrom(agent.uploads, root),
      signal: controller.signal,
      onFinding: finding => console.log(`  ${findingLine(finding)}`),
      ...(debug ? {onStep: step => console.log(`  ${stepLine(step)}`)} : {}),
    });
    fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
    fs.writeFileSync(path.join(out, 'report.md'), renderReport(report));
    fs.rmSync(path.join(out, '.scratch'), {recursive: true, force: true});
    const issues = report.findings.filter(finding => finding.severity === 'issue').length;
    console.log(`  the run ${outcomeLine(report.outcome)}`);
    console.log(`  ${issues} ${issues === 1 ? 'issue' : 'issues'}, ${report.findings.length - issues} ${report.findings.length - issues === 1 ? 'warning' : 'warnings'} · ${costLine(report.usage)}`);
    console.log(`  ${path.relative(root, path.join(out, 'report.md'))}`);
    return exitCodeOf(report);
  } catch (error) {
    const {code} = error as {code?: unknown};
    console.error(typeof code === 'string' ? `${code}: ${(error as {explanation?: string}).explanation ?? (error as Error).message}` : error);
    return 2;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await app?.close();
  }
}
