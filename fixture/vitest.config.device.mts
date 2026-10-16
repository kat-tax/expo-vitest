import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest/config';
import {github, summary} from 'expo-vitest/reporter';

// The device tests, as an app's device config is: by the package's name, a
// project per platform, the app in harness.config.ts. Beside web,
// scripts/fixture.js names in FIXTURE_ABSENT a platform this machine cannot
// drive, whose tests are skipped with the driver's reason. The summary
// reporter writes .harness/summary.md; on a pull request, with a token, the
// GitHub one comments.
const absent = process.env.FIXTURE_ABSENT as 'ios' | 'windows' | undefined;

export default defineConfig(deviceConfig({platforms: absent ? ['web', absent] : ['web'], reporters: ['verbose', summary(), github({key: 'fixture'})]}));
