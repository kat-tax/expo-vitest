import {describe, expect, it} from 'vitest';
import {redactDeep, redactor, variantsOf} from './redact.ts';

const ada = {name: 'ADA_PASSWORD', value: 'correct horse "battery"'};
const redact = redactor([ada]);

describe('the forms a value is found in', () => {
  it('are the value, JSON-escaped, HTML-escaped and percent-encoded, each once', () => {
    expect(variantsOf('a<b&"c\'')).toEqual(['a<b&"c\'', 'a<b&\\"c\'', 'a&lt;b&amp;&quot;c&#39;', 'a%3Cb%26%22c\'']);
    expect(variantsOf('plainvalue')).toEqual(['plainvalue']);
  });
});

describe('a redactor', () => {
  it('hides a value as it is, in any case', () => {
    expect(redact('typed correct horse "battery" into the field')).toBe('typed <secret:ADA_PASSWORD> into the field');
    expect(redact('CORRECT HORSE "BATTERY"')).toBe('<secret:ADA_PASSWORD>');
  });

  it('hides it JSON-escaped, HTML-escaped and percent-encoded', () => {
    expect(redact(JSON.stringify({password: ada.value}))).toBe('{"password":"<secret:ADA_PASSWORD>"}');
    expect(redact('<input value="correct horse &quot;battery&quot;">')).toBe('<input value="<secret:ADA_PASSWORD>">');
    expect(redact(`?p=${encodeURIComponent(ada.value)}&next=1`)).toBe('?p=<secret:ADA_PASSWORD>&next=1');
  });

  it('hides it whatever its whitespace has become', () => {
    expect(redact('correct\n  horse\t"battery"')).toBe('<secret:ADA_PASSWORD>');
  });

  it('hides each of several secrets, the one that holds another as itself', () => {
    const both = redactor([
      {name: 'SHORT', value: 'secret-one'},
      {name: 'LONG', value: 'secret-one-two'},
    ]);
    expect(both('secret-one-two and secret-one')).toBe('<secret:LONG> and <secret:SHORT>');
  });

  it('hides the start of a value where a text was cut off, at six characters or more', () => {
    expect(redact('the field now reads correct hor')).toBe('the field now reads <secret:ADA_PASSWORD>');
    expect(redact('a word: corre')).toBe('a word: corre');
    const token = redactor([{name: 'TOKEN', value: 'tok_abcdef123'}]);
    expect(token('…tok_abc')).toBe('…<secret:TOKEN>');
    expect(token('…tok_a')).toBe('…tok_a');
  });

  it('is the same the second time, and leaves a text without the values as it is', () => {
    const once = redact(`one ${ada.value} two`);
    expect(redact(once)).toBe(once);
    expect(redact('nothing secret here')).toBe('nothing secret here');
  });

  it('hides nothing without secrets, or with one under the floor', () => {
    expect(redactor([])('correct horse')).toBe('correct horse');
    expect(redactor([{name: 'PIN', value: '1234'}])('pin 1234')).toBe('pin 1234');
    expect(redactor([{name: 'BLANK', value: '      '}])('a      b')).toBe('a      b');
  });
});

describe('redacting a value for JSON', () => {
  it('hides every string in it, through arrays and plain objects, and leaves the rest', () => {
    const date = new Date(0);
    expect(redactDeep({text: ada.value, list: [ada.value, 3, null], nested: {deep: `x ${ada.value}`}, date}, redact)).toEqual({
      text: '<secret:ADA_PASSWORD>',
      list: ['<secret:ADA_PASSWORD>', 3, null],
      nested: {deep: 'x <secret:ADA_PASSWORD>'},
      date,
    });
    expect(redactDeep(ada.value, redact)).toBe('<secret:ADA_PASSWORD>');
  });
});
