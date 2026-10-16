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

// jsdom moves the focus off the page with a blur on its own window, and the
// global Vitest gives a test for `window` is another object. So a press that
// is a test's first focus would throw in react-native-web: finding the blur
// is not on `window`, it asks the target whether it contains the pressed
// view, which a window cannot answer. jsdom's window answers for its document.
const page = (globalThis as {jsdom?: {window: {document: Document; contains?: (node: Node) => boolean}}}).jsdom?.window;
if (page && !page.contains) page.contains = node => page.document.contains(node);

// A unit test's device is what the test rendered, read by the script the web
// driver reads a browser's page with, so `screen`, `device` and the matchers
// are a device test's. The locator matchers sit beside jest-dom's, which
// still take an element.
setSurface(webSurface());
expect.extend(alongside(jestDom));
