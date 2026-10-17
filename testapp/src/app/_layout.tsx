// The root: the accent the settings choose, toasts from anywhere, the
// navigation theme from the palette, and the kit's stack, which draws on
// Windows too, where react-native-screens draws nothing.
import {ThemeProvider} from 'expo-router';
import {AccentProvider, Stack, ToastProvider, setColorScheme, useNavTheme} from 'expo-interface';
import {useEffect} from 'react';
import '../icons';
import {settings} from '../store/settings';
import {useStore} from '../store/store';

function Navigation() {
  return (
    <ThemeProvider value={useNavTheme()}>
      <Stack screenOptions={{headerShown: false}} />
    </ThemeProvider>
  );
}

export default function Layout() {
  const {accent, theme} = useStore(settings);
  useEffect(() => setColorScheme(theme), [theme]);
  return (
    <AccentProvider seed={accent}>
      <ToastProvider>
        <Navigation />
      </ToastProvider>
    </AccentProvider>
  );
}
