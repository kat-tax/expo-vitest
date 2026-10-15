// Where the app opens: onboarding on a first launch, sign-in without an
// account, and the notes otherwise.
import {Redirect} from 'expo-router';
import {Screen, Spinner} from 'expo-interface';
import {account, onboarding} from '../store/account';
import {useStoresReady} from '../store/ready';
import {useStore} from '../store/store';

export default function Start() {
  const loaded = useStoresReady();
  const {seen} = useStore(onboarding);
  const {email} = useStore(account);
  if (!loaded) {
    return (
      <Screen>
        <Spinner testID="start-loading" />
      </Screen>
    );
  }
  if (!seen) return <Redirect href="/onboarding" />;
  if (!email) return <Redirect href="/sign-in" />;
  return <Redirect href="/notes" />;
}
