import {defineConfig} from 'vitest/config';
import {deviceConfig} from 'expo-vitest';

// Web by default; TESTAPP_PLATFORMS names others, as android,web.
const platforms = (process.env.TESTAPP_PLATFORMS?.split(',') ?? ['web']) as ('web' | 'android' | 'ios' | 'windows')[];

export default defineConfig(deviceConfig({platforms}));
