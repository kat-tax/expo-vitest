import {Platform, Text, View} from 'react-native';
import {render, screen} from 'expo-vitest';
import {host, nodes} from 'expo-vitest/native';

// A `.native.test.tsx` runs on iOS and Android.
describe('a native test', () => {
  it('reads the host views it rendered', async () => {
    expect(['ios', 'android']).toContain(Platform.OS);
    await render(<View testID="box"><Text>Inside</Text></View>);
    await expect(screen.getByText('Inside')).toBeVisible();
    expect(nodes().length).toBeGreaterThan(1);
    expect(host(props => props.testID === 'box').type).toBe('RCTView');
  });
});
