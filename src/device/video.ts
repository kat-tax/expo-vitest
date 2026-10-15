/**
 * When a device test's screen is recorded, and what is kept: `HARNESS_VIDEO`,
 * or `video` in the harness config, says `on` for every test,
 * `retain-on-failure` for the tests that fail, or `off`, the default.
 */
import type {Platform} from '../harness/lib/types.ts';

export type VideoMode = 'on' | 'retain-on-failure' | 'off';

export const VIDEO_MODES: readonly VideoMode[] = ['on', 'retain-on-failure', 'off'];

/** A mode, from what the environment or the config says, or undefined where it says none of them. */
export function videoModeOf(value: unknown): VideoMode | undefined {
  return VIDEO_MODES.find(mode => mode === value);
}

/** Whether a test's recording is kept: every one under `on`, a failed one under `retain-on-failure`. */
export function keepVideo(mode: VideoMode, failed: boolean): boolean {
  return mode === 'on' || (mode === 'retain-on-failure' && failed);
}

/** The recording's file in a test's evidence folder: a WebM from Playwright on web, an MP4 from agent-device on a device. */
export function videoName(platform: Platform): string {
  return platform === 'web' ? 'video.webm' : 'video.mp4';
}
