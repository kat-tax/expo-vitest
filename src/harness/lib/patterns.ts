/**
 * How a press or a fill reaches a Windows control: through a UI Automation
 * pattern, which drives the control on UI Automation's own channel, with no
 * pointer, no foreground window and no need for a quiet desk; or as
 * synthetic input, which needs all three.
 *
 * A pattern that answers has not always done anything. In react-native-windows
 * 0.84 (`CompositionDynamicAutomationProvider.cpp`, `ComponentView.cpp`):
 *
 * | Pattern | Offered on | What a call does |
 * | --- | --- | --- |
 * | Invoke | a view with `onAccessibilityTap` | fires that handler, which the app wired for this |
 * | Toggle | a Switch, a view with `accessibilityState.checked`, or one that declares `toggle` | flips a Switch; on any other view, only sends `toggle`, and only if declared |
 * | SelectionItem | a view with `accessibilityState.selected` | only sends `select`, and only if declared |
 * | Value | a TextInput, or a view with a text `accessibilityValue` | sets a TextInput's text; on any other view, only sends `setValue`, if declared |
 *
 * UI Automation reports success either way, so a react-navigation tab, which
 * sets `selected` and declares nothing, would say it was pressed while nothing
 * happened. The host therefore reads the state back after a Toggle, a Select
 * and a SetValue, and a press is kept only where it changed. Invoke has no
 * state to read, and is kept, since a view only offers it with a handler.
 *
 * What each did, driven alone, on a react-native-windows 0.84 app made with
 * expo-windows 0.25: Select on a tab of a NavigationView changed the screen
 * and read back selected; SetValue on a TextInput filtered the app's list on
 * the text; ExpandCollapse on a ComboBox answered expanded, then collapsed;
 * Invoke on a disabled Button was refused. A Pressable with no accessibility
 * role offers only ScrollItem, so its press is synthetic.
 */

/** A press: through the first pattern that presses the control, or with the pointer. */
export type PressWay = 'invoke' | 'toggle' | 'select' | 'pointer';

/** A fill: through the Value pattern, or by clicking and typing. */
export type FillWay = 'setValue' | 'keys';

/** What the host says a pattern call did. */
export interface PatternAnswer {
  pattern?: string;
  /** Whether the control's state was seen to change; absent where there is no state to read, as after Invoke. */
  changed?: boolean;
  /** What a field reads after a SetValue. */
  value?: string;
  /** The control does not implement the pattern after all. */
  unsupported?: boolean;
  /** The field cannot take text: a person could not type in it either. */
  readOnly?: boolean;
}

/**
 * How to press a control that implements `patterns`. Invoke presses it,
 * Toggle flips it, SelectionItem picks it, in that order; a control with
 * none of them is pressed with the pointer, and `pointer` asks for the
 * pointer whatever it implements.
 */
export function choosePress(patterns: string[] | undefined, via?: 'pointer'): PressWay {
  if (via === 'pointer' || !patterns) return 'pointer';
  if (patterns.includes('Invoke')) return 'invoke';
  if (patterns.includes('Toggle')) return 'toggle';
  if (patterns.includes('SelectionItem')) return 'select';
  return 'pointer';
}

/** How to fill a control that implements `patterns`: through Value when it has it, unless `keys` asks for typing. */
export function chooseFill(patterns: string[] | undefined, via?: 'keys'): FillWay {
  return via !== 'keys' && patterns?.includes('Value') ? 'setValue' : 'keys';
}

/**
 * What a press does once a pattern answered: stop, seen to work (`verified`)
 * or with nothing to read back (`done`), or go on with the pointer, because
 * the call failed, the control did not have the pattern after all, or its
 * state stayed as it was.
 */
export function afterPress(answer: PatternAnswer | null): 'verified' | 'done' | 'pointer' {
  if (!answer || answer.unsupported) return 'pointer';
  if (answer.changed === undefined) return 'done';
  return answer.changed ? 'verified' : 'pointer';
}

/**
 * What a fill does once Value answered: stop, seen to work; refuse a field
 * that cannot take text; or click and type, because the call failed, the
 * field did not have Value after all, or it stayed as it was.
 */
export function afterFill(answer: PatternAnswer | null): 'verified' | 'readOnly' | 'keys' {
  if (!answer || answer.unsupported) return 'keys';
  if (answer.readOnly) return 'readOnly';
  return answer.changed ? 'verified' : 'keys';
}
