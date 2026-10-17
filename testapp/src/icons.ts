import {icon, registerDrawables} from 'expo-interface';
import {drawables} from './icons.drawables';

registerDrawables(drawables);

export const notesIcon = icon({ios: 'doc.text', android: 'description', web: 'description'});
export const settingsIcon = icon({ios: 'gearshape', android: 'settings', web: 'settings'});
export const starIcon = icon({ios: 'star', android: 'star', web: 'star'});
export const addIcon = icon({ios: 'plus', android: 'add', web: 'add'});
export const moreIcon = icon({ios: 'ellipsis.circle', android: 'more_vert', web: 'more_vert'});
export const editIcon = icon({ios: 'pencil', android: 'edit', web: 'edit'});
export const deleteIcon = icon({ios: 'trash', android: 'delete', web: 'delete'});
export const archiveIcon = icon({ios: 'archivebox', android: 'archive', web: 'archive'});
