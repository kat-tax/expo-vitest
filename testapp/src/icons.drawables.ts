import type {ImageSourcePropType} from 'react-native';

/** iOS, web and Windows draw icons from their own fonts; Android's vectors are in icons.drawables.android.ts. */
export const drawables: Record<string, ImageSourcePropType | undefined> = {};
