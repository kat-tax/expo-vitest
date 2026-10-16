import {anthropic} from 'expo-vitest/agent/anthropic';
import {defineHarness} from 'expo-vitest/config';
import {rules} from './device/rules.mts';

// The app the device tests drive, as an app's harness config names its own:
// the page device/serve.mjs serves, started for the run and stopped after.
// The agent acts with a model of rules, which needs no key; claude is for
// the live smoke alone, which runs by hand. The secrets are made up for the
// fixture, and a run checks neither leaves the process.
export default defineHarness({
  app: {
    web: {url: 'http://127.0.0.1:41731', command: {executable: 'node', args: ['device/serve.mjs', '{port}']}},
  },
  assertionTimeout: 4000,
  agents: {
    default: {model: rules, context: 'A sign-in page: an email, a recovery code and a password, then a welcome.'},
    claude: {model: anthropic(), context: 'A sign-in page: an email, a recovery code and a password, then a welcome.'},
  },
  secrets: {FIXTURE_PASSWORD: 'fixture-horse-battery', FIXTURE_RECOVERY: 'rc-4417-fixture-code'},
  cache: 'read-write',
});
