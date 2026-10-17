/**
 * One word for what a node is, whichever platform drew it, so a test can ask
 * for a button on all four: a node's `kind`. The platform's own word stays in
 * `role`. A native type these tables do not know leaves `kind` absent rather
 * than guessed, and a test can still name it by `role` or `testId`.
 *
 * The spellings were read off real snapshots (`__fixtures__/`): agent-device
 * on an Android emulator, the Windows host on a react-native-windows app, the
 * web driver on react-native-web. iOS's are XCUIElement's type names, which
 * agent-device reports with or without the `XCUIElementType` prefix; no iOS
 * snapshot was at hand to read them off.
 */
import type {SnapshotNode} from './snapshot.ts';

export const KINDS = [
  'button',
  'textbox',
  'checkbox',
  'switch',
  'tab',
  'tablist',
  'link',
  'heading',
  'listitem',
  'menuitem',
  'radio',
  'slider',
  'progressbar',
  'dialog',
  'text',
  'image',
  'group',
  'list',
  'combobox',
  'searchbox',
  'spinbutton',
  'status',
  'alert',
  'toolbar',
  'menu',
  'radiogroup',
] as const;

export type Kind = (typeof KINDS)[number];

/** UI Automation's control types, as the host writes them. */
const WINDOWS: Record<string, Kind> = {
  CheckBox: 'checkbox',
  RadioButton: 'radio',
  ComboBox: 'combobox',
  Hyperlink: 'link',
  Image: 'image',
  List: 'list',
  ListItem: 'listitem',
  Menu: 'menu',
  MenuBar: 'menu',
  MenuItem: 'menuitem',
  ProgressBar: 'progressbar',
  Slider: 'slider',
  Spinner: 'spinbutton',
  SplitButton: 'button',
  Tab: 'tablist',
  TabItem: 'tab',
  ToolBar: 'toolbar',
  Group: 'group',
  Pane: 'group',
  StatusBar: 'status',
};

/**
 * A Windows node's kind. react-native-windows gives a switch and a toggle
 * button the same control type, `Button`, with the Toggle pattern and no
 * Invoke, as WinUI's ToggleSwitch has: that is a switch, the far commoner of
 * the two in an app. A `Button` inside a `Tab` is one of its tabs, an `Edit`
 * whose testID or name says search is a search box, a `Text` with a heading
 * level is a heading, and a `Window` is a dialog only when it says it is one.
 */
export function kindOnWindows(node: SnapshotNode, parent?: SnapshotNode): Kind | undefined {
  switch (node.role) {
    case 'Button':
      if (parent?.role === 'Tab') return 'tab';
      return node.patterns?.includes('Toggle') && !node.patterns.includes('Invoke') ? 'switch' : 'button';
    case 'Edit':
      return /search/i.test(`${node.testId ?? ''} ${node.name}`) ? 'searchbox' : 'textbox';
    case 'Text':
      return node.heading ? 'heading' : 'text';
    case 'Window':
      return node.dialog ? 'dialog' : undefined;
    default:
      return WINDOWS[node.role];
  }
}

/** Android widget classes by their simple name, as agent-device reports them. React Native names a view by its role. */
const ANDROID: Record<string, Kind> = {
  Button: 'button',
  ImageButton: 'button',
  EditText: 'textbox',
  AutoCompleteTextView: 'textbox',
  TextView: 'text',
  CheckBox: 'checkbox',
  Switch: 'switch',
  SwitchCompat: 'switch',
  ToggleButton: 'switch',
  RadioButton: 'radio',
  RadioGroup: 'radiogroup',
  SeekBar: 'slider',
  ProgressBar: 'progressbar',
  ImageView: 'image',
  RecyclerView: 'list',
  ListView: 'list',
  GridView: 'list',
  Spinner: 'combobox',
  TabLayout: 'tablist',
  TabWidget: 'tablist',
  BottomNavigationView: 'tablist',
  Toolbar: 'toolbar',
  NumberPicker: 'spinbutton',
  ViewGroup: 'group',
  FrameLayout: 'group',
  LinearLayout: 'group',
  RelativeLayout: 'group',
  ConstraintLayout: 'group',
  CardView: 'group',
  ScrollView: 'group',
  HorizontalScrollView: 'group',
};

/** agent-device's own word for a node, for a class the table above does not know. */
const AGENT_DEVICE: Record<string, Kind> = {
  button: 'button',
  'text-field': 'textbox',
  text: 'text',
  switch: 'switch',
  checkbox: 'checkbox',
  image: 'image',
  list: 'list',
  group: 'group',
  'scroll-area': 'group',
  cardview: 'group',
};

/** The simple name of a class: `android.widget.Switch` is `Switch`. */
function simpleName(type: string): string {
  return type.slice(type.lastIndexOf('.') + 1);
}

/**
 * An Android node's kind, from its class, or from agent-device's own word
 * for a class not in the table. A named child of a tab bar is a tab, as
 * agent-device reports a tab of `TabLayout` or `BottomNavigationView`. A
 * field whose testID or name says search is a search box, as on Windows,
 * since Android has no class for one.
 */
export function kindOnAndroid(type: string, agentKind: string | undefined, name: string, parentType?: string, testId?: string): Kind | undefined {
  const parent = parentType ? ANDROID[simpleName(parentType)] : undefined;
  if (parent === 'tablist' && name) return 'tab';
  const kind = ANDROID[simpleName(type)] ?? (agentKind ? AGENT_DEVICE[agentKind] : undefined);
  return kind === 'textbox' && /search/i.test(`${testId ?? ''} ${name}`) ? 'searchbox' : kind;
}

/** XCUIElement types without their prefix. */
const IOS: Record<string, Kind> = {
  Button: 'button',
  TextField: 'textbox',
  SecureTextField: 'textbox',
  TextView: 'textbox',
  SearchField: 'searchbox',
  StaticText: 'text',
  Switch: 'switch',
  Toggle: 'switch',
  Slider: 'slider',
  Link: 'link',
  Image: 'image',
  Cell: 'listitem',
  Table: 'list',
  CollectionView: 'list',
  TabBar: 'tablist',
  SegmentedControl: 'tablist',
  ProgressIndicator: 'progressbar',
  ActivityIndicator: 'status',
  Stepper: 'spinbutton',
  Toolbar: 'toolbar',
  Menu: 'menu',
  MenuItem: 'menuitem',
  RadioButton: 'radio',
  RadioGroup: 'radiogroup',
  CheckBox: 'checkbox',
  Alert: 'alert',
  Sheet: 'dialog',
  Dialog: 'dialog',
  Group: 'group',
  ScrollView: 'group',
};

/**
 * An iOS node's kind, from its XCUIElement type, or from agent-device's own
 * word for one whose type the table does not know: a read can name a
 * SwiftUI control by its class, `SwiftUI.AccessibilityNode`, where another
 * names it a Button. A button in a tab bar or a segmented control is one of
 * its tabs.
 */
export function kindOnIos(type: string, parentType?: string, agentKind?: string): Kind | undefined {
  const bare = (word: string) => word.replace(/^XCUIElementType/, '');
  const kind = IOS[bare(type)] ?? (agentKind ? AGENT_DEVICE[agentKind] : undefined);
  if (kind === 'button' && parentType && IOS[bare(parentType)] === 'tablist') return 'tab';
  return kind;
}

/**
 * A web node's kind, from the ARIA role the page gave it or the one its tag
 * carries without one. `img` is ARIA's word for an image. A plain element the
 * snapshot kept for its text is text.
 */
export function kindOnWeb(aria: string | undefined, leaf: boolean): Kind | undefined {
  if (aria === 'img') return 'image';
  if (aria && (KINDS as readonly string[]).includes(aria)) return aria as Kind;
  return !aria && leaf ? 'text' : undefined;
}

/** Each node with its kind, where `kindOf` knows one, given the node and the one it sits inside. */
export function withKinds(nodes: SnapshotNode[], kindOf: (node: SnapshotNode, parent?: SnapshotNode) => Kind | undefined): SnapshotNode[] {
  const byRef = new Map(nodes.map(node => [node.ref, node]));
  return nodes.map(node => {
    const kind = kindOf(node, node.parent ? byRef.get(node.parent) : undefined);
    return kind ? {...node, kind} : node;
  });
}
