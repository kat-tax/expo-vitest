import type {ImageSourcePropType} from 'react-native';

import add from '@expo/material-symbols/add.xml';
import archive from '@expo/material-symbols/archive.xml';
import deleteIcon from '@expo/material-symbols/delete.xml';
import description from '@expo/material-symbols/description.xml';
import edit from '@expo/material-symbols/edit.xml';
import moreVert from '@expo/material-symbols/more_vert.xml';
import settings from '@expo/material-symbols/settings.xml';
import star from '@expo/material-symbols/star.xml';

/** The Android vectors, by their Material names, which the tokens in icons.ts find. */
export const drawables: Record<string, ImageSourcePropType | undefined> = {add, archive, delete: deleteIcon, description, edit, more_vert: moreVert, settings, star};
