// The notes: a search, filters for favourites and the archive, each row's
// own menu to favourite, archive or delete it (a right click on web, a long
// press on Android and Windows, a swipe on iOS), an empty state for a search
// that finds nothing, a star at a favourite's row's end, and a new note from
// the floating button.
import {router} from 'expo-router';
import {Chip, EmptyState, Fab, Icon, List, ListItem, NativeHost, Screen, SearchField, useToast} from 'expo-interface';
import {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {OfflineBanner} from '../../../components/offline';
import {addIcon, archiveIcon, deleteIcon, starIcon} from '../../../icons';
import type {Filter, Note} from '../../../store/notes';
import {addNote, deleteNote, notes, restoreNote, updateNote, visibleNotes} from '../../../store/notes';
import {useStore} from '../../../store/store';

const FILTERS: {value: Filter; label: string}[] = [
  {value: 'all', label: 'All'},
  {value: 'favourites', label: 'Favourites'},
  {value: 'archived', label: 'Archived'},
];

const EMPTY: Record<Filter, string> = {all: 'No notes yet', favourites: 'No favourites yet', archived: 'Nothing archived'};

export default function Notes() {
  const {items} = useStore(notes);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const shown = visibleNotes(items, query, filter);
  const toast = useToast();
  const remove = (note: Note) => {
    const gone = deleteNote(note.id);
    if (gone) toast.show({message: 'Note deleted', action: {label: 'Undo', onPress: () => restoreNote(gone)}, duration: 6000});
  };
  const create = () => {
    const note = addNote();
    router.push({pathname: '/notes/[id]', params: {id: note.id, edit: '1'}});
  };
  return (
    <Screen fab={<Fab label="New note" icon={addIcon} onPress={create} testID="notes-new" />}>
      <View style={styles.top}>
        <OfflineBanner />
        <SearchField value={query} onChangeText={setQuery} placeholder="Search notes" testID="notes-search" />
        <NativeHost fit direction="row" spacing={8}>
          {FILTERS.map(each => (
            <Chip key={each.value} label={each.label} selected={filter === each.value} onPress={() => setFilter(each.value)} testID={`notes-filter-${each.value}`} />
          ))}
        </NativeHost>
      </View>
      <List
        data={shown}
        keyExtractor={note => note.id}
        renderItem={note => (
          <ListItem
            supporting={note.body}
            value={note.edited}
            trailing={note.favourite ? <Icon icon={starIcon} size={18} tone="accent" testID={`notes-starred-${note.id}`} /> : undefined}
            swipeActions={[
              {label: note.favourite ? 'Remove from favourites' : 'Add to favourites', icon: starIcon, onPress: () => updateNote(note.id, {favourite: !note.favourite})},
              {label: note.archived ? 'Unarchive' : 'Archive', icon: archiveIcon, onPress: () => updateNote(note.id, {archived: !note.archived})},
              {label: 'Delete', icon: deleteIcon, role: 'destructive', onPress: () => remove(note)},
            ]}
            onPress={() => router.push({pathname: '/notes/[id]', params: {id: note.id}})}
            testID={`notes-row-${note.id}`}>
            {note.title}
          </ListItem>
        )}
        empty={
          query ? (
            <EmptyState title="No notes match" description={`Nothing has “${query.trim()}” in it.`} action={{label: 'Clear search', onPress: () => setQuery('')}} testID="notes-empty" />
          ) : (
            <EmptyState title={EMPTY[filter]} testID="notes-empty" />
          )
        }
        testID="notes-list"
        style={styles.list}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {gap: 12, paddingHorizontal: 16, paddingBottom: 8},
  list: {flex: 1},
});
