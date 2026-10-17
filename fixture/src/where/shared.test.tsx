import {Platform, Text} from 'react-native';
import {screen} from 'expo-vitest';
import {renderApp} from 'expo-vitest/router';

// A `.test.tsx` runs on every platform, and `screen` reads what it rendered
// the same way on each.
describe('a shared test', () => {
  it('runs on every platform', () => {
    expect(['ios', 'android', 'web', 'windows']).toContain(Platform.OS);
  });

  it('mounts an in-memory Expo Router app', async () => {
    await renderApp({index: () => <Text>Home</Text>});
    await expect(screen.getByText('Home')).toBeVisible();
  });
});
