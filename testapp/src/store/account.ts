// The account: whether onboarding was seen, who is signed in, and the demo
// account a test signs in with. There is no server: a sign-in waits a
// moment, as one would, and checks the demo account written here.
import {createStore} from './store';

export const DEMO = {email: 'ada@example.com', password: 'testapp-demo-pass', name: 'Ada Lovelace'};

/** How long the pretend server takes to answer, in ms. */
export const SERVER_DELAY = 700;

export const onboarding = createStore('testapp.onboarding', {seen: false});

export interface Account {
  email: string | null;
  name: string | null;
  remember: boolean;
}

/** Kept across a restart only where the person asked to be remembered. */
export const account = createStore<Account>('testapp.account', {email: null, name: null, remember: true}, {persist: value => value.remember});

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Whether an email address looks like one. */
export const isEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());

export class WrongPassword extends Error {}

export async function signIn(email: string, password: string, remember: boolean): Promise<void> {
  await wait(SERVER_DELAY);
  if (email.trim().toLowerCase() !== DEMO.email || password !== DEMO.password) throw new WrongPassword('The email or the password is wrong.');
  account.set({email: DEMO.email, name: DEMO.name, remember});
}

export async function signUp(name: string, email: string): Promise<void> {
  await wait(SERVER_DELAY);
  account.set({email: email.trim(), name: name.trim(), remember: true});
}

export async function sendReset(_email: string): Promise<void> {
  await wait(SERVER_DELAY);
}

export function signOut(): void {
  account.set({email: null, name: null, remember: true});
}

/** How strong a password is, from 0 to 1, and what to call it. */
export function strengthOf(password: string): {value: number; label: string} {
  const points = [password.length >= 8, password.length >= 12, /[A-Z]/.test(password) && /[a-z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  if (password.length === 0) return {value: 0, label: 'None'};
  if (points <= 1) return {value: 0.25, label: 'Weak'};
  if (points <= 3) return {value: 0.6, label: 'Fair'};
  return {value: 1, label: 'Strong'};
}
