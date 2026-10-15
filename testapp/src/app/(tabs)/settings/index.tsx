// Settings: one of each kind of control a settings screen has, each saved
// as it changes, a field whose problem shows under its section, and the
// actions that need a confirmation: signing out, resetting the app, and
// deleting the account, which asks for a word typed first.
import Constants from 'expo-constants';
import {router} from 'expo-router';
import {
  Alert,
  Button,
  Checkbox,
  ColorPicker,
  DateTimePicker,
  FieldGroup,
  ListItem,
  Picker,
  Screen,
  SegmentedControl,
  Slider,
  Stepper,
  Switch,
  TextField,
  useToast,
} from 'expo-interface';
import {useState} from 'react';
import {account, onboarding, signOut} from '../../../store/account';
import {notes} from '../../../store/notes';
import type {Frequency, Theme} from '../../../store/settings';
import {ACCENTS, displayNameProblem, settings, updateSettings} from '../../../store/settings';
import {useStore} from '../../../store/store';

export default function SettingsScreen() {
  const value = useStore(settings);
  const {email} = useStore(account);
  const toast = useToast();
  const [asking, setAsking] = useState<'sign-out' | 'reset' | 'delete' | null>(null);
  const [typed, setTyped] = useState('');
  const problem = displayNameProblem(value.displayName);
  const close = () => {
    setAsking(null);
    setTyped('');
  };

  const leave = () => {
    close();
    signOut();
    router.replace('/sign-in');
  };
  const reset = async () => {
    close();
    await Promise.all([onboarding.reset(), account.reset(), notes.reset(), settings.reset()]);
    router.replace('/onboarding');
  };
  const remove = async () => {
    close();
    await Promise.all([account.reset(), notes.reset(), settings.reset()]);
    router.replace('/sign-in');
    toast.show('Your account was deleted');
  };

  return (
    <Screen native underBar>
      <FieldGroup>
        <FieldGroup.Section title="Account" footer={problem ?? undefined} footerColor="destructive">
          <TextField placeholder="Display name" value={value.displayName} onChangeText={displayName => updateSettings({displayName})} maxLength={40} testID="settings-name" />
          <ListItem value={email ?? ''} testID="settings-email">
            Email
          </ListItem>
          <Button label="Sign out" role="destructive" variant="text" onPress={() => setAsking('sign-out')} testID="settings-sign-out" />
        </FieldGroup.Section>
        <FieldGroup.Section title="Notifications">
          <Switch label="Push notifications" value={value.push} onValueChange={push => updateSettings({push})} testID="settings-push" />
          <Switch label="Email digest" supporting="A summary of your notes by email." value={value.digest} onValueChange={digest => updateSettings({digest})} testID="settings-digest" />
          <Picker label="Digest frequency" selectedValue={value.frequency} onValueChange={frequency => updateSettings({frequency: frequency as Frequency})} disabled={!value.digest} testID="settings-frequency">
            <Picker.Item label="Daily" value="daily" />
            <Picker.Item label="Weekly" value="weekly" />
            <Picker.Item label="Monthly" value="monthly" />
          </Picker>
          <DateTimePicker label="Quiet hours from" mode="time" value={new Date(value.quietFrom)} onChange={date => updateSettings({quietFrom: date.toISOString()})} testID="settings-quiet" />
        </FieldGroup.Section>
        <FieldGroup.Section title="Appearance">
          <SegmentedControl label="Theme" selectedValue={value.theme} onValueChange={theme => updateSettings({theme: theme as Theme})} testID="settings-theme">
            <SegmentedControl.Item label="System" value="system" />
            <SegmentedControl.Item label="Light" value="light" />
            <SegmentedControl.Item label="Dark" value="dark" />
          </SegmentedControl>
          <ColorPicker label="Accent" value={value.accent} onValueChange={accent => updateSettings({accent})} swatches={ACCENTS} supportsOpacity={false} presentation="menu" testID="settings-accent" />
          <Slider label={`Text size ${Math.round(value.textSize * 100)}%`} value={value.textSize} min={0.8} max={1.4} step={0.1} onValueChange={textSize => updateSettings({textSize: Math.round(textSize * 10) / 10})} testID="settings-text-size" />
          <Stepper label="Notes per page" value={value.perPage} min={10} max={50} step={10} onValueChange={perPage => updateSettings({perPage})} testID="settings-per-page" />
        </FieldGroup.Section>
        <FieldGroup.Section title="Privacy">
          <Checkbox label="Share usage data" value={value.shareUsage} onValueChange={shareUsage => updateSettings({shareUsage})} testID="settings-usage" />
          <Checkbox label="Personalised suggestions" value={value.suggestions} onValueChange={suggestions => updateSettings({suggestions})} testID="settings-suggestions" />
        </FieldGroup.Section>
        <FieldGroup.Section title="Danger zone" footer="Resetting brings back the first launch, with the notes it started with.">
          <Button label="Reset the app" role="destructive" variant="text" onPress={() => setAsking('reset')} testID="settings-reset" />
          <Button label="Delete account" role="destructive" variant="text" onPress={() => setAsking('delete')} testID="settings-delete" />
        </FieldGroup.Section>
        <FieldGroup.Section title="About">
          <ListItem value={Constants.expoConfig?.version ?? '1.0.0'} testID="settings-version">
            Version
          </ListItem>
        </FieldGroup.Section>
      </FieldGroup>
      <Alert
        visible={asking === 'sign-out'}
        title="Sign out?"
        message="You can sign back in with your email and password."
        actions={[
          {label: 'Cancel', role: 'cancel', onPress: close},
          {label: 'Sign out', role: 'destructive', onPress: leave},
        ]}
        onDismiss={close}
        testID="settings-sign-out-confirm"
      />
      <Alert
        visible={asking === 'reset'}
        title="Reset the app?"
        message="Your notes and settings go back to how they were on the first launch."
        actions={[
          {label: 'Cancel', role: 'cancel', onPress: close},
          {label: 'Reset', role: 'destructive', onPress: () => void reset()},
        ]}
        onDismiss={close}
        testID="settings-reset-confirm"
      />
      <Alert
        visible={asking === 'delete'}
        title="Delete your account?"
        message="This cannot be undone. Type DELETE to confirm."
        input={{placeholder: 'DELETE', value: typed, onChangeText: setTyped, autoCapitalize: 'characters', autoCorrect: false, testID: 'settings-delete-word'}}
        actions={[
          {label: 'Cancel', role: 'cancel', onPress: close},
          {label: 'Delete', role: 'destructive', disabled: typed !== 'DELETE', onPress: () => void remove()},
        ]}
        onDismiss={close}
        testID="settings-delete-confirm"
      />
    </Screen>
  );
}
