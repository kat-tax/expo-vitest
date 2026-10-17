import {describe, expect, it} from 'vitest';
import {keepVideo, VIDEO_MODES, videoModeOf, videoName} from './video.ts';

describe('video', () => {
  it('takes the three modes, and nothing else', () => {
    expect(VIDEO_MODES).toEqual(['on', 'retain-on-failure', 'off']);
    expect(VIDEO_MODES.map(videoModeOf)).toEqual(['on', 'retain-on-failure', 'off']);
    expect([videoModeOf('yes'), videoModeOf(undefined), videoModeOf(1)]).toEqual([undefined, undefined, undefined]);
  });

  it('keeps every recording under on, a failed one under retain-on-failure, and none off', () => {
    expect([keepVideo('on', false), keepVideo('on', true)]).toEqual([true, true]);
    expect([keepVideo('retain-on-failure', false), keepVideo('retain-on-failure', true)]).toEqual([false, true]);
    expect([keepVideo('off', true)]).toEqual([false]);
  });

  it('is a WebM on web and an MP4 on a device', () => {
    expect([videoName('web'), videoName('android'), videoName('ios'), videoName('windows')]).toEqual(['video.webm', 'video.mp4', 'video.mp4', 'video.mp4']);
  });
});
