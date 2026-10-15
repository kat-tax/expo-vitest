import {describe, expect, it} from 'vitest';
import {SEND_KEYS, literal} from './windows-keys.ts';

describe('literal', () => {
  it('leaves plain text as it is', () => {
    expect(literal('Ada Lovelace 1815')).toBe('Ada Lovelace 1815');
  });

  it('puts each character SendKeys reads as syntax in braces, so it is typed as itself', () => {
    expect(literal('1+1=2 ^_^ 50% ~home (a) [b] {c}')).toBe('1{+}1=2 {^}_{^} 50{%} {~}home {(}a{)} {[}b{]} {{}c{}}');
  });

  it('types a line break as Enter and a tab as Tab', () => {
    expect(literal('one\ntwo\r\nthree\tfour')).toBe('one{ENTER}two{ENTER}three{TAB}four');
  });
});

describe('the keys', () => {
  it('are the ones a composite role uses, in SendKeys spelling', () => {
    expect(Object.keys(SEND_KEYS)).toEqual(['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Tab', 'Enter', 'Escape']);
    expect(SEND_KEYS.Escape).toBe('{ESC}');
  });
});
