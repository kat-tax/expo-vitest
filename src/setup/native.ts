// Shared setup for the iOS and Android projects (see vitest.config.mts).
// @testing-library/react-native's matchers are registered by vitest-expo,
// whose setup runs before this one.
import * as rntl from '@testing-library/react-native/matchers';
import {expect} from 'vitest';
import '../device/matchers.ts';
import {alongside} from '../device/expectations.ts';
import {setSurface} from '../device/surface.ts';
import type {Platform} from '../harness/lib/types.ts';
import {nativeSurface} from '../render/native.ts';

// A unit test's device is what the test rendered, read as a device's tree,
// so `screen`, `device` and the matchers are a device test's. The locator
// matchers sit beside React Native Testing Library's, which still take an
// element.
setSurface(nativeSurface(process.env.EXPO_VITEST_PLATFORM as Platform));
expect.extend(alongside(rntl));

/**
 * The `ExpoUI` native module is mocked at the native boundary, but `@expo/ui`
 * also needs two things the generic mock lacks:
 * - `ObservableState`, the observable behind `useNativeState` (text fields,
 *   menus, alerts, collapsibles);
 * - `getMaterialColors`, which the Compose `Host` and `useMaterialColors`
 *   call on Android to build the seeded Material 3 palette.
 *
 * The palette is the Material 3 baseline (light) with the seed as `primary`.
 * A test file can still `vi.mock('expo', ...)` itself to override this.
 */
// No `async` here, on purpose. Were this file ever compiled by React Native's
// Babel preset (see `NOT_REACT_NATIVE` in `../projects.ts`), `async` would
// become a helper required above a `vi.mock` that Vitest hoists above it.
vi.mock('expo', importOriginal => importOriginal<typeof import('expo')>().then(expo => {
  class ObservableState<T> {
    private current: T;
    constructor({value}: {value: T}) {
      this.current = value;
    }
    getValue() {
      return this.current;
    }
    setValue({value}: {value: T}) {
      this.current = value;
    }
    setOnChange() {}
    release() {}
  }

  const BASELINE = {
    primary: '#6750A4FF',
    onPrimary: '#FFFFFFFF',
    surface: '#FEF7FFFF',
    onSurface: '#1D1B20FF',
    onSurfaceVariant: '#49454FFF',
    surfaceContainerHigh: '#ECE6F0FF',
    outline: '#79747EFF',
    error: '#B3261EFF',
  };

  const ExpoUI = {
    completeRefresh() {},
    ObservableState,
    getMaterialColors: (options: {seedColor?: string} | null) => ({
      ...BASELINE,
      primary: options?.seedColor ?? BASELINE.primary,
    }),
  };

  return {
    ...expo,
    requireNativeModule: (name: string) =>
      name === 'ExpoUI' ? ExpoUI : expo.requireNativeModule(name),
  };
}));
