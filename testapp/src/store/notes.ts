// The notes: seeded on first launch, so every list has something in it,
// with favourites, an archive, edits and deletes kept across a restart.
import {createStore} from './store';

export interface Note {
  id: string;
  title: string;
  body: string;
  favourite: boolean;
  archived: boolean;
  /** When it was last edited, as the list shows it. */
  edited: string;
}

const SEED: [string, string][] = [
  ['Groceries', 'Oat milk, apples, coffee beans, rice and a loaf of bread.'],
  ['Trip to Lisbon', 'Flights on the 12th. Book the tram tour and a table at the fado house.'],
  ['Quarterly report', 'Revenue up 8%. Hiring paused until the second quarter.'],
  ['Book club', 'Next month: The Left Hand of Darkness. Bring snacks.'],
  ['Garden plan', 'Tomatoes by the fence, herbs in the window boxes, beans along the path.'],
  ['Gift ideas', 'A good pen for Sam, a cookbook for Alex, gloves for Mum.'],
  ['Running log', '5 km on Monday, 8 km on Thursday, long run on Sunday.'],
  ['Recipes to try', 'Shakshuka, miso soup, lemon drizzle cake.'],
  ['Meeting notes', 'Ship the beta on Friday. Ask design about the empty states.'],
  ['Car service', 'Due in March. Tyres are fine, wipers need replacing.'],
  ['Reading list', 'Three essays on attention, and the history of the printing press.'],
  ['Passwords to change', 'The router, the old email account and the bank app.'],
  ['Moving checklist', 'Boxes, tape, the van on Saturday morning, and redirect the post.'],
  ['Podcast ideas', 'An episode on maps, one on bread, one on bridges.'],
  ['Birthday party', 'Saturday at four. Cake, candles and the playlist.'],
  ['Workout plan', 'Push, pull, legs, and rest on the weekend.'],
  ['House repairs', 'The dripping tap, the loose stair, the attic window.'],
  ['Learning Spanish', 'Twenty minutes a day. Verbs this week.'],
  ['Budget', 'Rent, food, transport, savings, and a little for fun.'],
  ['Weekend', 'Farmers market in the morning, the museum after lunch.'],
];

const seeded: Note[] = SEED.map(([title, body], at) => ({
  id: String(at + 1),
  title,
  body,
  favourite: at === 1 || at === 4,
  archived: at === 9,
  edited: `Oct ${20 - at > 0 ? 20 - at : 1}`,
}));

export const notes = createStore('testapp.notes', {items: seeded, next: seeded.length + 1});

export function noteById(id: string): Note | undefined {
  return notes.get().items.find(note => note.id === id);
}

export function updateNote(id: string, change: Partial<Note>): void {
  notes.set(value => ({...value, items: value.items.map(note => (note.id === id ? {...note, ...change} : note))}));
}

export function addNote(): Note {
  const {next} = notes.get();
  const note: Note = {id: String(next), title: 'Untitled note', body: '', favourite: false, archived: false, edited: 'Today'};
  notes.set(value => ({items: [note, ...value.items], next: value.next + 1}));
  return note;
}

export function deleteNote(id: string): Note | undefined {
  const gone = noteById(id);
  notes.set(value => ({...value, items: value.items.filter(note => note.id !== id)}));
  return gone;
}

export function restoreNote(note: Note): void {
  notes.set(value => ({...value, items: [note, ...value.items]}));
}

export type Filter = 'all' | 'favourites' | 'archived';

/** The notes a search and a filter leave. */
export function visibleNotes(items: Note[], query: string, filter: Filter): Note[] {
  const wanted = query.trim().toLowerCase();
  return items.filter(note => {
    if (filter === 'favourites' && !note.favourite) return false;
    if (filter === 'archived' ? !note.archived : note.archived) return false;
    return !wanted || note.title.toLowerCase().includes(wanted) || note.body.toLowerCase().includes(wanted);
  });
}
