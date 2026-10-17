// Where a platform keeps its snapshots: in a folder named for it inside the
// one Vitest would use, `__snapshots__/<platform>/` beside the test unless a
// config resolves them elsewhere. One test file runs on several platforms,
// and each renders its own, as each has its own screenshot baselines. The
// platform is the project's, which it names in EXPO_VITEST_PLATFORM, or a
// device project's, in HARNESS_PLATFORM.
import path from 'node:path';
import {VitestSnapshotEnvironment} from 'vitest/snapshot';

class PlatformSnapshots extends VitestSnapshotEnvironment {
  // No `async` here, as in the other setup files: the engine's Babel preset
  // turns one into a helper this file does not load.
  override resolvePath(filepath: string): Promise<string> {
    const platform = process.env.EXPO_VITEST_PLATFORM ?? process.env.HARNESS_PLATFORM ?? 'web';
    return super.resolvePath(filepath).then(resolved => path.join(path.dirname(resolved), platform, path.basename(resolved)));
  }
}

export default new PlatformSnapshots();
