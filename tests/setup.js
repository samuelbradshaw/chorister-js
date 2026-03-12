/**
 * Test setup: real Verovio, mock Magenta, and browser API polyfills for chorister.js
 *
 * Verovio: Uses the real verovio WASM toolkit (installed as devDependency).
 * Magenta: Mocked because @magenta/music has browser-only dependencies (Tone.js,
 *   AudioContext) that don't work in Node.js / jsdom. Chorister.js only uses
 *   core.midiToSequenceProto() and core.sequenceProtoToMidi(), so the mock is adequate.
 */

import createVerovioModule from 'verovio/wasm';
import { VerovioToolkit } from 'verovio/esm';

// --- Real Verovio setup ---
// Initialize the WASM module once and create a shim that matches the browser API
// (chorister.js uses `new verovio.toolkit()`)
const verovioModule = await createVerovioModule();
globalThis.verovio = {
  toolkit: function toolkit() {
    const realToolkit = new VerovioToolkit(verovioModule);
    // Copy all prototype methods onto `this` so `new verovio.toolkit()` works
    const proto = Object.getPrototypeOf(realToolkit);
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name !== 'constructor' && typeof realToolkit[name] === 'function') {
        this[name] = realToolkit[name].bind(realToolkit);
      }
    }
  },
};

// --- Magenta (core) mock ---
// @magenta/music is browser-only (depends on Tone.js, AudioContext, etc.)
// Chorister.js only uses midiToSequenceProto and sequenceProtoToMidi.
globalThis.core = {
  midiToSequenceProto: vi.fn((midi) => ({
    notes: [
      { pitch: 60, startTime: 0, endTime: 0.5, velocity: 80 },
      { pitch: 62, startTime: 0.5, endTime: 1.0, velocity: 80 },
      { pitch: 64, startTime: 1.0, endTime: 1.5, velocity: 80 },
      { pitch: 65, startTime: 1.5, endTime: 2.0, velocity: 80 },
    ],
    tempos: [{ time: 0, qpm: 120 }],
    totalTime: 2.0,
    totalQuantizedSteps: 0,
  })),
  sequenceProtoToMidi: vi.fn((noteSequence) => {
    const arr = new Uint8Array([77, 84, 104, 100]);
    arr.toArray = () => Array.from(arr);
    return arr;
  }),
};

// --- Browser API polyfills for jsdom ---

// CSSStyleSheet mock (jsdom doesn't support constructable stylesheets)
if (!globalThis.CSSStyleSheet?.prototype?.replaceSync) {
  class MockCSSStyleSheet {
    constructor() { this._rules = []; }
    replaceSync(text) { this._rules = [text]; }
    insertRule(rule) { this._rules.push(rule); }
  }
  globalThis.CSSStyleSheet = MockCSSStyleSheet;
  document.adoptedStyleSheets = [];
}

// ResizeObserver mock
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    constructor(cb) { this._cb = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// IntersectionObserver mock
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    constructor(cb) { this._cb = cb; }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// structuredClone polyfill (available in Node 17+, but just in case)
if (!globalThis.structuredClone) {
  globalThis.structuredClone = (val) => JSON.parse(JSON.stringify(val));
}

// elementsFromPoint polyfill (not supported in jsdom)
if (!document.elementsFromPoint) {
  document.elementsFromPoint = () => [];
}
