// Whether every store has read what was saved, so a route decides on that
// rather than on the first values.
import {useEffect, useState} from 'react';
import {account, onboarding} from './account';
import {notes} from './notes';
import {settings} from './settings';

const ready = Promise.all([onboarding.ready, account.ready, notes.ready, settings.ready]);
let done = false;
void ready.then(() => (done = true));

export function useStoresReady(): boolean {
  const [loaded, setLoaded] = useState(done);
  useEffect(() => {
    if (!loaded) void ready.then(() => setLoaded(true));
  }, [loaded]);
  return loaded;
}
