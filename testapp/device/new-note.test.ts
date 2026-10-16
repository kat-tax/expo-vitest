// A new note: made from the list, titled and saved in the editor, and found
// in the list on the way back.
import {screen} from 'expo-vitest/device';
import {field, openTab, searchField, signedIn} from './helpers';

beforeEach(signedIn);

// A saved note opens on its own page. The way back is the Notes tab, which
// every platform has: the back button is each platform's own, on Windows the
// navigation view's.
it('saves a new note with its title, which the list then shows', async () => {
  await screen.getByRole('button', {name: 'New note'}).press();
  await field('Title', 'note-title').fill('Weekly plan');
  await screen.getByRole('button', {name: 'Save'}).press();
  await expect(screen.getByText('Saved')).toBeVisible();
  await openTab('Notes');
  await expect(searchField()).toBeVisible();
  await expect(screen.getByText('Weekly plan')).toBeVisible();
});
