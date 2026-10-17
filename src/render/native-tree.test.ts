import type {HostElement} from './native-tree.ts';
import {isHidden, readHostTree, textIn} from './native-tree.ts';

/** A host element, as test-renderer gives one. */
function host(type: string, props: Record<string, any> = {}, ...children: (HostElement | string)[]): HostElement {
  return {type, props, children};
}

describe('readHostTree', () => {
  it('reads a pressable as a button named by its text, and the text inside it as text', () => {
    const tree = readHostTree(host('RCTView', {}, host('RCTView', {accessibilityRole: 'button', accessible: true, onClick: () => {}}, host('RCTText', {}, 'Save'))));
    expect(tree.nodes).toEqual([
      {ref: '@e1', role: 'button', kind: 'button', name: 'Save', depth: 0, interactive: true, focused: false, enabled: true, offscreen: false},
      {ref: '@e2', role: 'text', kind: 'text', name: 'Save', depth: 1, parent: '@e1', interactive: false, focused: false, enabled: true, offscreen: false},
    ]);
    expect(tree.elements.get('@e2')?.type).toBe('RCTText');
  });

  it('names a node by its label first, by an element named for it, and a control with neither by the text inside it', () => {
    const tree = readHostTree(
      host(
        'RCTView',
        {},
        host('RCTText', {nativeID: 'title'}, 'Wi-Fi'),
        host('RCTView', {'aria-label': 'Close', onClick: () => {}}, host('RCTText', {}, 'x')),
        host('RCTView', {accessibilityLabel: 'Back', onPress: () => {}}),
        host('RCTView', {accessibilityLabelledBy: 'title', accessibilityRole: 'switch'}),
        host('RCTView', {accessibilityLabelledBy: ['title'], accessibilityRole: 'radio', accessibilityState: {checked: true}}),
        host('RCTView', {'aria-labelledby': 'nowhere', accessible: true}, host('RCTText', {}, 'Two'), host('RCTText', {}, 'lines')),
      ),
    );
    expect(tree.nodes.map(node => [node.role, node.name])).toEqual([
      ['text', 'Wi-Fi'],
      ['view', 'Close'],
      ['text', 'x'],
      ['view', 'Back'],
      ['switch', 'Wi-Fi'],
      ['radio', 'Wi-Fi'],
      ['view', 'Two lines'],
      ['text', 'Two'],
      ['text', 'lines'],
    ]);
  });

  it('passes over what a screen reader is told to, with everything inside it', () => {
    const hidden = [{accessibilityElementsHidden: true}, {importantForAccessibility: 'no-hide-descendants'}, {'aria-hidden': true}, {style: [{flex: 1}, {display: 'none'}]}];
    for (const props of hidden) {
      expect(readHostTree(host('RCTView', {}, host('RCTView', props, host('RCTText', {}, 'gone')))).nodes, JSON.stringify(props)).toEqual([]);
      expect(isHidden(props)).toBe(true);
    }
    expect(isHidden({style: null})).toBe(false);
    expect(textIn(host('RCTText', {}, 'shown', host('RCTVirtualText', {'aria-hidden': true}, ' gone')), false)).toBe('shown');
  });

  it('reads a field: its value, its hint, a secure one with no value, and one that cannot be edited as disabled', () => {
    const tree = readHostTree(
      host(
        'RCTView',
        {},
        host('RCTSinglelineTextInputView', {accessibilityLabel: 'Name', value: 'Ada', placeholder: 'Your name', onChangeText: () => {}}),
        host('AndroidTextInput', {text: 'from text'}),
        host('TextInput', {defaultValue: 'from default', editable: false}),
        host('RCTMultilineTextInputView', {secureTextEntry: true, value: 'hunter22', readOnly: true}),
        host('RCTSinglelineTextInputView', {value: 7}),
      ),
    );
    expect(tree.nodes.map(({role, kind, name, value, placeholder, secure, enabled, interactive}) => ({role, kind, name, value, placeholder, secure, enabled, interactive}))).toEqual([
      {role: 'textinput', kind: 'textbox', name: 'Name', value: 'Ada', placeholder: 'Your name', secure: undefined, enabled: true, interactive: true},
      {role: 'textinput', kind: 'textbox', name: '', value: 'from text', placeholder: undefined, secure: undefined, enabled: true, interactive: true},
      {role: 'textinput', kind: 'textbox', name: '', value: 'from default', placeholder: undefined, secure: undefined, enabled: false, interactive: true},
      {role: 'textinput', kind: 'textbox', name: '', value: undefined, placeholder: undefined, secure: true, enabled: false, interactive: true},
      {role: 'textinput', kind: 'textbox', name: '', value: '', placeholder: undefined, secure: undefined, enabled: true, interactive: true},
    ]);
  });

  it('reads the states a control is in, from React Native and from ARIA, ARIA winning', () => {
    const tree = readHostTree(
      host(
        'RCTView',
        {},
        host('RCTSwitch', {value: true, accessibilityLabel: 'Wi-Fi'}),
        host('RCTView', {accessibilityRole: 'checkbox', accessibilityState: {checked: false}, 'aria-checked': 'mixed', accessibilityLabel: 'All'}),
        host('RCTView', {accessibilityRole: 'tab', accessibilityState: {selected: true, disabled: true}, accessibilityLabel: 'Notes'}),
        host('RCTView', {accessibilityRole: 'button', 'aria-expanded': false, accessibilityState: {busy: true}, accessibilityLabel: 'More'}),
        host('RCTView', {accessibilityRole: 'adjustable', accessibilityValue: {min: 0, max: 10, now: 4}, accessibilityLabel: 'Volume'}),
        host('RCTView', {role: 'slider', 'aria-valuetext': 'Loud', accessibilityLabel: 'Bass'}),
        host('RCTText', {accessibilityLiveRegion: 'polite', accessibilityHint: 'Updates as you type'}, 'Saved'),
        host('RCTText', {'aria-live': 'off'}, 'Quiet'),
        host('RCTView', {accessibilityRole: 'alertdialog', 'aria-label': 'Delete?', disabled: true}),
        host('AndroidSwitch', {value: 'on', accessibilityLabel: 'Odd'}),
        host('AndroidSwitch', {on: false, accessibilityLabel: 'Android'}),
      ),
    );
    const [wifi, all, notes, more, volume, bass, saved, quiet, dialog, odd, android] = tree.nodes;
    expect(android).toMatchObject({kind: 'switch', checked: false});
    expect(wifi).toMatchObject({kind: 'switch', checked: true, interactive: true});
    expect(all).toMatchObject({kind: 'checkbox', checked: 'mixed'});
    expect(notes).toMatchObject({kind: 'tab', selected: true, enabled: false});
    expect(more).toMatchObject({kind: 'button', expanded: false, status: 'Busy'});
    expect(volume).toMatchObject({kind: 'slider', value: '4', interactive: true});
    expect(bass).toMatchObject({role: 'slider', kind: 'slider', value: 'Loud'});
    expect(saved).toMatchObject({kind: 'text', live: 'polite', help: 'Updates as you type'});
    expect(quiet).not.toHaveProperty('live');
    expect(dialog).toMatchObject({kind: 'dialog', dialog: true, enabled: false});
    expect(odd).not.toHaveProperty('checked');
  });

  it('passes a plain view through, its children taking its place, and keeps one with a testID', () => {
    const tree = readHostTree(host('RCTView', {style: {flex: 1}}, host('RCTView', {testID: 'card'}, host('RCTView', {}, host('RCTText', {}, 'Inside')))));
    expect(tree.nodes).toMatchObject([
      {ref: '@e1', role: 'view', name: '', testId: 'card', depth: 0, interactive: false},
      {ref: '@e2', role: 'text', name: 'Inside', depth: 1, parent: '@e1'},
    ]);
    expect(tree.nodes[0]).not.toHaveProperty('kind');
  });

  it('reads text nested in a text as part of it, with a space only where an element ends', () => {
    const tree = readHostTree(host('RCTText', {}, 'Hello, ', host('RCTVirtualText', {}, 'Ada'), '!'));
    expect(tree.nodes.map(node => node.name)).toEqual(['Hello, Ada!']);
  });

  it("names a host it does not know by its type, as a Windows project's native component, and takes a role it does not know as the role", () => {
    const tree = readHostTree(
      host('RCTView', {}, host('ExpoInterfaceToggleSwitch', {accessibilityLabel: 'Wi-Fi', value: true}), host('RCTView', {role: 'marquee'}, host('RCTText', {}, 'News')), host('RCTView', {role: 'none'}, host('RCTText', {}, 'Plain'))),
    );
    expect(tree.nodes.map(({role, kind, name}) => ({role, kind, name}))).toEqual([
      {role: 'ExpoInterfaceToggleSwitch', kind: undefined, name: 'Wi-Fi'},
      {role: 'marquee', kind: undefined, name: ''},
      {role: 'text', kind: 'text', name: 'News'},
      {role: 'text', kind: 'text', name: 'Plain'},
    ]);
  });

  it('takes a scroll view for something to scroll, not to press, and marks the element that has the focus', () => {
    const field = host('RCTSinglelineTextInputView', {accessibilityLabel: 'Search'});
    const tree = readHostTree(host('RCTScrollView', {onResponderRelease: () => {}, onStartShouldSetResponder: () => true}, host('RCTScrollContentView', {}, field)), field);
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0]).toMatchObject({name: 'Search', focused: true});
  });

  it('reads nothing where nothing was rendered', () => {
    expect(readHostTree(null)).toEqual({nodes: [], elements: new Map()});
  });
});
