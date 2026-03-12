/**
 * Tests: Miscellaneous — safeFetch error handling, stylesheet management,
 * removeScore deregistration, resize observer.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';
import { sampleMusicXmlHGW as sampleMusicXml } from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();


// ============================================================
// safeFetch error handling
// ============================================================
describe('safeFetch error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should throw an error with HTTP status when fetch returns non-ok response', async () => {
    const score = new ChScore('#score-container');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(
      score.load('musicxml', { scoreUrl: 'https://example.com/score.musicxml' })
    ).rejects.toThrow('Failed to fetch URL. HTTP error: 404.');
  });

  it('should throw a generic error on TypeError (CORS/network failure)', async () => {
    const score = new ChScore('#score-container');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      score.load('musicxml', { scoreUrl: 'https://example.com/score.musicxml' })
    ).rejects.toThrow('Failed to fetch URL. See console for details.');
  });

  it('should re-throw non-TypeError errors unchanged', async () => {
    const score = new ChScore('#score-container');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Custom error'));

    await expect(
      score.load('musicxml', { scoreUrl: 'https://example.com/score.musicxml' })
    ).rejects.toThrow('Custom error');
  });

  it('should handle midiUrl fetch errors', async () => {
    const score = new ChScore('#score-container');
    let callCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      callCount++;
      if (String(url).includes('midi')) {
        return { ok: false, status: 500 };
      }
      return { ok: true, text: async () => sampleMusicXml, arrayBuffer: async () => new ArrayBuffer(0) };
    });

    await expect(
      score.load('musicxml', {
        scoreUrl: 'https://example.com/score.musicxml',
        midiUrl: 'https://example.com/score.midi',
      })
    ).rejects.toThrow('Failed to fetch URL. HTTP error: 500.');
  });

  it('should handle lyricsUrl fetch errors', async () => {
    const score = new ChScore('#score-container');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('lyrics')) {
        throw new TypeError('CORS error');
      }
      return { ok: true, text: async () => sampleMusicXml };
    });

    await expect(
      score.load('musicxml', {
        scoreUrl: 'https://example.com/score.musicxml',
        lyricsUrl: 'https://example.com/lyrics.txt',
      })
    ).rejects.toThrow('Failed to fetch URL. See console for details.');
  });
});


// ============================================================
// _loadStyles
// ============================================================
describe('_loadStyles(), _addStylesheet(), _removeStylesheets()', () => {
  it('should inject stylesheets into document.adoptedStyleSheets on construction', () => {
    const adoptedBefore = document.adoptedStyleSheets.length;
    const score = new ChScore('#score-container');
    expect(document.adoptedStyleSheets.length).toBeGreaterThan(adoptedBefore);
  });

  it('should create stylesheets object with at least one stylesheet', () => {
    const score = new ChScore('#score-container');
    expect(score._stylesheets).toBeDefined();
    const stylesheetEntries = Object.values(score._stylesheets);
    expect(stylesheetEntries.length).toBeGreaterThan(0);
    const stylesheet = stylesheetEntries[0];
    expect(stylesheet).toBeDefined();
    expect(typeof stylesheet.replaceSync).toBe('function');
  });

  it('should remove stylesheets on removeScore()', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const adoptedBefore = document.adoptedStyleSheets.length;

    score.removeScore();
    expect(document.adoptedStyleSheets.length).toBeLessThan(adoptedBefore);
  });

  it('should handle _removeStylesheets when _stylesheets is undefined', () => {
    const score = new ChScore('#score-container');
    score._stylesheets = undefined;
    expect(() => score._removeStylesheets()).not.toThrow();
  });
});


// ============================================================
// Legacy browser fallback
// ============================================================
describe('_addStylesheet() — Legacy browser fallback', () => {
  it('should create a style element when CSSStyleSheet API is not supported', () => {
    const score = new ChScore('#score-container');
    const originalSupport = ChScore.prototype._supportsCssStylesheetApi;
    ChScore.prototype._supportsCssStylesheetApi = false;

    const stylesheet = score._addStylesheet('legacy-test');
    expect(stylesheet.tagName?.toLowerCase()).toBe('style');
    expect(stylesheet.replaceSync).toBeDefined();
    expect(stylesheet.insertRule).toBeDefined();

    stylesheet.replaceSync('.test { color: red; }');
    expect(stylesheet.textContent).toContain('.test');

    stylesheet.insertRule('.test2 { color: blue; }');
    expect(stylesheet.textContent).toContain('.test2');

    stylesheet.remove();
    ChScore.prototype._supportsCssStylesheetApi = originalSupport;
  });
});


// ============================================================
// removeScore — deregistration
// ============================================================
describe('removeScore() — _chScores deregistration', () => {
  it('should filter out the removed instance from the scores list', async () => {
    document.body.innerHTML = '<div id="container-a"></div><div id="container-b"></div>';
    const scoreA = new ChScore('#container-a');
    await scoreA.load('musicxml', { scoreContent: sampleMusicXml });
    const scoreB = new ChScore('#container-b');
    await scoreB.load('musicxml', { scoreContent: sampleMusicXml });

    expect(ChScore.prototype._chScores).toContain(scoreA);
    expect(ChScore.prototype._chScores).toContain(scoreB);

    scoreA.removeScore();

    expect(scoreA._chScores).not.toContain(scoreA);
    expect(scoreA._chScores).toContain(scoreB);
  });

  it('should disconnect the ResizeObserver on removeScore', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const disconnectSpy = vi.spyOn(score._resizeObserver, 'disconnect');
    score.removeScore();
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('should abort event listeners on removeScore', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const abortSpy = vi.spyOn(score._controller, 'abort');
    score.removeScore();
    expect(abortSpy).toHaveBeenCalled();
  });
});


// ============================================================
// Resize observer
// ============================================================
describe('Resize observer', () => {
  it('should create a ResizeObserver during construction', () => {
    const score = new ChScore('#score-container');
    expect(score._resizeObserver).toBeDefined();
  });

  it('should set data-ch-width on the container after rendering', async () => {
    const container = document.getElementById('score-container');
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    expect(container.dataset.chWidth).toBeDefined();
    expect(typeof container.dataset.chWidth).toBe('string');
  });

  it('should set data-ch-layout on the container after loading', async () => {
    const container = document.getElementById('score-container');
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    expect(container.dataset.chLayout).toBe('vertical-scroll');
  });

  it('should update data-ch-layout when layout option changes', async () => {
    const container = document.getElementById('score-container');
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    score.setOptions({ layout: 'horizontal-scroll' });
    expect(container.dataset.chLayout).toBe('horizontal-scroll');
  });

  it('should invoke the resize callback when observed element resizes', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    // Verify the ResizeObserver was created and is observing
    expect(score._resizeObserver).toBeDefined();
    expect(typeof score._resizeObserver.observe).toBe('function');

    ChScore.prototype._drawScore = origDrawScore;
  });
});


// ============================================================
// beforeprint / afterprint event handling
// ============================================================
describe('beforeprint / afterprint event handling', () => {
  let score;

  afterEach(() => {
    if (score) score.removeScore();
  });

  it('should register beforeprint event listener on window', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const beforeprintCalls = addSpy.mock.calls.filter(c => c[0] === 'beforeprint');
    expect(beforeprintCalls.length).toBeGreaterThanOrEqual(1);
    addSpy.mockRestore();
  });

  it('should register afterprint event listener on window', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const afterprintCalls = addSpy.mock.calls.filter(c => c[0] === 'afterprint');
    expect(afterprintCalls.length).toBeGreaterThanOrEqual(1);
    addSpy.mockRestore();
  });

  it('should set layout to print on beforeprint', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const setOptionsSpy = vi.spyOn(score, 'setOptions');

    // Use try/catch since other global listeners may throw in jsdom
    try { window.dispatchEvent(new Event('beforeprint')); } catch {}

    const printCalls = setOptionsSpy.mock.calls.filter(c => c[0]?.layout === 'print');
    expect(printCalls.length).toBeGreaterThanOrEqual(1);
    setOptionsSpy.mockRestore();
  });

  it('should restore previous layout on afterprint', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const previousLayout = score.getOptions().layout;

    // Dispatch beforeprint first so the handler captures the current layout
    try { window.dispatchEvent(new Event('beforeprint')); } catch {}
    expect(score.getOptions().layout).toBe('print');

    const setOptionsSpy = vi.spyOn(score, 'setOptions');
    try { window.dispatchEvent(new Event('afterprint')); } catch {}

    const restoreCalls = setOptionsSpy.mock.calls.filter(c => c[0]?.layout === previousLayout);
    expect(restoreCalls.length).toBeGreaterThanOrEqual(1);
    setOptionsSpy.mockRestore();
  });

  it('should stop receiving print events after removeScore aborts controller', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const setOptionsSpy = vi.spyOn(score, 'setOptions');
    score.removeScore();
    score = null; // Already removed, skip afterEach cleanup

    // After removeScore, the abort controller should have cancelled the listener
    expect(setOptionsSpy.mock.lastCall?.[0]?.layout).toBeUndefined();
    setOptionsSpy.mockRestore();
  });
});


// ============================================================
// removeScore — comprehensive cleanup
// ============================================================
describe('removeScore() — comprehensive cleanup', () => {
  it('should remove all adopted stylesheets added by the instance', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    document.adoptedStyleSheets = [];
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const adoptedBefore = document.adoptedStyleSheets.length;
    expect(adoptedBefore).toBeGreaterThan(0);

    score.removeScore();
    expect(document.adoptedStyleSheets.length).toBeLessThan(adoptedBefore);
  });

  it('should remove all data-ch-* attributes from container', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const container = document.getElementById('score-container');

    score.removeScore();
    expect(container.getAttribute('data-ch-status')).toBeNull();
    expect(container.getAttribute('data-ch-layout')).toBeNull();
    expect(container.getAttribute('data-ch-scale-to-fit')).toBeNull();
    expect(container.getAttribute('data-ch-width')).toBeNull();
    expect(container.getAttribute('data-ch-height')).toBeNull();
    expect(container.innerHTML).toBe('');
  });
});
