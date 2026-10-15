import {defineConfig} from 'vitest/config';
import {nodeProject} from './src/index.ts';

/**
 * The package's own logic, in Node: the file names each platform takes, the
 * two resolver plugins, and the harness's command line, snapshot shape,
 * selector matching and PNG comparison. What needs an engine, a browser or a
 * device is proved by the fixture (`bun run test:fixture`) and by device
 * tests, not from here.
 */
export default defineConfig({
  test: {
    projects: [nodeProject({name: 'expo-vitest', include: ['src/**/*.test.ts']})],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'html', 'lcov'],
      // The files that are logic and nothing else are held to all of it. A setup
      // file, a Node require hook and a device driver are not what a unit test
      // reaches, and a number for them would say nothing.
      include: ['src/projects.ts', 'src/forbid-modules.ts', 'src/windows-resolution.ts', 'src/timeout.ts', 'src/harness/lib/cli.ts', 'src/harness/lib/errors.ts', 'src/harness/lib/run.ts', 'src/harness/lib/bench.ts', 'src/harness/platforms/agent-device-mapping.ts', 'src/harness/lib/snapshot.ts', 'src/harness/platforms/windows-host.ts', 'src/harness/lib/quiet.ts', 'src/harness/lib/patterns.ts', 'src/harness/lib/settle.ts', 'src/harness/lib/roles.ts', 'src/harness/lib/react.ts', 'src/harness/lib/metro.ts', 'src/device/queries.ts', 'src/device/polling.ts', 'src/device/locator.ts', 'src/device/screen.ts', 'src/device/expectations.ts', 'src/device/evidence.ts', 'src/harness/platforms/windows-keys.ts', 'src/harness/platforms/web-browsers.ts', 'src/device/config.ts', 'src/device/app-process.ts', 'src/harness/lib/controls.ts', 'src/device/capabilities.ts', 'src/harness/lib/image.ts', 'src/device/screenshots.ts', 'src/cli/detect.ts', 'src/cli/templates.ts', 'src/cli/plan.ts', 'src/cli/skill.ts', 'src/cli/guide.ts', 'src/reporter/render.ts', 'src/reporter/github.ts', 'src/reporter/records.ts', 'src/device/video.ts', 'src/device/pool.ts', 'src/device/web.ts', 'src/agent/types.ts', 'src/agent/secrets.ts', 'src/agent/redact.ts', 'src/agent/view.ts', 'src/agent/policy.ts', 'src/agent/tools.ts', 'src/agent/cost.ts', 'src/agent/cache.ts'],
      thresholds: {lines: 100, functions: 100, branches: 100, statements: 100},
    },
  },
});
