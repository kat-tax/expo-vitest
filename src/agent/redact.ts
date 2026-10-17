/**
 * Hiding the run's secret values wherever text leaves the process: what the
 * model reads, the trace, the tree, the AI trace, an error's message, the
 * console while an agent step runs. A value is found in the forms text
 * carries it in: as it is, JSON-escaped, HTML-escaped and percent-encoded,
 * whatever its whitespace, in any case, and cut off at the end of a text.
 */
import {SECRET_FLOOR} from './secrets.ts';

/** The forms a value may appear in, each its own string. */
export function variantsOf(value: string): string[] {
  const html = value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[character] as string);
  return [...new Set([value, JSON.stringify(value).slice(1, -1), html, encodeURIComponent(value)])];
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A form as a pattern: each run of whitespace in it matches any run of whitespace. */
const patternOf = (variant: string) => variant.trim().split(/\s+/).map(escaped).join('\\s+');

export type Redact = (text: string) => string;

/**
 * What hides these secrets in a text. The longest form is tried first at
 * each place, so a secret that holds another is hidden as itself. A text
 * that ends with the start of a value, at least as long as the floor, has
 * that end hidden too, since a cut-off value is still the value.
 */
export function redactor(secrets: readonly {name: string; value: string}[]): Redact {
  const forms = secrets
    .filter(({value}) => value.length >= SECRET_FLOOR)
    .flatMap(({name, value}) => variantsOf(value).map(variant => ({name, variant})))
    .filter(({variant}) => variant.trim() !== '')
    .sort((a, b) => b.variant.length - a.variant.length);
  if (forms.length === 0) return text => text;
  const pattern = new RegExp(forms.map(({variant}) => `(${patternOf(variant)})`).join('|'), 'gi');
  return text => {
    const replaced = text.replace(pattern, (...match: unknown[]) => {
      const groups = match.slice(1, forms.length + 1);
      return `<secret:${forms[groups.findIndex(group => group !== undefined)]?.name}>`;
    });
    return hideTail(replaced, forms);
  };
}

/** The text with its end hidden where it is the start of a form, cut off, at least the floor long. */
function hideTail(text: string, forms: readonly {name: string; variant: string}[]): string {
  const lower = text.toLowerCase();
  let best: {name: string; length: number} | null = null;
  for (const {name, variant} of forms) {
    const start = variant.toLowerCase();
    for (let length = Math.min(start.length - 1, text.length); length >= SECRET_FLOOR; length--) {
      if (lower.endsWith(start.slice(0, length))) {
        if (!best || length > best.length) best = {name, length};
        break;
      }
    }
  }
  return best ? `${text.slice(0, text.length - best.length)}<secret:${best.name}>` : text;
}

/** A value with every string in it redacted, through arrays and plain objects, for what is written as JSON. */
export function redactDeep<T>(value: T, redact: Redact): T {
  if (typeof value === 'string') return redact(value) as T;
  if (Array.isArray(value)) return value.map(each => redactDeep(each, redact)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, each]) => [key, redactDeep(each, redact)])) as T;
  }
  return value;
}
