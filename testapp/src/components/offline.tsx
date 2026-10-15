// A banner while the device has no connection, which the app reads through
// expo-network: a browser's online state on web, the system's elsewhere.
import {useNetworkState} from 'expo-network';
import {Callout, theme} from 'expo-interface';
import {StyleSheet, View} from 'react-native';

export function OfflineBanner() {
  const {isConnected} = useNetworkState();
  if (isConnected !== false) return null;
  return (
    <View accessibilityRole="alert" testID="offline-banner" style={styles.banner}>
      <Callout color="label">You are offline. Changes stay on this device until you reconnect.</Callout>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {padding: 12, borderRadius: 12, backgroundColor: theme.backgroundSelected},
});
