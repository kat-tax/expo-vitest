import path from 'node:path';
import {describe, expect, it} from 'vitest';
import type {SnapshotNode} from '../harness/lib/snapshot.ts';
import {RESERVED_TOOLS, canFill, canNavigate, canRead, canUpload, clearTaint, pixelsAllowed, secureMasks, taint, tainted} from './policy.ts';
import {secret} from './secrets.ts';

const node = (ref: string, role: string, extra: Partial<SnapshotNode> = {}): SnapshotNode => ({ref, role, name: '', depth: 1, interactive: true, ...extra});
const password = node('@e3', 'textbox', {secure: true, bounds: {x: 0, y: 0, width: 100, height: 20}});
const email = node('@e2', 'textbox', {kind: 'textbox'});

describe('filling a secret', () => {
  it('is allowed for a param of the step, into a text field, a password into a password field', () => {
    expect(canFill(password, secret('ADA_PASSWORD'), ['ADA_PASSWORD'])).toEqual({allowed: true});
    expect(canFill(email, secret('API_TOKEN'), ['API_TOKEN'])).toEqual({allowed: true});
    expect(canFill(node('@e4', 'searchbox'), secret('QUERY'), ['QUERY'])).toEqual({allowed: true});
    expect(canFill(node('@e5', 'ComboBox', {kind: 'combobox'}), secret('CODE'), ['CODE'])).toEqual({allowed: true});
  });

  it('is refused for any other, with the reason', () => {
    expect(canFill(password, secret('ADA_PASSWORD'), [])).toEqual({allowed: false, why: "the secret ADA_PASSWORD is not one of this step's params, and only those can be filled"});
    expect(canFill(node('@e9', 'button'), secret('TOKEN'), ['TOKEN'])).toEqual({allowed: false, why: '@e9 is a button, and a secret goes into a text field only'});
    expect(canFill(node('@e9', 'textbox', {enabled: false}), secret('TOKEN'), ['TOKEN'])).toEqual({allowed: false, why: '@e9 is disabled'});
    expect(canFill(email, secret('ADA_PASSWORD'), ['ADA_PASSWORD'])).toEqual({allowed: false, why: 'ADA_PASSWORD is a password, and @e2 is not a password field'});
  });
});

describe('going somewhere', () => {
  it('is allowed to http, https, about:blank and the app\'s own scheme', () => {
    for (const url of ['http://localhost:8081/a', 'https://example.com', 'about:blank', 'myapp://settings']) expect(canNavigate(url, 'myapp')).toEqual({allowed: true});
    expect(canNavigate('MyApp://x', 'MYAPP')).toEqual({allowed: true});
  });

  it('is refused anywhere else, naming the schemes refused by name', () => {
    expect(canNavigate('file:///etc/passwd')).toEqual({allowed: false, why: 'file: URLs are refused, as are data:, javascript:, view-source:, blob:, filesystem:'});
    expect(canNavigate('javascript:alert(1)')).toMatchObject({allowed: false, why: expect.stringMatching(/^javascript: URLs are refused/)});
    expect(canNavigate('about:config')).toEqual({allowed: false, why: "about: is not a scheme the agent may open: it takes http, https, about:blank"});
    expect(canNavigate('other://x', 'myapp')).toEqual({allowed: false, why: "other: is not a scheme the agent may open: it takes http, https, about:blank and myapp:"});
    expect(canNavigate('not a url')).toEqual({allowed: false, why: '"not a url" is not a URL'});
  });
});

describe('giving a file input a file', () => {
  const root = path.resolve('/app');
  it('is allowed inside the project, and refused outside it or hidden', () => {
    expect(canUpload(root, 'fixtures/a.png')).toEqual({allowed: true});
    expect(canUpload(root, '../a.png')).toEqual({allowed: false, why: '../a.png is outside the project, and a file input is given files from inside it'});
    expect(canUpload(root, '.env')).toMatchObject({allowed: false});
  });
});

describe('reading a value', () => {
  it("is refused for a secure field's", () => {
    expect(canRead(password)).toEqual({allowed: false, why: '@e3 is a secure field, whose value is never read'});
    expect(canRead(email)).toEqual({allowed: true});
  });
});

describe('a picture of the screen', () => {
  it('leaves where no secret was filled, the platform takes one, and every secure field can be painted over', () => {
    expect(pixelsAllowed({tainted: false, canScreenshot: true, nodes: [password, email]})).toEqual({allowed: true});
    expect(secureMasks([password, email, node('@e7', 'textbox', {secure: true})])).toEqual([password.bounds]);
  });

  it('does not otherwise, with the reason', () => {
    expect(pixelsAllowed({tainted: true, canScreenshot: true, nodes: []})).toEqual({allowed: false, why: 'a secret was filled in this test, so no picture of the screen leaves it'});
    expect(pixelsAllowed({tainted: false, canScreenshot: false, nodes: []})).toEqual({allowed: false, why: 'the platform takes no screenshot'});
    expect(pixelsAllowed({tainted: false, canScreenshot: true, nodes: [node('@e8', 'textbox', {secure: true, bounds: null})]})).toEqual({
      allowed: false,
      why: 'the secure field @e8 has no bounds to paint over, so a picture could show it',
    });
  });
});

describe('the mark a filled secret leaves on a test', () => {
  it('is set, read and cleared, on the global object unless given another', () => {
    const store = {};
    expect(tainted(store)).toBe(false);
    taint(store);
    expect(tainted(store)).toBe(true);
    clearTaint(store);
    expect(tainted(store)).toBe(false);
    taint();
    expect(tainted()).toBe(true);
    clearTaint();
    expect(tainted()).toBe(false);
  });
});

describe('the reserved tool names', () => {
  it("are the agent's own and those e2e keeps", () => {
    expect(RESERVED_TOOLS).toContain('complete_step');
    expect(RESERVED_TOOLS).toContain('report_finding');
    expect(new Set(RESERVED_TOOLS).size).toBe(RESERVED_TOOLS.length);
  });
});
