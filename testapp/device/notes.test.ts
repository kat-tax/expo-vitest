// The notes: a search that narrows the list and an empty state that clears
// it, the filters, a favourite and an archive from a row's own menu, and a
// new note that opens in the editor.
import {device, screen} from 'expo-vitest/device';
import {rowAction, signedIn} from './helpers';

// A row by its title, pressed there as a finger would. On web a row with a
// menu of its own has no role to find it by: expo-interface draws it as a
// plain element, which is a finding of this app's, not the test's.
const row = (title: string) => screen.getByText(title);
const search = () => screen.getByRole('searchbox', {name: 'Search notes'});

// On web, choosing an item in a row's menu opens the row as well: in
// expo-interface 0.32 the menu sits inside the row's clickable wrapper, and
// the item's click bubbles up to it. Marked as failing there until that is
// fixed, when the mark fails the run and comes off.
const rowMenu = device.platform === 'web' ? it.fails : it;

beforeEach(signedIn);

it('narrows the list as the search is typed, and clears an empty search from its empty state', async () => {
  await search().fill('lisbon');
  await expect(row('Trip to Lisbon')).toBeVisible();
  await expect(row('Groceries')).toBeHidden();
  await search().fill('nothing has this');
  await expect(screen.getByText('No notes match')).toBeVisible();
  await screen.getByRole('button', {name: 'Clear search'}).press();
  await expect(search()).toHaveValue('');
  await expect(row('Groceries')).toBeVisible();
});

it('filters the favourites and the archive', async () => {
  await screen.getByRole('button', {name: 'Favourites'}).press();
  await expect(screen.getByRole('button', {name: 'Favourites'})).toBePressed();
  await expect(row('Trip to Lisbon')).toBeVisible();
  await expect(row('Groceries')).toBeHidden();
  await screen.getByRole('button', {name: 'Archived'}).press();
  await expect(row('Car service')).toBeVisible();
  await expect(row('Trip to Lisbon')).toBeHidden();
});

rowMenu('favourites a note from its row, which the favourites then show', async () => {
  await rowAction(row('Groceries'), 'Add to favourites');
  await screen.getByRole('button', {name: 'Favourites'}).press();
  await expect(row('Groceries')).toBeVisible();
});

rowMenu('archives a note from its row, which leaves the list for the archive', async () => {
  await rowAction(row('Groceries'), 'Archive');
  await expect(row('Groceries')).toBeHidden();
  await screen.getByRole('button', {name: 'Archived'}).press();
  await expect(row('Groceries')).toBeVisible();
});

it('opens a new note in the editor', async () => {
  await screen.getByRole('button', {name: 'New note'}).press();
  await expect(screen.getByRole('textbox', {name: 'Title'})).toHaveValue('Untitled note');
});
