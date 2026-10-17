// The notes: a search that narrows the list and an empty state that clears
// it, the filters, a favourite and an archive from a row's own menu, and a
// new note that opens in the editor.
import {device, screen} from 'expo-vitest';
import {field, rowAction, searchField, signedIn} from './helpers';

// A row by its title, pressed there as a finger would.
const row = (title: string) => screen.getByText(title);
const search = searchField;

// A filter by its name, which every platform draws as a control that can be
// on: a pressed button on web, a checkbox on Android, and on Windows a toggle
// button, which reads as checked.
const filter = (name: string) => screen.getByLabelText(name);
const expectOn = (name: string) => (device.platform === 'web' ? expect(filter(name)).toBePressed() : expect(filter(name)).toBeChecked());

beforeEach(signedIn);

it('narrows the list as the search is typed, and clears an empty search from its empty state', async () => {
  await search().fill('lisbon');
  await expect(row('Trip to Lisbon')).toBeVisible();
  await expect(row('Groceries')).toBeHidden();
  await search().fill('nothing has this');
  await expect(screen.getByText('No notes match')).toBeVisible();
  // The empty state's own button, by its testID: on Android and iOS the
  // search field has a Clear search button of its own while it holds text.
  await screen.getByTestId('notes-empty-action').press();
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

it('favourites a note from its row, which the favourites then show', async () => {
  await rowAction(row('Groceries'), 'Add to favourites');
  await filter('Favourites').press();
  await expect(row('Groceries')).toBeVisible();
});

it('archives a note from its row, which leaves the list for the archive', async () => {
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
