// The Windows platform on the iOS engine: the platform told it is Windows,
// with `.windows.*` files resolved first by the project's resolver plugin
// (`../windows-resolution.ts`).
//
// react-native-windows has no test renderer of its own and vitest-native runs
// iOS or Android only, so React Native's own JavaScript is the iOS build here;
// what the code under test branches on says Windows: `Platform.OS`,
// `Platform.select`, `EXPO_OS` and the platform file resolution. A native
// component renders as a host view named after it, whose props are the payload
// handed to the native side, which is what a test asserts on
// (`expo-vitest/windows`).
import * as rntl from '@testing-library/react-native/matchers';
import {Platform} from 'react-native';
import {expect} from 'vitest';
import '../device/matchers.ts';
import {alongside} from '../device/expectations.ts';
import {setSurface} from '../device/surface.ts';
import {nativeSurface} from '../render/native.ts';

process.env.EXPO_OS = 'windows';

Object.defineProperty(Platform, 'OS', {value: 'windows', configurable: true, writable: true});

Platform.select = (spec: Record<string, unknown>) =>
  'windows' in spec ? spec.windows : 'native' in spec ? spec.native : spec.default;

// A unit test's device is what the test rendered, read as a device's tree,
// as on iOS and Android.
setSurface(nativeSurface('windows'));
expect.extend(alongside(rntl));
