// The signed-in app: the notes and the settings, as the platform's tabs.
// Without an account it goes back to sign-in.
import {Redirect} from 'expo-router';
import {Tabs} from 'expo-interface';
import {notesIcon, settingsIcon} from '../../icons';
import {account} from '../../store/account';
import {useStoresReady} from '../../store/ready';
import {useStore} from '../../store/store';

export default function TabsLayout() {
  const loaded = useStoresReady();
  const {email} = useStore(account);
  if (loaded && !email) return <Redirect href="/sign-in" />;
  return (
    <Tabs
      routes={[
        {name: 'notes', href: '/notes', label: 'Notes', icon: notesIcon},
        {name: 'settings', href: '/settings', label: 'Settings', icon: settingsIcon},
      ]}
    />
  );
}
