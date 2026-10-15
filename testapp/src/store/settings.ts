// The settings: one value for each kind of control the settings screen
// has, kept across a restart.
import {createStore} from './store';

export type Theme = 'system' | 'light' | 'dark';
export type Frequency = 'daily' | 'weekly' | 'monthly';

export interface Settings {
  displayName: string;
  push: boolean;
  digest: boolean;
  frequency: Frequency;
  /** The start of the quiet hours, as an ISO date whose time is the setting. */
  quietFrom: string;
  theme: Theme;
  accent: string;
  textSize: number;
  perPage: number;
  shareUsage: boolean;
  suggestions: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: 'Ada',
  push: true,
  digest: false,
  frequency: 'weekly',
  quietFrom: '2026-01-01T22:00:00.000Z',
  theme: 'system',
  accent: '#3D7EF7',
  textSize: 1,
  perPage: 20,
  shareUsage: false,
  suggestions: true,
};

export const ACCENTS = [
  {color: '#3D7EF7', name: 'Blue'},
  {color: '#8959EA', name: 'Violet'},
  {color: '#2BA160', name: 'Green'},
  {color: '#E8573E', name: 'Coral'},
];

export const settings = createStore<Settings>('testapp.settings', DEFAULT_SETTINGS);

export function updateSettings(change: Partial<Settings>): void {
  settings.set(value => ({...value, ...change}));
}

/** What is wrong with a display name, or null. */
export function displayNameProblem(name: string): string | null {
  if (!name.trim()) return 'A display name is needed.';
  if (name.length > 30) return 'A display name is 30 characters at most.';
  return null;
}
