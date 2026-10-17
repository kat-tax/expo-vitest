// The notes: a search that narrows the list and an empty state that clears
// it, the filters, a favourite and an archive from a row's own menu, and a
// new note that opens in the editor.
import {device, screen} from 'expo-vitest';
import {field, rowAction, searchField, signedIn} from './helpers';

// A row by its title, pressed there as a finger would. On web a row with a
// menu of its own has no role to find it by: expo-interface draws it as a
// plain element (kat-tax/expo-interface#22, item 1).
const row = (title: string) => screen.getByText(title);
const search = searchField;

// On web, choosing an item in a row's menu opens the row as well: in
// expo-interface 0.32 the menu sits inside the row's clickable wrapper, and
// the item's click bubbles up to it (kat-tax/expo-interface#22, item 2).
// Marked as failing there until that is fixed, when the mark fails the run
// and comes off.
// On Windows the row's menu is a WinUI flyout, in a window of its own, which
// the tree reads after the app's main window.
const rowMenu = device.platform === 'web' ? it.fails : it;

// On Android the search, once it holds text, is named by that text rather
// than "Search notes": expo-interface names a field by its placeholder alone
// (kat-tax/expo-interface#22, item 3). Marked failing there until the kit
// names its fields.
const searchName = device.platform === 'android' ? it.fails : it;

// A filter by its name, which every platform draws as a control that can be
// on: a pressed button on web, a checkbox on Android, and on Windows a toggle
// button, which reads as checked.
const filter = (name: string) => screen.getByLabelText(name);
const expectOn = (name: string) => (device.platform === 'web' ? expect(filter(name)).toBePressed() : expect(filter(name)).toBeChecked());

beforeEach(signedIn);

searchName('narrows the list as the search is typed, and clears an empty search from its empty state', async () => {
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
  await filter('Favourites').press();
  await expectOn('Favourites');
  await expect(row('Trip to Lisbon')).toBeVisible();
  await expect(row('Groceries')).toBeHidden();
  await filter('Archived').press();
  await expect(row('Car service')).toBeVisible();
  await expect(row('Trip to Lisbon')).toBeHidden();
});

rowMenu('favourites a note from its row, which the favourites then show', async () => {
  await rowAction(row('Groceries'), 'Add to favourites');
  await filter('Favourites').press();
  await expect(row('Groceries')).toBeVisible();
});

rowMenu('archives a note from its row, which leaves the list for the archive', async () => {
  await rowAction(row('Groceries'), 'Archive');
  await expect(row('Groceries')).toBeHidden();
  await filter('Archived').press();
  await expect(row('Groceries')).toBeVisible();
});

it('throws away a new note left without a word', async () => {
  await screen.getByRole('button', {name: 'New note'}).press();
  await screen.getByRole('button', {name: 'Cancel'}).press();
  await expect(search()).toBeVisible();
  await expect(row('Untitled note')).toBeHidden();
});

it('opens a new note in the editor', async () => {
  await screen.getByRole('button', {name: 'New note'}).press();
  await expect(field('Title', 'note-title')).toHaveValue('Untitled note');
});
