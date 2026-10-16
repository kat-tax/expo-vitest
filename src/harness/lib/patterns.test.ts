import {describe, expect, it} from 'vitest';
import type {SnapshotNode} from './snapshot.ts';
import {afterFill, afterPress, chooseFill, choosePress, scrollerAt} from './patterns.ts';

describe('choosePress', () => {
  it('presses through Invoke, then Toggle, then SelectionItem', () => {
    expect(choosePress(['Invoke', 'Toggle', 'SelectionItem', 'ScrollItem'])).toBe('invoke');
    expect(choosePress(['Toggle', 'SelectionItem', 'ScrollItem'])).toBe('toggle');
    expect(choosePress(['SelectionItem', 'ScrollItem'])).toBe('select');
  });

  it('uses the pointer for a control none of them press, and when asked to', () => {
    expect(choosePress(['ScrollItem', 'Value', 'ExpandCollapse'])).toBe('pointer');
    expect(choosePress([])).toBe('pointer');
    expect(choosePress(undefined)).toBe('pointer');
    expect(choosePress(['Invoke'], 'pointer')).toBe('pointer');
  });
});

describe('chooseFill', () => {
  it('fills through Value where the control has it, and types otherwise or when asked to', () => {
    expect(chooseFill(['Value', 'ScrollItem'])).toBe('setValue');
    expect(chooseFill(['ScrollItem'])).toBe('keys');
    expect(chooseFill(undefined)).toBe('keys');
    expect(chooseFill(['Value'], 'keys')).toBe('keys');
  });
});

describe('afterPress', () => {
  it('keeps a press whose state was seen to change, and one with no state to read', () => {
    expect(afterPress({pattern: 'SelectionItem', changed: true})).toBe('verified');
    expect(afterPress({pattern: 'Invoke'})).toBe('done');
  });

  it('goes on with the pointer when the state stayed as it was, the pattern was not there, or the call failed', () => {
    expect(afterPress({pattern: 'Toggle', changed: false})).toBe('pointer');
    expect(afterPress({unsupported: true})).toBe('pointer');
    expect(afterPress(null)).toBe('pointer');
  });
});

describe('afterFill', () => {
  it('keeps a fill the field took, and refuses a field that cannot take text', () => {
    expect(afterFill({pattern: 'Value', changed: true, value: 'how'})).toBe('verified');
    expect(afterFill({pattern: 'Value', readOnly: true})).toBe('readOnly');
  });

  it('clicks and types when the field stayed as it was, Value was not there, or the call failed', () => {
    expect(afterFill({pattern: 'Value', changed: false, value: ''})).toBe('keys');
    expect(afterFill({unsupported: true})).toBe('keys');
    expect(afterFill(null)).toBe('keys');
  });
});

describe('scrollerAt', () => {
  const node = (ref: string, bounds: SnapshotNode['bounds'], patterns?: string[]): SnapshotNode => ({ref, role: 'Pane', name: '', depth: 0, interactive: false, bounds, ...(patterns ? {patterns} : {})});
  const page = node('@e1', {x: 0, y: 0, width: 400, height: 800}, ['Scroll']);
  const list = node('@e2', {x: 20, y: 100, width: 200, height: 300}, ['Scroll']);
  const button = node('@e3', {x: 30, y: 120, width: 100, height: 40}, ['Invoke']);

  it('is the innermost node with a Scroll pattern under the point', () => {
    expect(scrollerAt([page, list, button], {x: 50, y: 130})).toBe(list);
    expect(scrollerAt([list, page], {x: 50, y: 130})).toBe(list);
    expect(scrollerAt([list, page], {x: 300, y: 600})).toBe(page);
  });

  it('is null where nothing under the point scrolls by its pattern', () => {
    expect(scrollerAt([button, node('@e4', null, ['Scroll'])], {x: 50, y: 130})).toBeNull();
    expect(scrollerAt([list], {x: 220, y: 130})).toBeNull();
    expect(scrollerAt([list], {x: 19, y: 130})).toBeNull();
    expect(scrollerAt([list], {x: 50, y: 400})).toBeNull();
  });
});
