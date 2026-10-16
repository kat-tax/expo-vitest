// A note: an edit saved with a toast, an edit left only after saying so,
// and a delete from the menu, undone from the toast.
import {device, screen} from 'expo-vitest/device';
import {alert, alertTitle, field, menuItem, signedIn} from './helpers';

beforeEach(async () => {
  await signedIn();
  await screen.getByText('Groceries').press();
  await expect(screen.getByRole('button', {name: 'Edit'})).toBeVisible();
});

it('saves an edit, and says so', async () => {
  await screen.getByRole('button', {name: 'Edit'}).press();
  await expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();
  await field('Title', 'note-title').fill('Groceries for Sunday');
  await screen.getByRole('button', {name: 'Save'}).press();
  await expect(screen.getByText('Saved')).toBeVisible();
  await expect(screen.getByText('Edited Today')).toBeVisible();
});

it('asks before it throws an edit away, and keeps it where asked to', async () => {
  await screen.getByRole('button', {name: 'Edit'}).press();
  await field('Write something', 'note-body').fill('Only coffee.');
  await screen.getByRole('button', {name: 'Cancel'}).press();
  await expect(alertTitle('Discard your changes?')).toBeVisible();
  await screen.getByRole('button', {name: 'Keep editing'}).press();
  await expect(field('Write something', 'note-body')).toHaveValue('Only coffee.');
  await screen.getByRole('button', {name: 'Cancel'}).press();
  await screen.getByRole('button', {name: 'Discard'}).press();
  await expect(screen.getByRole('button', {name: 'Edit'})).toBeVisible();
});

// The note leaves the list it goes back to, and on Android a List of
// expo-interface 0.32 throws as its rows change. Marked failing there until
// that is fixed.
(device.platform === 'android' ? it.fails : it)('deletes the note from its menu, and brings it back from the toast', async () => {
  await screen.getByRole('button', {name: 'More actions'}).press();
  await menuItem('Delete').press();
  await alert('Delete this note?').getByRole('button', {name: 'Delete'}).press();
  await expect(screen.getByText('Note deleted')).toBeVisible();
  await expect(screen.getByText('Groceries')).toBeHidden();
  await screen.getByRole('button', {name: 'Undo'}).press();
  await expect(screen.getByText('Groceries')).toBeVisible();
});
