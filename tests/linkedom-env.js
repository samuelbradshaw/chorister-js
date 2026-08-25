/**
 * The DOM the tests run against: linkedom, the same one chorister.js ships on.
 *
 * The Python runtime loads linkedom and then js/env.js; this is that file's DOM
 * half, rebuilt on the npm package so the suite and production agree. jsdom was
 * used here before and disagreed in one way that matters: on an XML document —
 * which the MEI is — its querySelectorAll returns a selector list's matches
 * grouped by selector rather than in document order.
 *
 * Loaded before setup.js, which needs a document to exist.
 */

import {
  parseHTML, DOMParser as LinkeDOMParser, Node, Event, CustomEvent, Element,
} from 'linkedom';

const page = parseHTML('<!doctype html><html><head></head><body></body></html>');

globalThis.document = page.document;
globalThis.Node = Node;
globalThis.Event = Event;
globalThis.CustomEvent = CustomEvent;
globalThis.DOMParser = LinkeDOMParser;

// linkedom exports Event and CustomEvent but no pointer/mouse/keyboard subclasses, which
// the suite constructs to drive ch:tap and ch:hover. Production never does -- bridge.js
// stubs listeners out -- so they're carried here rather than in js/env.js.
for (const name of ['MouseEvent', 'PointerEvent', 'KeyboardEvent']) {
  globalThis[name] = class extends Event {
    constructor(type, options = {}) {
      super(type, options);
      Object.assign(this, options);
    }
  };
  Object.defineProperty(globalThis[name], 'name', { value: name });
}

// linkedom has no XMLSerializer; its nodes serialize via toString()
globalThis.XMLSerializer = class XMLSerializer {
  serializeToString(node) { return String(node); }
};

globalThis.window = globalThis;
globalThis.self = globalThis;

// Chorister listens on `window` for beforeprint/afterprint. Production never needs this
// -- bridge.js stubs listeners out -- but the suite exercises print handling, so the
// global gets a real linkedom target to register on and dispatch from.
const windowEvents = document.createElement('div');

// Each listener is isolated: the spec reports one that throws and carries on to the next,
// where linkedom lets the exception abort the dispatch. Scores from earlier tests keep
// their listeners, so one stale handler throwing would hide every later one -- including
// the score under test. Keyed by the original so removeEventListener still matches.
const isolated = new WeakMap();
const isolate = (listener) => {
  if (typeof listener !== 'function') return listener;
  if (!isolated.has(listener)) {
    isolated.set(listener, function (event) {
      try { return listener.call(this, event); } catch (error) { console.error(error); }
    });
  }
  return isolated.get(listener);
};

globalThis.addEventListener = (type, listener, options) =>
  windowEvents.addEventListener(type, isolate(listener), options);
globalThis.removeEventListener = (type, listener, options) =>
  windowEvents.removeEventListener(type, isolate(listener), options);
globalThis.dispatchEvent = (event) => windowEvents.dispatchEvent(event);

globalThis.CSSStyleSheet = class CSSStyleSheet {
  constructor() { this.cssRules = []; }
  replaceSync(text) { this.cssRules = [text]; }
  insertRule(rule) { this.cssRules.push(rule); return this.cssRules.length - 1; }
};
document.adoptedStyleSheets = [];

// Layout metrics don't exist without a renderer, but Chorister reads them to size the
// page for Verovio; it clamps with Math.max(..., 100), so 0 is a safe stand-in.
for (const prop of ['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight']) {
  if (!(prop in Element.prototype)) {
    Object.defineProperty(Element.prototype, prop, { get() { return 0; }, configurable: true });
  }
}

// MEI identifies elements with xml:id and Chorister queries them as `[*|id="..."]`.
// css-select (linkedom's engine) rejects namespaced attribute selectors but accepts the
// qualified name escaped, and linkedom stores XML attributes under that name.
const NAMESPACED_ATTRIBUTE = /\[\*\|([\w-]+)/g;
const rewriteSelector = (selector) =>
  (typeof selector === 'string' && selector.includes('[*|')
    ? selector.replace(NAMESPACED_ATTRIBUTE, '[xml\\:$1')
    : selector);

const QUERY_METHODS = ['querySelector', 'querySelectorAll', 'closest', 'matches'];
const patched = new Set();

function patchQueryMethods(object) {
  for (let proto = object; proto; proto = Object.getPrototypeOf(proto)) {
    if (patched.has(proto)) continue;
    patched.add(proto);
    for (const method of QUERY_METHODS) {
      if (!Object.prototype.hasOwnProperty.call(proto, method)) continue;
      const original = proto[method];
      if (typeof original !== 'function') continue;
      Object.defineProperty(proto, method, {
        value: function (selector, ...rest) { return original.call(this, rewriteSelector(selector), ...rest); },
        configurable: true,
        writable: true,
      });
    }
  }
}

patchQueryMethods(Element.prototype);
patchQueryMethods(Object.getPrototypeOf(document));
patchQueryMethods(Object.getPrototypeOf(new LinkeDOMParser().parseFromString('<x/>', 'text/xml')));
