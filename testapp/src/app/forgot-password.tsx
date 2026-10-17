// A forgotten password: an email, then a confirmation that a link was sent.
import {router} from 'expo-router';
import {Button, EmptyState, FieldGroup, Screen, Stack, TextField} from 'expo-interface';
import {useState} from 'react';
import {isEmail, sendReset} from '../store/account';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    if (!isEmail(email)) {
      setProblem('Enter the email address you signed up with.');
      return;
    }
    setProblem(null);
    setBusy(true);
    await sendReset(email);
    setBusy(false);
    setSent(true);
  };

  return (
    <Screen native header>
      <Stack.Screen options={{headerShown: true, title: 'Reset password'}} />
      {sent ? (
        <EmptyState title="Check your email" description={`We sent a link to ${email.trim()}. It works for an hour.`} action={{label: 'Back to sign in', onPress: () => router.back()}} testID="forgot-sent" />
      ) : (
        <FieldGroup>
          <FieldGroup.Section title="Your account" footer={problem ?? 'We will send a link to reset your password.'} footerColor={problem ? 'destructive' : 'secondaryLabel'}>
            <TextField placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email" autoCapitalize="none" autoCorrect={false} testID="forgot-email" />
            <Button label="Send link" onPress={() => void submit()} disabled={!email.trim()} loading={busy} testID="forgot-submit" />
          </FieldGroup.Section>
        </FieldGroup>
      )}
    </Screen>
  );
}
