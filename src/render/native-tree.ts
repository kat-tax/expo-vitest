/**
 * The tree a unit test rendered on iOS, Android or Windows, read as a
 * device's: a node for each host element a screen reader would announce, in
 * the shape the device layer reads on every platform, so `screen`, a locator
 * and a matcher work on a component as they do on a running app.
 *
 * React Native Testing Library renders through test-renderer, whose tree
 * holds host elements alone: each a native type, such as `RCTView` or
 * `RCTText`, with the props React Native hands the native side. Those props
 * are what a screen reader reads: a role, a label, a state, a value. Nothing
 * here needs React Native, so each rule is pinned by a test.
 */
import type {Kind} from '../harness/lib/roles.ts';
import type {SnapshotNode} from '../harness/lib/snapshot.ts';

/** A host element as test-renderer gives one. */
export interface HostElement {
  readonly type: string;
  readonly props: Record<string, any>;
  readonly children: readonly (HostElement | string)[];
}

/** The tree read: its nodes, and the element behind each node's ref, for a step to act on. */
export interface HostTree {
  nodes: SnapshotNode[];
  elements: Map<string, HostElement>;
}

/** What a host type is, where its props say nothing: the words React Native's own components render as. */
const HOST_KINDS: Record<string, Kind> = {
  RCTText: 'text',
  Text: 'text',
  RCTSinglelineTextInputView: 'textbox',
  RCTMultilineTextInputView: 'textbox',
  AndroidTextInput: 'textbox',
  TextInput: 'textbox',
  RCTSwitch: 'switch',
  AndroidSwitch: 'switch',
  Switch: 'switch',
  RCTImageView: 'image',
  Image: 'image',
  RCTActivityIndicatorView: 'progressbar',
  AndroidProgressBar: 'progressbar',
  RCTModalHostView: 'dialog',
};

/** A host type's word for the tree, where its props name no role: shorter than the native class, and the same for the same component on iOS and Android. */
const HOST_WORDS: Record<string, string> = {
  RCTView: 'view',
  View: 'view',
  RCTText: 'text',
  Text: 'text',
  RCTSinglelineTextInputView: 'textinput',
  RCTMultilineTextInputView: 'textinput',
  AndroidTextInput: 'textinput',
  TextInput: 'textinput',
  RCTSwitch: 'switch',
  AndroidSwitch: 'switch',
  Switch: 'switch',
  RCTImageView: 'image',
  Image: 'image',
  RCTScrollView: 'scrollview',
  RCTScrollContentView: 'view',
  AndroidHorizontalScrollView: 'scrollview',
  RCTActivityIndicatorView: 'progressbar',
  AndroidProgressBar: 'progressbar',
  RCTModalHostView: 'modal',
  RCTSafeAreaView: 'view',
};

/** Text nested in a text, which a screen reader reads as part of the one around it. */
const NESTED_TEXT = new Set(['RCTVirtualText']);

/** Hosts a screen reader scrolls rather than presses, whose touch handlers are for the scrolling. */
const SCROLLERS = new Set(['RCTScrollView', 'AndroidHorizontalScrollView', 'RCTScrollContentView']);

/** React Native's roles, and the ARIA ones its `role` prop takes, as the one word for each kind. */
const ROLE_KINDS: Record<string, Kind> = {
  button: 'button',
  togglebutton: 'button',
  imagebutton: 'button',
  keyboardkey: 'button',
  link: 'link',
  header: 'heading',
  heading: 'heading',
  search: 'searchbox',
  searchbox: 'searchbox',
  image: 'image',
  img: 'image',
  text: 'text',
  adjustable: 'slider',
  slider: 'slider',
  checkbox: 'checkbox',
  switch: 'switch',
  radio: 'radio',
  radiogroup: 'radiogroup',
  tab: 'tab',
  tabbar: 'tablist',
  tablist: 'tablist',
  menu: 'menu',
  menubar: 'menu',
  menuitem: 'menuitem',
  progressbar: 'progressbar',
  combobox: 'combobox',
  dropdownlist: 'combobox',
  list: 'list',
  listitem: 'listitem',
  alert: 'alert',
  dialog: 'dialog',
  alertdialog: 'dialog',
  spinbutton: 'spinbutton',
  toolbar: 'toolbar',
  textbox: 'textbox',
  status: 'status',
  timer: 'status',
  summary: 'text',
  grid: 'group',
  group: 'group',
};

/** The kinds a person acts on, whatever handlers the host carries. */
const ACTIONABLE = new Set<Kind>(['button', 'link', 'checkbox', 'switch', 'tab', 'textbox', 'searchbox', 'slider', 'menuitem', 'radio', 'combobox', 'spinbutton']);

/** Roles that say the element is no control and nothing to announce. */
const NO_ROLE = new Set(['none', 'presentation']);

/** A style, flattened from the arrays React Native lets a component pass. */
function flat(style: unknown): Record<string, unknown> {
  if (!style || typeof style !== 'object') return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return style as Record<string, unknown>;
}

/** Whether a screen reader is told to pass over the element, and everything inside it. */
export function isHidden(props: Record<string, any>): boolean {
  return (
    props.accessibilityElementsHidden === true ||
    props.importantForAccessibility === 'no-hide-descendants' ||
    props['aria-hidden'] === true ||
    flat(props.style).display === 'none'
  );
}

/** The text an element holds, a screen reader's reading of it: its strings and those of the text nested in it, and of every element inside it where `deep`, with a space where one element's text ends and another's begins. */
export function textIn(element: HostElement, deep: boolean): string {
  const parts: string[] = [];
  for (const child of element.children) {
    if (typeof child === 'string') parts.push(child);
    else if (isHidden(child.props)) continue;
    else if (NESTED_TEXT.has(child.type)) parts.push(textIn(child, false));
    else if (deep) parts.push(` ${textIn(child, true)} `);
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/** A state from React Native's `accessibilityState`, or its ARIA prop, which wins where both are given. */
function stateOf(props: Record<string, any>, name: 'disabled' | 'selected' | 'checked' | 'busy' | 'expanded'): unknown {
  const aria = props[`aria-${name}`];
  return aria !== undefined ? aria : props.accessibilityState?.[name];
}

/** `true`, `false` or `'mixed'`, from a state given as any of them; undefined where it is not one. */
function tristate(value: unknown): boolean | 'mixed' | undefined {
  return value === 'mixed' ? 'mixed' : typeof value === 'boolean' ? value : undefined;
}

/** Whether a switch is on: iOS's native switch is told `value`, and Android's `on`. Undefined where neither says. */
export function switchedOn(props: Record<string, any>): boolean | undefined {
  const on = props.value ?? props.on;
  return typeof on === 'boolean' ? on : undefined;
}

/** Whether the element answers a press: a handler React Native's touchables and pressables give their host. */
function pressable(element: HostElement): boolean {
  if (SCROLLERS.has(element.type)) return false;
  const {props} = element;
  return Boolean(props.onClick ?? props.onPress ?? props.onLongPress ?? props.onResponderRelease ?? props.onStartShouldSetResponder);
}

/**
 * The tree under `root` as nodes, each with a ref in document order, and the
 * element behind each ref. An element is a node where a screen reader would
 * announce it, or a test name it: where it has a role, a label, a testID or
 * text of its own, or where a person can act on it. The rest are passed
 * through, their children read as the children of what holds them. `focused`
 * is the element that has the focus, which the driver keeps.
 */
export function readHostTree(root: HostElement | null, focused: HostElement | null = null): HostTree {
  const nodes: SnapshotNode[] = [];
  const elements = new Map<string, HostElement>();
  if (!root) return {nodes, elements};

  // Labels given by id: `aria-labelledby` and `accessibilityLabelledBy` name an element's `nativeID`.
  const byNativeId = new Map<string, HostElement>();
  const index = (element: HostElement) => {
    if (typeof element.props.nativeID === 'string') byNativeId.set(element.props.nativeID, element);
    for (const child of element.children) if (typeof child !== 'string') index(child);
  };
  index(root);
  const labelledBy = (props: Record<string, any>): string | undefined => {
    const ids = props['aria-labelledby'] ?? props.accessibilityLabelledBy;
    if (ids === undefined) return undefined;
    const named = (Array.isArray(ids) ? ids : String(ids).split(/\s+/)).map(id => byNativeId.get(id)).filter((each): each is HostElement => each !== undefined);
    return named.length ? named.map(each => textIn(each, true)).join(' ') : undefined;
  };

  const walk = (element: HostElement, parent: string | undefined, depth: number) => {
    const {props, type} = element;
    if (isHidden(props) || NESTED_TEXT.has(type)) return;
    const said = props.role ?? props.accessibilityRole;
    const role = typeof said === 'string' && !NO_ROLE.has(said) ? said : undefined;
    const kind = role ? ROLE_KINDS[role] : HOST_KINDS[type];
    const field = HOST_KINDS[type] === 'textbox';
    const toggle = HOST_KINDS[type] === 'switch';
    const label = props.accessibilityLabel ?? props['aria-label'] ?? labelledBy(props);
    const own = textIn(element, false);
    const acts = (kind !== undefined && ACTIONABLE.has(kind)) || field || toggle || pressable(element);
    // A control, or an element made accessible, is named by the text inside it, as a screen reader reads it.
    const container = acts || props.accessible === true;
    const name = typeof label === 'string' ? label : field ? '' : container ? textIn(element, true) : own;
    const testId = typeof props.testID === 'string' ? props.testID : undefined;
    const kept = kind !== undefined || role !== undefined || testId !== undefined || typeof label === 'string' || container || own !== '';
    let ref = parent;
    let childDepth = depth;
    if (kept) {
      ref = `@e${nodes.length + 1}`;
      childDepth = depth + 1;
      elements.set(ref, element);
      const disabled = stateOf(props, 'disabled') === true || props.disabled === true || (field && (props.editable === false || props.readOnly === true));
      const checked = tristate(stateOf(props, 'checked')) ?? (toggle ? switchedOn(props) : undefined);
      const selected = stateOf(props, 'selected');
      const expanded = stateOf(props, 'expanded');
      const secure = field && props.secureTextEntry === true;
      const text = props.value ?? props.text ?? props.defaultValue;
      const now = props.accessibilityValue?.text ?? props.accessibilityValue?.now ?? props['aria-valuetext'] ?? props['aria-valuenow'];
      const value = secure ? undefined : field ? (typeof text === 'string' ? text : '') : now === undefined ? undefined : String(now);
      const live = props['aria-live'] ?? props.accessibilityLiveRegion;
      const help = props.accessibilityHint;
      nodes.push({
        ref,
        role: role ?? HOST_WORDS[type] ?? type,
        ...(kind ? {kind} : {}),
        name: name.trim(),
        ...(testId ? {testId} : {}),
        depth,
        ...(parent ? {parent} : {}),
        interactive: acts,
        focused: element === focused,
        enabled: !disabled,
        offscreen: false,
        ...(typeof help === 'string' && help ? {help} : {}),
        ...(live === 'polite' || live === 'assertive' ? {live} : {}),
        ...(stateOf(props, 'busy') === true ? {status: 'Busy'} : {}),
        ...(kind === 'dialog' ? {dialog: true} : {}),
        ...(checked === undefined ? {} : {checked}),
        ...(typeof selected === 'boolean' ? {selected} : {}),
        ...(typeof expanded === 'boolean' ? {expanded} : {}),
        ...(value === undefined ? {} : {value}),
        ...(field && typeof props.placeholder === 'string' && props.placeholder ? {placeholder: props.placeholder} : {}),
        ...(secure ? {secure: true} : {}),
      });
    }
    for (const child of element.children) if (typeof child !== 'string') walk(child, ref, childDepth);
  };
  walk(root, undefined, 0);
  return {nodes, elements};
}
