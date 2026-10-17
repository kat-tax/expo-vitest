// A note: read it, edit it, save it with a toast, leave an edit with its
// changes only after saying so, and favourite, archive or delete it from a
// menu, a delete being undoable for a few seconds. A new note left before
// its first save is thrown away.
import {router, useLocalSearchParams} from 'expo-router';
import {Alert, Button, EmptyState, FieldGroup, ListItem, Menu, Screen, Stack, TextField, useToast} from 'expo-interface';
import {useState} from 'react';
import {archiveIcon, deleteIcon, editIcon, moreIcon, starIcon} from '../../../icons';
import {deleteNote, notes, restoreNote, updateNote} from '../../../store/notes';
import {useStore} from '../../../store/store';

/** How long the pretend save takes, in ms. */
const SAVE_DELAY = 500;

export default function NoteScreen() {
  const {id, edit} = useLocalSearchParams<{id: string; edit?: string}>();
  const note = useStore(notes).items.find(each => each.id === id);
  const toast = useToast();
  const [editing, setEditing] = useState(edit === '1');
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState<'discard' | 'delete' | null>(null);
  // A note made by New note, until its first save.
  const [fresh, setFresh] = useState(edit === '1');

  if (!note) {
    return (
      <Screen native underBar>
        <EmptyState title="This note is gone" description="It was deleted, or the link is wrong." action={{label: 'Back to notes', onPress: () => router.back()}} testID="note-missing" />
      </Screen>
    );
  }

  const changed = title !== note.title || body !== note.body;
  const startEditing = () => {
    setTitle(note.title);
    setBody(note.body);
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    await new Promise(resolve => setTimeout(resolve, SAVE_DELAY));
    updateNote(note.id, {title: title.trim() || 'Untitled note', body, edited: 'Today'});
    setFresh(false);
    setSaving(false);
    setEditing(false);
    toast.show('Saved');
  };
  const throwAway = () => {
    deleteNote(note.id);
    router.back();
  };
  const discard = () => {
    setAsking(null);
    if (fresh) {
      throwAway();
      return;
    }
    setTitle(note.title);
    setBody(note.body);
    setEditing(false);
  };
  const remove = () => {
    setAsking(null);
    const gone = deleteNote(note.id);
    router.back();
    if (gone) toast.show({message: 'Note deleted', action: {label: 'Undo', onPress: () => restoreNote(gone)}, duration: 6000});
  };

  return (
    <Screen native underBar>
      <Stack.Screen options={{title: editing ? 'Edit note' : note.title}} />
      {editing ? (
        <FieldGroup>
          <FieldGroup.Section title="Note">
            <TextField placeholder="Title" value={title} onChangeText={setTitle} testID="note-title" />
            <TextField placeholder="Write something" value={body} onChangeText={setBody} multiline testID="note-body" />
          </FieldGroup.Section>
          <FieldGroup.Section>
            <Button label="Save" onPress={() => void save()} disabled={!changed} loading={saving} testID="note-save" />
            <Button label="Cancel" variant="text" onPress={() => (changed ? setAsking('discard') : fresh ? throwAway() : setEditing(false))} testID="note-cancel" />
          </FieldGroup.Section>
        </FieldGroup>
      ) : (
        <FieldGroup>
          <FieldGroup.Section footer={`Edited ${note.edited}`}>
            <ListItem supporting={note.body || 'This note is empty.'} testID="note-text">
              {note.title}
            </ListItem>
            <Button label="Edit" prefixIcon={editIcon} onPress={startEditing} testID="note-edit" />
            <Menu
              label="More actions"
              icon={moreIcon}
              items={[
                {label: note.favourite ? 'Remove from favourites' : 'Add to favourites', icon: starIcon, onPress: () => updateNote(note.id, {favourite: !note.favourite})},
                {label: note.archived ? 'Unarchive' : 'Archive', icon: archiveIcon, onPress: () => updateNote(note.id, {archived: !note.archived})},
                {label: 'Delete', icon: deleteIcon, role: 'destructive', separator: true, onPress: () => setAsking('delete')},
              ]}
              testID="note-menu"
            />
          </FieldGroup.Section>
        </FieldGroup>
      )}
      <Alert
        visible={asking === 'discard'}
        title="Discard your changes?"
        message="The edits you made will be lost."
        actions={[
          {label: 'Keep editing', role: 'cancel', onPress: () => setAsking(null)},
          {label: 'Discard', role: 'destructive', onPress: discard},
        ]}
        onDismiss={() => setAsking(null)}
        testID="note-discard"
      />
      <Alert
        visible={asking === 'delete'}
        title="Delete this note?"
        message="You can undo this for a few seconds."
        actions={[
          {label: 'Cancel', role: 'cancel', onPress: () => setAsking(null)},
          {label: 'Delete', role: 'destructive', onPress: remove},
        ]}
        onDismiss={() => setAsking(null)}
        testID="note-delete"
      />
    </Screen>
  );
}
