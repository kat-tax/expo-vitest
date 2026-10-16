// Let Node `require()` Expo's TypeScript-entry packages from CommonJS builds.
import './node-typescript-requires.ts';
// The web implementations are real DOM, which Testing Library renders and
// the jest-dom matchers (`toBeDisabled`, `toHaveAttribute`, ...) read.
import '@testing-library/jest-dom/vitest';
import * as jestDom from '@testing-library/jest-dom/matchers';
import {expect} from 'vitest';
import '../device/matchers.ts';
import {alongside} from '../device/expectations.ts';
import {setSurface} from '../device/surface.ts';
import {webSurface} from '../render/web.ts';

// A unit test's device is what the test rendered, read by the script the web
// driver reads a browser's page with, so `screen`, `device` and the matchers
// are a device test's. The locator matchers sit beside jest-dom's, which
// still take an element.
setSurface(webSurface());
expect.extend(alongside(jestDom));
