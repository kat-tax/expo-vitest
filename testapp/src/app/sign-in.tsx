// Sign-in: an email and a password, checked when sent. A malformed email is
// refused at once, a wrong password after the pretend server answers, and
// the button waits while it does. Unticking Remember me keeps the session
// for this launch only.
import {router} from 'expo-router';
import {Button, Checkbox, FieldGroup, Screen, TextField} from 'expo-interface';
import {useState} from 'react';
import {isEmail, signIn, WrongPassword} from '../store/account';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filled = email.trim() !== '' && password !== '';

  const submit = async () => {
    if (!filled || busy) return;
    if (!isEmail(email)) {
      setProblem('Enter an email address, such as ada@example.com.');
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await signIn(email, password, remember);
      router.replace('/notes');
    } catch (error) {
      setProblem(error instanceof WrongPassword ? error.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen native>
      <FieldGroup>
        <FieldGroup.Section title="Sign in" footer={problem ?? 'The demo account is ada@example.com.'} footerColor={problem ? 'destructive' : 'secondaryLabel'}>
          <TextField placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email" autoCapitalize="none" autoCorrect={false} returnKeyType="next" testID="sign-in-email" />
          <TextField placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry={!show} returnKeyType="go" onSubmit={() => void submit()} testID="sign-in-password" />
          <Checkbox label="Show password" value={show} onValueChange={setShow} testID="sign-in-show" />
          <Checkbox label="Remember me" value={remember} onValueChange={setRemember} testID="sign-in-remember" />
          <Button label="Sign in" onPress={() => void submit()} disabled={!filled} loading={busy} testID="sign-in-submit" />
        </FieldGroup.Section>
        <FieldGroup.Section>
          <Button label="Forgot your password?" variant="text" onPress={() => router.push('/forgot-password')} testID="sign-in-forgot" />
          <Button label="Create an account" variant="text" onPress={() => router.push('/sign-up')} testID="sign-in-create" />
        </FieldGroup.Section>
      </FieldGroup>
    </Screen>
  );
}
