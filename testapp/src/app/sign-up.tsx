// Sign-up: the longer form, checked when sent, each problem said under its
// section: a name, an email, a password with its strength, the same password
// again, a birth date, a country, and the terms agreed to.
import {router} from 'expo-router';
import {Button, Checkbox, DateTimePicker, FieldGroup, Footnote, Picker, Progress, Screen, Stack, TextField, useToast} from 'expo-interface';
import {useState} from 'react';
import {isEmail, signUp, strengthOf} from '../store/account';

const COUNTRIES = ['Australia', 'Brazil', 'Canada', 'Germany', 'India', 'Japan', 'United Kingdom', 'United States'];

/** The day eighteen years before today, as YYYY-MM-DD: the latest birth date the form takes. */
function adultBefore(): string {
  const today = new Date();
  return `${today.getFullYear() - 18}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

export default function SignUp() {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [born, setBorn] = useState('1990-01-01');
  const [country, setCountry] = useState('United Kingdom');
  const [agreed, setAgreed] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const strength = strengthOf(password);

  const problems = {
    about: !name.trim() ? 'Enter your name.' : !isEmail(email) ? 'Enter an email address, such as ada@example.com.' : null,
    password: password.length < 8 ? 'A password is 8 characters at least.' : again !== password ? 'The two passwords differ.' : null,
    terms: agreed ? null : 'Agree to the terms to go on.',
  };
  const shown = (problem: string | null) => (tried ? problem : null);

  const submit = async () => {
    setTried(true);
    if (problems.about || problems.password || problems.terms || busy) return;
    setBusy(true);
    try {
      await signUp(name, email);
      toast.show(`Welcome, ${name.trim()}`);
      router.replace('/notes');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen native header>
      <Stack.Screen options={{headerShown: true, title: 'Create account'}} />
      <FieldGroup>
        <FieldGroup.Section title="About you" footer={shown(problems.about) ?? undefined} footerColor="destructive">
          <TextField placeholder="Name" value={name} onChangeText={setName} autoCapitalize="words" testID="sign-up-name" />
          <TextField placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email" autoCapitalize="none" autoCorrect={false} testID="sign-up-email" />
          <DateTimePicker label="Date of birth" mode="date" value={born} maximumDate={adultBefore()} onChange={(_date, day) => setBorn(day)} testID="sign-up-born" />
          <Picker label="Country" selectedValue={country} onValueChange={value => setCountry(String(value))} testID="sign-up-country">
            {COUNTRIES.map(each => (
              <Picker.Item key={each} label={each} value={each} />
            ))}
          </Picker>
        </FieldGroup.Section>
        <FieldGroup.Section title="Password" footer={shown(problems.password) ?? undefined} footerColor="destructive">
          <TextField placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry testID="sign-up-password" />
          <Progress value={strength.value} testID="sign-up-strength" />
          <Footnote color="secondaryLabel">{`Strength: ${strength.label}`}</Footnote>
          <TextField placeholder="Password again" value={again} onChangeText={setAgain} secureTextEntry testID="sign-up-again" />
        </FieldGroup.Section>
        <FieldGroup.Section footer={shown(problems.terms) ?? undefined} footerColor="destructive">
          <Checkbox label="I agree to the terms" value={agreed} onValueChange={setAgreed} testID="sign-up-terms" />
          <Button label="Create account" onPress={() => void submit()} loading={busy} testID="sign-up-submit" />
        </FieldGroup.Section>
      </FieldGroup>
    </Screen>
  );
}
