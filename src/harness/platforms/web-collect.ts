/**
 * The script that reads a page's accessibility tree, in the page: the web
 * driver runs it in the browser, and a web unit test in jsdom, so a tree
 * reads the same from a running app and from a component a test rendered.
 */

/**
 * Runs in the page: reads every interesting element's role, name and box, and
 * gives it a ref. Given the counter of the last read, it answers `same` when
 * nothing has changed since, and the driver keeps what it read then. Given
 * `{layout: false}`, as for jsdom, which lays nothing out, an element is off
 * the screen where it is not drawn rather than where it has no size, and
 * has no bounds.
 */
export const COLLECT = `((last, options) => {
  const layout = !options || options.layout !== false;
  const state = window.__harness;
  const origin = performance.timeOrigin;
  // A CSS transition or animation moves boxes without a mutation, so while
  // one runs, as when a sheet slides in, the page is read afresh every time.
  const moving = () => document.getAnimations().some((animation) => animation.playState === 'running');
  if (last && state && last.origin === origin && last.generation === state.generation && !moving()) return {same: true};
  // A ref lasts as long as its element does in this document, so a node keeps
  // its ref while the page changes around it, and a ref from an earlier
  // snapshot still names its element if that is still there. Nothing is
  // written to the page: the app may be watching it.
  const refs = window.__harnessRefs || (window.__harnessRefs = {ids: new WeakMap(), next: 0, elements: new Map()});
  const idOf = (element) => {
    let id = refs.ids.get(element);
    if (id === undefined) { id = ++refs.next; refs.ids.set(element, id); }
    return id;
  };
  const elements = new Map();
  // What can be acted on, plus the leaves that carry text — the same two kinds
  // UI Automation reports on Windows, so a test finds a label on either. A
  // container's text is its children's, so only leaves are taken; that keeps
  // the tree small enough to read and to put in front of a model.
  const selector = '[role],[title],button,a,input,select,textarea,h1,h2,h3,h4,h5,h6,ul,ol,img,svg,progress,output,dialog,[popover],[tabindex],p,li,td,label,span,div';
  const ACTIONABLE = new Set(['button', 'link', 'a', 'menuitem', 'menuitemcheckbox', 'checkbox', 'switch', 'tab', 'textbox', 'input', 'select', 'textarea', 'slider', 'option', 'radio']);
  const depthOf = (node) => { let d = 0; for (let p = node.parentElement; p; p = p.parentElement) d++; return d; };
  // The refs given out by this collect, so a node's parent is the nearest
  // ancestor kept now.
  const kept = new Map();
  const parentOf = (node) => { for (let p = node.parentElement; p; p = p.parentElement) if (kept.has(p)) return kept.get(p); return undefined; };
  const nodes = [];
  const PLAIN = new Set(['P', 'LI', 'TD', 'LABEL', 'SPAN', 'DIV']);
  // Text as a screen reader reads it. An icon font, as @expo/vector-icons
  // draws icons, puts a character from the Private Use Area in the page for
  // each icon, which no screen reader reads as a word, so it is not text here.
  const readable = (text) => text.replace(/[\\uE000-\\uF8FF\\u{F0000}-\\u{FFFFD}\\u{100000}-\\u{10FFFD}]/gu, '').replace(/\\s+/g, ' ').trim();
  // An element's text: what is inside it, less what is hidden from a screen
  // reader, with a space where the text passes from one element to another.
  // react-native-web puts each line of a Pressable in a div of its own with
  // nothing between them, and joined bare they would run together.
  // Whether an element is drawn: not display: none, nor inside an element
  // that is, as a closed popover is, and not visibility: hidden, which
  // descendants inherit. Kept for the one read.
  const drawn = new Map();
  const isDrawn = (element) => {
    if (!element) return true;
    let known = drawn.get(element);
    if (known === undefined) {
      known = getComputedStyle(element).display !== 'none' && isDrawn(element.parentElement);
      drawn.set(element, known);
    }
    return known;
  };
  const shows = (element) => isDrawn(element) && getComputedStyle(element).visibility === 'visible';
  const textOf = (root) => {
    let text = '';
    let previous = null;
    // A screen reader leaves out what is not drawn, as a row's menu while it
    // is shut. An element not drawn itself keeps all its text, so a query
    // that takes hidden nodes still finds it by its name.
    const drawnRoot = shows(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const hidden = node.parentElement && node.parentElement.closest('[aria-hidden="true"]');
      if (hidden && hidden !== root && root.contains(hidden)) continue;
      if (drawnRoot && node.parentElement && !shows(node.parentElement)) continue;
      text += (previous && previous !== node.parentElement ? ' ' : '') + node.data;
      previous = node.parentElement;
    }
    return readable(text);
  };
  for (const element of document.querySelectorAll(selector)) {
    // What a screen reader is told to pass over is not in the tree, as it is
    // not on a device: an icon drawn as a font's ligature, as Material
    // Symbols draws one, is the icon's name as text under aria-hidden.
    if (element.closest('[aria-hidden="true"]')) continue;
    // What is inside an image is part of its picture, as ARIA has it.
    // react-native-web draws an Image given a role as an element with the
    // image's name, holding an <img> with the same alt.
    if (element.parentElement && element.parentElement.closest('[role="img"]')) continue;
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute('type') || '').toLowerCase();
    // An SVG's <title> names it, as an alt names an image, and is what
    // a browser shows over it, as a title attribute is.
    const svgTitle = tag === 'svg' ? [...element.children].find((child) => child.tagName.toLowerCase() === 'title') : undefined;
    const titled = readable(element.getAttribute('title') ?? '') || (svgTitle ? readable(svgTitle.textContent ?? '') : '');
    // An SVG nothing names or gives a role is drawing, which a screen reader passes over.
    if (tag === 'svg' && !element.hasAttribute('role') && !element.hasAttribute('aria-label') && !element.hasAttribute('aria-labelledby') && !titled) continue;
    const box = element.getBoundingClientRect();
    const role = element.getAttribute('role') ?? tag;
    // react-native-web draws a Pressable with no role as a div that takes the
    // focus (tabindex 0), or, disabled, one marked aria-disabled: a control
    // all the same, named by the text inside it.
    const pressable = PLAIN.has(element.tagName) && !element.hasAttribute('role') &&
      ((element.hasAttribute('tabindex') && element.tabIndex >= 0) || element.getAttribute('aria-disabled') === 'true' || element.isContentEditable);
    // A plain container earns a place only when it is the leaf holding the
    // text, or when it has a title, which a screen reader says.
    const holdsText = element.childElementCount === 0 && readable(element.textContent ?? '') !== '';
    if (PLAIN.has(element.tagName) && !element.hasAttribute('role') && !pressable && !titled && !holdsText) continue;
    // The accessible name, in the order a screen reader works it out. The
    // later steps are not optional niceties: a checkbox is an empty <input>
    // with no text of its own, and it takes its name from the <label> wrapped
    // round it — reading textContent alone reports it as nameless and fails
    // an accessibility assertion that is actually being met. An image is named
    // by its alt, and an SVG by its <title>.
    const byIds = (ids) => (ids ? ids.split(/\\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '');
    const alt = tag === 'img' || (tag === 'input' && type === 'image') ? readable(element.getAttribute('alt') ?? '') : '';
    let name = readable(byIds(element.getAttribute('aria-labelledby')));
    if (!name) name = readable(element.getAttribute('aria-label') ?? '');
    if (!name && element.labels && element.labels.length > 0) name = readable([...element.labels].map((each) => each.textContent ?? '').join(' '));
    if (!name) name = alt || (svgTitle ? readable(svgTitle.textContent ?? '') : '');
    // A plain container kept for its title alone is named by it, not by the text of what it holds.
    const container = PLAIN.has(element.tagName) && !element.hasAttribute('role') && !pressable && !holdsText;
    if (!name && !container) name = textOf(element);
    // A title attribute is the last a name is taken from, and where it is
    // not the name it describes, after what aria-describedby points at and
    // aria-description.
    const title = readable(element.getAttribute('title') ?? '');
    const namedByTitle = !name && title !== '';
    if (namedByTitle) name = title;
    name = name.slice(0, 80);
    const help = readable(byIds(element.getAttribute('aria-describedby'))) || readable(element.getAttribute('aria-description') ?? '') || (namedByTitle ? '' : title);
    const id = idOf(element);
    const ref = '@e' + id;
    elements.set(id, new WeakRef(element));
    // Elements come in document order, so an ancestor is always kept before
    // anything inside it.
    const parent = parentOf(element);
    kept.set(element, ref);
    // react-native-web writes testID as data-testid, and an app's own DOM
    // components write it directly, so both arrive here the same way.
    const testId = element.getAttribute('data-testid');
    // The state a control is in, present only where it has one: from ARIA,
    // and from the native control where there is no ARIA to say.
    const aria = (attribute) => element.getAttribute(attribute);
    const tristate = (value) => (value === 'true' ? true : value === 'false' ? false : value === 'mixed' ? 'mixed' : undefined);
    const choice = element.tagName === 'INPUT' && (type === 'checkbox' || type === 'radio');
    const checked = tristate(aria('aria-checked')) ?? (choice ? (element.indeterminate ? 'mixed' : element.checked) : undefined);
    const selected = aria('aria-selected') === null ? undefined : aria('aria-selected') === 'true';
    const expanded = aria('aria-expanded') === null ? undefined : aria('aria-expanded') === 'true';
    const pressed = tristate(aria('aria-pressed'));
    const secure = element.tagName === 'INPUT' && type === 'password';
    const field = (element.tagName === 'INPUT' && !choice && !['button', 'submit', 'reset', 'hidden', 'file', 'image'].includes(type)) || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT';
    // Never a secure field's value, which a tree must not carry.
    const value = secure ? undefined : field ? element.value : (aria('aria-valuetext') ?? aria('aria-valuenow') ?? undefined);
    const placeholder = aria('placeholder') || undefined;
    // The ARIA role it has, said or implied by its tag, which the driver
    // turns into a kind; and whether it is a plain element kept for its text.
    const IMPLIED = {BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox', IMG: 'img', UL: 'list', OL: 'list', LI: 'listitem', DIALOG: 'dialog', PROGRESS: 'progressbar', OUTPUT: 'status', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', H5: 'heading', H6: 'heading'};
    const INPUTS = {checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox', button: 'button', submit: 'button', reset: 'button', image: 'button'};
    const said = (element.getAttribute('role') || '').trim().split(/\\s+/)[0];
    const implied = element.tagName === 'INPUT' ? (INPUTS[type] || 'textbox') : element.tagName === 'A' ? (element.hasAttribute('href') ? 'link' : undefined) : IMPLIED[element.tagName];
    const ariaRole = said || implied;
    const leaf = PLAIN.has(element.tagName) && !element.hasAttribute('role') && !pressable && holdsText;
    const level = (/^H([1-6])$/.exec(element.tagName) || [])[1] || (ariaRole === 'heading' ? aria('aria-level') : null);
    nodes.push({
      ref,
      ...(parent ? {parent} : null),
      role,
      name,
      ...(testId ? {testId} : null),
      depth: depthOf(element),
      interactive: pressable || ACTIONABLE.has(role) || ACTIONABLE.has(element.tagName.toLowerCase()),
      focused: document.activeElement === element,
      // react-native-web disables with aria-disabled, not the attribute.
      enabled: !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true',
      offscreen: layout ? box.width === 0 || box.height === 0 : !shows(element),
      ...(layout ? {bounds: {x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height)}} : null),
      ...(checked === undefined ? null : {checked}),
      ...(selected === undefined ? null : {selected}),
      ...(expanded === undefined ? null : {expanded}),
      ...(pressed === undefined ? null : {pressed}),
      ...(value === undefined ? null : {value}),
      ...(placeholder ? {placeholder} : null),
      ...(secure ? {secure: true} : null),
      ...(help ? {help} : null),
      ...(level ? {heading: Number(level)} : null),
      ...(ariaRole ? {ariaRole} : null),
      ...(leaf ? {leaf: true} : null),
    });
  }
  // The elements this read named, for a press to find the one it points at.
  refs.elements = elements;
  return {origin, generation: state ? state.generation : -1, nodes};
})`;
