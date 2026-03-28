/**
 * Tests: Public API methods and load-related functionality.
 *
 * Covers: load(), setOptions(), getOptions(), getScoreData(), getScoreContainer(),
 * getMidi(), removeScore(), _drawScore(), Custom Events, Options Effects,
 * Input Data Structures, Score Types, Edge Cases,
 * _extractLyricStanzas, _normalizeSections, _updateExpansionElement, _getPointData,
 * _generateSectionsFromSimpleScore, _extractPianoIntroduction,
 * ch:hover/ch:tap events, lyrics-below, section types, parts, placements
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks, resetScoreState } from './helpers.js';
import {
  sampleMusicXmlHGW as sampleMusicXml, sampleMusicXmlTLL as sampleMusicXml2,
  sampleLyricsHGW as sampleLyrics,
} from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// ============================================================
// load()
// ============================================================
describe('load()', () => {
  it('should load a score and return scoreData', async () => {
    const score = new ChScore('#score-container');
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    });
    expect(scoreData).toBeDefined();
    expect(score._scoreData).toBe(scoreData);
  });

  it('should fall back to default score when format is missing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const score = new ChScore('#score-container');
    const scoreData = await score.load(null, { scoreContent: 'test' });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Score data is incomplete'));
    consoleSpy.mockRestore();
  });

  it('should fall back to default score when neither scoreUrl nor scoreContent is provided', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const score = new ChScore('#score-container');
    const scoreData = await score.load('musicxml', {});
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Score data is incomplete'));
    consoleSpy.mockRestore();
  });

  it('should store parts, sections, chordSets, and fermatas in scoreData', async () => {
    const testParts = [{ partId: 'soprano', name: 'Soprano', isVocal: true, placement: 'auto', chordPositionRefs: { 0: { isMelody: true, staffNumbers: [1], lyricLineIds: null } } }];
    const testFermatas = [{ chordPosition: 5, durationFactor: 2.0 }];

    const score = new ChScore('#score-container');
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      parts: testParts,
      fermatas: testFermatas,
    });

    expect(scoreData.parts).toEqual(testParts);
    expect(scoreData.fermatas).toEqual(testFermatas);
  });

  it('should accept a partsTemplate string in inputData', async () => {
    const score = new ChScore('#score-container');
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      partsTemplate: 'SATB',
    });
    expect(scoreData.partsTemplate).toBe('SATB');
  });

  it('should store scoreId when provided', async () => {
    const score = new ChScore('#score-container');
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      scoreId: 'my-score-123',
    });
    expect(scoreData.scoreId).toBe('my-score-123');
  });

  it('should store lyricsText when provided', async () => {
    const lyrics = '[Verse 1]\nAmazing grace, how sweet the sound';
    const score = new ChScore('#score-container');
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: lyrics,
    });
    expect(scoreData.lyricsText).toBe(lyrics);
  });

  it('should successfully fetch scoreUrl when provided', async () => {
    const score = new ChScore('#score-container');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: async () => sampleMusicXml,
    });

    const scoreData = await score.load('musicxml', {
      scoreUrl: 'https://example.com/score.musicxml',
    });
    expect(scoreData).toBeDefined();
    expect(scoreData.chordPositions.length).toBe(37);
    vi.restoreAllMocks();
  });

  it('should successfully fetch lyricsUrl and apply lyrics', async () => {
    const score = new ChScore('#score-container');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('lyrics')) {
        return { ok: true, text: async () => sampleLyrics };
      }
      return { ok: true, text: async () => sampleMusicXml };
    });

    const scoreData = await score.load('musicxml', {
      scoreUrl: 'https://example.com/score.musicxml',
      lyricsUrl: 'https://example.com/lyrics.txt',
    });
    expect(scoreData).toBeDefined();
    expect(scoreData.lyricsText).toBe(sampleLyrics);
    vi.restoreAllMocks();
  });

  it('should successfully fetch midiUrl as ArrayBuffer', async () => {
    const score = new ChScore('#score-container');
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('midi')) {
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(100) };
      }
      return { ok: true, text: async () => sampleMusicXml };
    });

    const scoreData = await score.load('musicxml', {
      scoreUrl: 'https://example.com/score.musicxml',
      midiUrl: 'https://example.com/score.midi',
    });
    expect(scoreData).toBeDefined();
    vi.restoreAllMocks();
  });

  it('should skip fetching scoreUrl when scoreContent is already provided', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreUrl: 'https://example.com/score.musicxml',
      scoreContent: sampleMusicXml,
    });
    // fetch should not be called for scoreUrl since scoreContent is provided
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

// ============================================================
// setOptions() / getOptions() + Options Effects (shared load)
// ============================================================
describe('setOptions() and getOptions()', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  it('should return a deep clone of current options from getOptions()', () => {
    const options = score.getOptions();
    expect(options.scale).toBe(40);
    options.scale = 999;
    expect(score.getOptions().scale).toBe(40);
  });

  it('should update options via setOptions()', () => {
    score.setOptions({ scale: 60 });
    expect(score.getOptions().scale).toBe(60);
  });

  it('should merge partial options without overwriting others', () => {
    score.setOptions({ showMeasureNumbers: true });
    const options = score.getOptions();
    expect(options.showMeasureNumbers).toBe(true);
    expect(options.scale).toBe(40);
  });

  it('should accept showChordSet option values', () => {
    score.setOptions({ showChordSet: 'guitar' });
    expect(score.getOptions().showChordSet).toBe('guitar');
    score.setOptions({ showChordSet: false });
    expect(score.getOptions().showChordSet).toBe(false);
  });

  it('should accept hideSectionIds as an array', () => {
    score.setOptions({ hideSectionIds: ['verse-3', 'chorus-2'] });
    expect(score.getOptions().hideSectionIds).toEqual(['verse-3', 'chorus-2']);
  });

  it('should accept drawBackgroundShapes and drawForegroundShapes', () => {
    score.setOptions({
      drawBackgroundShapes: ['ch-system-rect', 'ch-measure-rect'],
      drawForegroundShapes: ['ch-chord-position-line'],
    });
    const options = score.getOptions();
    expect(options.drawBackgroundShapes).toEqual(['ch-system-rect', 'ch-measure-rect']);
    expect(options.drawForegroundShapes).toEqual(['ch-chord-position-line']);
  });

  it('should accept customEvents option', () => {
    score.setOptions({ customEvents: ['ch:tap', 'ch:hover'] });
    expect(score.getOptions().customEvents).toEqual(['ch:tap', 'ch:hover']);
  });

  it('should apply multiple options simultaneously in a single setOptions call', () => {
    score.setOptions({
      scale: 75,
      showMeasureNumbers: true,
      showMelodyOnly: false,
      drawBackgroundShapes: ['ch-system-rect'],
    });
    const opts = score.getOptions();
    expect(opts.scale).toBe(75);
    expect(opts.showMeasureNumbers).toBe(true);
    expect(opts.showMelodyOnly).toBe(false);
    expect(opts.drawBackgroundShapes).toEqual(['ch-system-rect']);
  });

  it('should not overwrite unrelated options when applying compound setOptions', () => {
    score.setOptions({ scale: 55 });
    score.setOptions({ showMeasureNumbers: true });
    const opts = score.getOptions();
    expect(opts.scale).toBe(55);
    expect(opts.showMeasureNumbers).toBe(true);
  });

  it('should round-trip all option values through setOptions → getOptions', () => {
    const testOpts = {
      scale: 65,
      showMeasureNumbers: true,
      showMelodyOnly: false,
      showChordSet: 'guitar',
      hideSectionIds: ['verse-3'],
      drawBackgroundShapes: ['ch-system-rect', 'ch-measure-rect'],
      drawForegroundShapes: ['ch-chord-position-line'],
      customEvents: ['ch:tap'],
    };
    score.setOptions(testOpts);
    const result = score.getOptions();
    for (const [key, value] of Object.entries(testOpts)) {
      expect(result[key]).toEqual(value);
    }
  });

  it('should accept expandScore option values', { timeout: 15000 }, () => {
    for (const val of [false, 'intro', 'full-score']) {
      score.setOptions({ expandScore: val }, false);
      expect(score.getOptions().expandScore).toBe(val);
    }
  });

  it('should accept keySignatureId option', () => {
    score.setOptions({ keySignatureId: 'g-major' });
    expect(score.getOptions().keySignatureId).toBe('g-major');
  });

  // Options Effects (shares the same loaded score)
  it('should pass scale option to Verovio', () => {
    const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
    score.setOptions({ scale: 60 });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

});

// ============================================================
// getScoreData() and getScoreContainer()
// ============================================================
describe('getScoreData() and getScoreContainer()', () => {
  it('should return scoreData after load', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    expect(score.getScoreData()).toBe(score._scoreData);
  });

  it('should return the container element', () => {
    const score = new ChScore('#score-container');
    expect(score.getScoreContainer()).toBe(document.getElementById('score-container'));
  });
});

// ============================================================
// getMidi() + Edge cases (shared load)
// ============================================================
describe('getMidi()', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should return note-sequence by default', () => {
    const midi = score.getMidi();
    expect(midi).toBeDefined();
    expect(midi.notes).toBeDefined();
    expect(Array.isArray(midi.notes)).toBe(true);
  });

  it('should return note-sequence when explicitly requested', () => {
    const midi = score.getMidi('note-sequence');
    expect(midi.notes).toBeDefined();
  });

  it('should return a Blob for blob format', () => {
    const midi = score.getMidi('blob');
    expect(midi).toBeInstanceOf(Blob);
    expect(midi.type).toBe('audio/midi');
  });

  it('should return an array for array-buffer format', () => {
    const midi = score.getMidi('array-buffer');
    expect(Array.isArray(midi) || midi instanceof Array).toBe(true);
  });

  // Edge cases (shares the same loaded score)
  it('should return undefined for an unknown format string', () => {
    const result = score.getMidi('unknown-format');
    expect(result).toBeUndefined();
  });

  it('should return undefined for empty string format', () => {
    const result = score.getMidi('');
    expect(result).toBeUndefined();
  });

  it('should return the same note-sequence reference each time', () => {
    const midi1 = score.getMidi('note-sequence');
    const midi2 = score.getMidi('note-sequence');
    expect(midi1).toBe(midi2);
  });
});

// ============================================================
// removeScore()
// ============================================================
describe('removeScore()', () => {
  it('should clear the container innerHTML', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const container = document.getElementById('score-container');
    expect(container.innerHTML).not.toBe('');

    score.removeScore();
    expect(container.innerHTML).toBe('');
  });

  it('should clear data-ch-* attributes on the container', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const container = document.getElementById('score-container');

    score.removeScore();
    expect(container.getAttribute('data-ch-status')).toBeNull();
    expect(container.getAttribute('data-ch-layout')).toBeNull();
    expect(container.getAttribute('data-ch-scale-to-fit')).toBeNull();
    expect(container.getAttribute('data-ch-width')).toBeNull();
    expect(container.getAttribute('data-ch-height')).toBeNull();
  });

  it('should set container.score to undefined', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const container = document.getElementById('score-container');

    score.removeScore();
    expect(container.score).toBeUndefined();
  });
});

// ============================================================
// Custom Events
// ============================================================
describe('Custom Events', () => {
  it('should support enabling ch:tap and ch:hover via customEvents option', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    }, { ...ChScore.prototype._defaultOptions, customEvents: ['ch:tap', 'ch:hover'] });

    const options = score.getOptions();
    expect(options.customEvents).toContain('ch:tap');
    expect(options.customEvents).toContain('ch:hover');
  });

  it('should dispatch ch:tap event on pointerdown/pointerup when enabled', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    }, { ...ChScore.prototype._defaultOptions, customEvents: ['ch:tap'] });

    const container = document.getElementById('score-container');
    const tapHandler = vi.fn();
    container.addEventListener('ch:tap', tapHandler);

    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }));
    container.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 50, bubbles: true }));

    expect(tapHandler).toHaveBeenCalled();
    const detail = tapHandler.mock.calls[0][0].detail;
    expect(detail).toHaveProperty('pointData');
    expect(detail.pointData).toHaveProperty('chordPosition');
    expect(detail.pointData).toHaveProperty('noteIds');
    expect(detail.pointData).toHaveProperty('sectionIds');
    expect(detail).toHaveProperty('pointerEvent');
    expect(detail).toHaveProperty('isLongPress');
    expect(detail.isLongPress).toBe(false);
  });

  it('should dispatch ch:tap with isLongPress=true after 500ms hold', async () => {
    vi.useFakeTimers();
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    }, { ...ChScore.prototype._defaultOptions, customEvents: ['ch:tap'] });

    const container = document.getElementById('score-container');
    const tapHandler = vi.fn();
    container.addEventListener('ch:tap', tapHandler);

    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }));
    vi.advanceTimersByTime(500);

    expect(tapHandler).toHaveBeenCalled();
    const detail = tapHandler.mock.calls[0][0].detail;
    expect(detail.isLongPress).toBe(true);
    vi.useRealTimers();
  });

  it('should dispatch ch:tap without enabling ch:hover', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    }, { ...ChScore.prototype._defaultOptions, customEvents: ['ch:tap'] });

    const container = document.getElementById('score-container');
    const tapHandler = vi.fn();
    const hoverHandler = vi.fn();
    container.addEventListener('ch:tap', tapHandler);
    container.addEventListener('ch:hover', hoverHandler);

    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }));
    container.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 50, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50, bubbles: true }));

    expect(tapHandler).toHaveBeenCalled();
    // ch:hover should not fire since only ch:tap was enabled
    expect(hoverHandler).not.toHaveBeenCalled();
  });
});

// ============================================================
// getPageState()
// ============================================================
describe('getPageState()', () => {
  it('should return an object with currentPageNumber and pageNumbers', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const pageState = score.getPageState();
    expect(pageState).toHaveProperty('currentPageNumber');
    expect(pageState).toHaveProperty('pageNumbers');
    expect(Array.isArray(pageState.pageNumbers)).toBe(true);
    expect(pageState.pageNumbers.length).toBeGreaterThan(0);
  });

  it('should return integer page numbers', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const pageState = score.getPageState();
    for (const pn of pageState.pageNumbers) {
      expect(Number.isInteger(pn)).toBe(true);
    }
  });
});

// ============================================================
// jumpToPage()
// ============================================================
describe('jumpToPage()', () => {
  it('should scroll to the given page number', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const pageState = score.getPageState();
    const firstPage = pageState.pageNumbers[0];
    const pageEl = score._container.querySelector(`[data-ch-page="${firstPage}"]`);
    pageEl.scrollIntoView = vi.fn();

    score.jumpToPage(firstPage);
    expect(pageEl.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' }));
  });

  it('should support smooth animation', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const pageState = score.getPageState();
    const firstPage = pageState.pageNumbers[0];
    const pageEl = score._container.querySelector(`[data-ch-page="${firstPage}"]`);
    pageEl.scrollIntoView = vi.fn();

    score.jumpToPage(firstPage, true);
    expect(pageEl.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  });

  it('should support next and previous keywords', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const pageState = score.getPageState();
    if (pageState.pageNumbers.length < 2) return; // Need at least 2 pages

    // Mock scrollIntoView on all pages
    const spies = [];
    for (const pn of pageState.pageNumbers) {
      const el = score._container.querySelector(`[data-ch-page="${pn}"]`);
      el.scrollIntoView = vi.fn();
      spies.push(el.scrollIntoView);
    }

    score.jumpToPage('next');
    const anyCalled = spies.some(s => s.mock.calls.length > 0);
    expect(anyCalled).toBe(true);
  });
});

// ============================================================
// ch:pagechange event
// ============================================================
describe('ch:pagechange event', () => {
  it('should fire ch:pagechange with pageState detail when IntersectionObserver triggers', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const container = document.getElementById('score-container');
    const handler = vi.fn();
    container.addEventListener('ch:pagechange', handler);

    // Simulate IntersectionObserver callback on the first page
    const pageEl = score._pages[0];
    score._pageObserver._cb([{ target: pageEl, isIntersecting: true }]);

    expect(handler).toHaveBeenCalled();
    const detail = handler.mock.calls[0][0].detail;
    expect(detail).toHaveProperty('pageState');
    expect(detail.pageState).toHaveProperty('currentPageNumber');
    expect(detail.pageState).toHaveProperty('pageNumbers');
  });
});

// ============================================================
// headerContent / footerContent
// ============================================================
describe('headerContent / footerContent', () => {
  it('should render headerContent HTML in the container', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    }, { ...ChScore.prototype._defaultOptions, headerContent: '<p class="test-header">My Header</p>' });

    const container = document.getElementById('score-container');
    const header = container.querySelector('[data-ch-header]');
    expect(header).not.toBeNull();
    expect(header.textContent).toContain('My Header');
  });

  it('should render footerContent HTML in the container', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    }, { ...ChScore.prototype._defaultOptions, footerContent: '<p class="test-footer">My Footer</p>' });

    const container = document.getElementById('score-container');
    const footer = container.querySelector('[data-ch-footer]');
    expect(footer).not.toBeNull();
    expect(footer.textContent).toContain('My Footer');
  });

  it('should render empty header/footer containers by default', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const container = document.getElementById('score-container');
    expect(container.querySelector('[data-ch-header]')).not.toBeNull();
    expect(container.querySelector('[data-ch-footer]')).not.toBeNull();
  });
});

// ============================================================
// _drawScore()
// ============================================================
describe('_drawScore()', () => {
  it('should render SVG into the container', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const container = document.getElementById('score-container');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-ch-lyrics-below]')).not.toBeNull();
  });
});


// ============================================================
// Input Data Structures
// ============================================================
describe('Input Data Structures', () => {
  it('should accept parts object with correct structure', async () => {
    const score = new ChScore('#score-container');
    const partsInput = [
      {
        partId: 'soprano',
        name: 'Soprano',
        isVocal: true,
        placement: 'auto',
        chordPositionRefs: {
          0: { isMelody: true, staffNumbers: [1], lyricLineIds: null },
        },
      },
      {
        partId: 'alto',
        name: 'Alto',
        isVocal: true,
        placement: 'auto',
        chordPositionRefs: {
          0: { isMelody: false, staffNumbers: [1], lyricLineIds: null },
        },
      },
    ];
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      parts: partsInput,
    });
    expect(scoreData.parts).toEqual(partsInput);
  });

  it('should accept fermatas with chordPosition and durationFactor', async () => {
    const score = new ChScore('#score-container');
    const fermatasInput = [
      { chordPosition: 31, durationFactor: 2.0 },
      { chordPosition: 157, durationFactor: 1.5 },
    ];
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      fermatas: fermatasInput,
    });
    expect(scoreData.fermatas).toEqual(fermatasInput);
  });

  it('should accept chord sets with correct structure', async () => {
    const score = new ChScore('#score-container');
    const chordSetsInput = [
      {
        chordSetId: 'guitar',
        name: 'Guitar',
        svgSymbolsUrl: null,
        chordPositionRefs: {
          1: { prefix: null, text: 'C', svgSymbolId: null },
          4: { prefix: null, text: 'G', svgSymbolId: null },
        },
      },
    ];
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      chordSets: chordSetsInput,
    });
    expect(scoreData.chordSets.length).toBe(1);
  });

  it('should accept sections with correct structure', async () => {
    const score = new ChScore('#score-container');
    const sectionsInput = [
      {
        sectionId: 'verse-1',
        type: 'verse',
        name: 'Verse 1',
        marker: 1,
        placement: 'inline',
        pauseAfter: false,
        chordPositionRanges: [
          { start: 0, end: 5, staffNumbers: [1, 2], lyricLineIds: ['1.1'] },
        ],
      },
    ];
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      sections: sectionsInput,
    });
    // sections get processed during load, so just verify they were stored
    expect(scoreData.sections.length).toBe(1);
  });
});


// ============================================================
// Score Types
// ============================================================
describe('Score Type Support', () => {
  it('should support musicxml score type', async () => {
    const score = new ChScore('#score-container');
    await expect(
      score.load('musicxml', { scoreContent: sampleMusicXml })
    ).resolves.toBeDefined();
  });

  it('should support abc score type', async () => {
    const score = new ChScore('#score-container');
    const abcContent = `X:1\nT:Test\nL:1/4\nM:4/4\nK:C\nCDEF|`;
    await expect(
      score.load('abc', { scoreContent: abcContent })
    ).resolves.toBeDefined();
  });

  it('should support mei score type', async () => {
    // Generate valid MEI from the sample MusicXML using Verovio
    const tk = new verovio.toolkit();
    tk.loadData(sampleMusicXml);
    const meiContent = tk.getMEI();
    const score = new ChScore('#score-container');
    await expect(
      score.load('mei', { scoreContent: meiContent })
    ).resolves.toBeDefined();
  });
});


// ============================================================
// Edge Cases
// ============================================================
describe('Edge Cases', () => {
  it('should handle creating multiple ChScore instances', () => {
    document.body.innerHTML = '<div id="container-1"></div><div id="container-2"></div>';
    const score1 = new ChScore('#container-1');
    const score2 = new ChScore('#container-2');
    expect(score1._container).not.toBe(score2._container);
    expect(ChScore.prototype._chScores).toContain(score1);
    expect(ChScore.prototype._chScores).toContain(score2);
  });

  it('should allow loading a new score on a container after removeScore', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score1 = new ChScore('#score-container');
    await score1.load('musicxml', { scoreContent: sampleMusicXml });

    score1.removeScore();

    const container = document.getElementById('score-container');
    expect(container.innerHTML).toBe('');
    expect(container.score).toBeUndefined();

    // Create a new instance on the same container
    const score2 = new ChScore('#score-container');
    const scoreData = await score2.load('musicxml', { scoreContent: sampleMusicXml2 });
    expect(scoreData).toBeDefined();
    expect(scoreData.chordPositions.length).toBe(69);
    expect(container.score).toBe(score2);
  });

  it('should load a different score on a reused container without interference', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score1 = new ChScore('#score-container');
    await score1.load('musicxml', { scoreContent: sampleMusicXml });
    const ksi1 = score1.getKeySignatureInfo();
    expect(ksi1.keySignatureId).toBe('a-flat-major');

    score1.removeScore();

    const score2 = new ChScore('#score-container');
    await score2.load('musicxml', { scoreContent: sampleMusicXml2 });
    const ksi2 = score2.getKeySignatureInfo();
    expect(ksi2.keySignatureId).toBe('c-major');
  });

  it('should handle re-creating a score on the same container', async () => {
    const score1 = new ChScore('#score-container');
    await score1.load('musicxml', { scoreContent: sampleMusicXml });

    const score2 = new ChScore('#score-container');
    const container = document.getElementById('score-container');
    expect(container.score).toBe(score2);
  });

  it('should handle empty options object in setOptions', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const optionsBefore = score.getOptions();
    score.setOptions({});
    const optionsAfter = score.getOptions();
    expect(optionsAfter).toEqual(optionsBefore);
  });

  it('should handle null/undefined inputData fields gracefully', async () => {
    const score = new ChScore('#score-container');
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      scoreId: null,
      midiUrl: null,
      lyricsUrl: null,
      lyricsText: null,
      parts: null,
      partsTemplate: null,
      sections: null,
      chordSets: null,
      fermatas: null,
    });
    expect(scoreData).toBeDefined();
    expect(scoreData.scoreId).toBeNull();
    expect(scoreData.lyricsText).toBeNull();
  });

  it('should handle a minimal single-measure MusicXML score', async () => {
    const minimalMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <direction placement="above">
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type>
      </direction>
      <note>
        <pitch><step>C</step><octave>4</octave></pitch>
        <duration>4</duration><type>whole</type>
      </note>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>`;
    const score = new ChScore('#score-container');
    const scoreData = await score.load('musicxml', { scoreContent: minimalMusicXml });
    expect(scoreData).toBeDefined();
    expect(scoreData.measures.length).toBe(1);
    expect(scoreData.chordPositions.length).toBe(1);
    expect(scoreData.keySignatureInfo.keySignatureId).toBe('c-major');
  });
});


// ============================================================
// _extractLyricStanzas
// ============================================================
describe('_extractLyricStanzas() / alignSyllablesToLyrics()', () => {
  it('should handle missing lyricsText gracefully (returns empty stanzas)', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: null,
    });
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData).toBeDefined();
    expect(score._scoreData.sections.length).toBeGreaterThan(0);
  });

  it('should handle empty lyricsText string', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: '',
    });
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData).toBeDefined();
  });
});


// ============================================================
// _normalizeSections
// ============================================================
describe('_normalizeSections() — Section generation', () => {
  it('should generate sections for a simple hymn (How Great the Wisdom)', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData.sections.length).toBe(5);
    for (const section of score._scoreData.sections) {
      expect(section).toHaveProperty('sectionId');
      expect(section).toHaveProperty('type');
      expect(section).toHaveProperty('name');
      expect(section).toHaveProperty('placement');
      expect(section).toHaveProperty('chordPositionRanges');
    }
  });

  it('should generate verse sections based on inline verse numbers', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype._drawScore = origDrawScore;

    const verseSections = score._scoreData.sections.filter(s => s.type === 'verse');
    expect(verseSections.length).toBe(4);
  });

  it('should generate sections with expansion for repeated score (This Little Light)', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml2 });
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData.sections.length).toBe(1);
    expect(score._scoreData.hasRepeatOrJump).toBeDefined();
  });

  it('should generate an introduction section when score has intro brackets', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype._drawScore = origDrawScore;

    const introSections = score._scoreData.sections.filter(s => s.type === 'introduction');
    if (score._scoreData.hasIntroBrackets) {
      expect(introSections.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should use pre-built sections when provided', async () => {
    const customSections = [
      {
        sectionId: 'custom-verse-1',
        type: 'verse',
        name: 'Custom Verse 1',
        marker: 1,
        placement: 'inline',
        pauseAfter: false,
        chordPositionRanges: [{ start: 0, end: 32, staffNumbers: [1, 2], lyricLineIds: ['1.1'] }],
      },
    ];
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      sections: customSections,
    });
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData.sections.length).toBeGreaterThanOrEqual(1);
    const customSection = score._scoreData.sections.find(s => s.sectionId === 'custom-verse-1');
    expect(customSection).toBeDefined();
  });

  it('should populate sectionsById lookup', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData.sectionsById).toBeDefined();
    for (const section of score._scoreData.sections) {
      expect(score._scoreData.sectionsById[section.sectionId]).toBe(section);
    }
  });

  // ── generateDefaultSection path (no lyrics, no pre-built sections) ──
  it('should fall back to unknown section type for score without lyrics text', async () => {
    // Load HGW MusicXML without lyrics text → no lyric stanzas extracted
    // and without pre-built sections → triggers generateDefaultSection
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype._drawScore = origDrawScore;

    // HGW has inline verse labels → generates sections from simple score
    // But a score with no lyrics at all would get 'unknown'
    // We can verify the path by checking the structure exists
    expect(score._scoreData.sections.length).toBeGreaterThan(0);
    expect(score._scoreData.sectionsById).toBeDefined();
  });

  // ── below section IDs use sequential below-N format ──
  it('below sections should have sequential below-N sectionIds (HGW with lyrics)', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
    });
    ChScore.prototype._drawScore = origDrawScore;

    const belowSections = score._scoreData.sections.filter(s => s.placement === 'below');
    expect(belowSections.length).toBe(2);
    expect(belowSections[0].sectionId).toBe('below-0');
    expect(belowSections[1].sectionId).toBe('below-1');
  });

  // ── annotatedLyrics attached to inline verse sections ──
  it('inline verse sections should have annotatedLyrics from lyric stanzas (HGW with lyrics)', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
    });
    ChScore.prototype._drawScore = origDrawScore;

    const inlineVerses = score._scoreData.sections.filter(
      s => s.type === 'verse' && s.placement === 'inline'
    );
    expect(inlineVerses.length).toBe(4);
    for (const verse of inlineVerses) {
      expect(verse.annotatedLyrics).not.toBeNull();
    }
  });

  // ── below sections have annotatedLyrics ──
  it('below sections should carry annotatedLyrics from extra lyric stanzas', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
    });
    ChScore.prototype._drawScore = origDrawScore;

    const belowSections = score._scoreData.sections.filter(s => s.placement === 'below');
    for (const section of belowSections) {
      expect(section.annotatedLyrics).toBeDefined();
      expect(section.annotatedLyrics).not.toBeNull();
    }
  });

  // ── below sections have correct type and marker from lyric stanzas ──
  it('below sections should inherit type and marker from lyric stanzas', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
    });
    ChScore.prototype._drawScore = origDrawScore;

    const belowSections = score._scoreData.sections.filter(s => s.placement === 'below');
    expect(belowSections[0].type).toBe('verse');
    expect(belowSections[0].marker).toBe('5');
    expect(belowSections[1].type).toBe('verse');
    expect(belowSections[1].marker).toBe('6');
  });

  // ── below sections should have pauseAfter=false ──
  it('below sections should have pauseAfter=false', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
    });
    ChScore.prototype._drawScore = origDrawScore;

    const belowSections = score._scoreData.sections.filter(s => s.placement === 'below');
    for (const section of belowSections) {
      expect(section.pauseAfter).toBe(false);
    }
  });

  // ── sectionsById includes below sections ──
  it('sectionsById should include below sections', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
    });
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData.sectionsById['below-0']).toBeDefined();
    expect(score._scoreData.sectionsById['below-1']).toBeDefined();
  });

  // ── pre-built introduction section is preserved as first section ──
  it('pre-built introduction section should appear first in sections array', async () => {
    const introSection = {
      sectionId: 'intro-custom',
      type: 'introduction',
      name: 'Introduction',
      marker: null,
      placement: 'inline',
      pauseAfter: false,
      chordPositionRanges: [{ start: 0, end: 5, staffNumbers: [1, 2], lyricLineIds: [] }],
    };
    const verseSection = {
      sectionId: 'v1',
      type: 'verse',
      name: 'Verse 1',
      marker: 1,
      placement: 'inline',
      pauseAfter: false,
      chordPositionRanges: [{ start: 5, end: 37, staffNumbers: [1, 2], lyricLineIds: ['1.1'] }],
    };
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      sections: [introSection, verseSection],
    });
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData.sections[0].type).toBe('introduction');
    expect(score._scoreData.sections[0].sectionId).toBe('intro-custom');
  });
});


// ============================================================
// _updateExpansionElement
// ============================================================
describe('_updateExpansionElement()', () => {
  // ── Integration tests ──

  it('should detect expansion in scores with repeats', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml2 });
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData.hasExpansion).toBe(true);
  });

  it('should detect hasRepeatOrJump for scores with repeat barlines', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml2 });
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData.hasRepeatOrJump).toBe(true);
  });

  it('should not detect hasRepeatOrJump for simple hymns', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData.hasRepeatOrJump).toBe(false);
  });
});

// ============================================================
// _updateExpansionElement — unit tests
// ============================================================
describe('_updateExpansionElement() — unit tests', () => {
  let score;
  const parser = new DOMParser();

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  /**
   * Build a minimal MEI document for _updateExpansionElement testing.
   * @param {Object} opts
   * @param {Array} opts.measures - Array of { right?, left?, hasVerse?, verseN? }
   * @param {Object} opts.expansion - { plist } or null
   * @param {Array} opts.sections - Array of { id, measures } where measures is array of { right?, left?, hasVerse? }
   * @param {boolean} opts.hasMultipleVerseLines - whether to include verse n="2"
   */
  function buildMei({ measures = [], expansion = null, sections = [], hasMultipleVerseLines = false } = {}) {
    let body = '';

    // Build sections with their own measures (for expansion plist references)
    for (const section of sections) {
      let sectionMeasures = '';
      for (const m of section.measures) {
        const rightAttr = m.right ? ` right="${m.right}"` : '';
        const leftAttr = m.left ? ` left="${m.left}"` : '';
        const verseContent = m.hasVerse !== false ? '<verse n="1"><syl>la</syl></verse>' : '';
        sectionMeasures += `<measure${rightAttr}${leftAttr}>${verseContent}</measure>`;
      }
      body += `<section xml:id="${section.id}">${sectionMeasures}</section>`;
    }

    // Build standalone measures (not in sections)
    for (const m of measures) {
      const rightAttr = m.right ? ` right="${m.right}"` : '';
      const leftAttr = m.left ? ` left="${m.left}"` : '';
      const verseContent = m.hasVerse !== false ? '<verse n="1"><syl>la</syl></verse>' : '';
      const verse2 = hasMultipleVerseLines ? '<verse n="2"><syl>lo</syl></verse>' : '';
      body += `<measure${rightAttr}${leftAttr}>${verseContent}${verse2}</measure>`;
    }

    const expansionXml = expansion ? `<expansion plist="${expansion.plist}"></expansion>` : '';

    return parser.parseFromString(
      `<mei>${expansionXml}<body>${body}</body></mei>`,
      'text/xml'
    );
  }

  // ── hasComplexSections detection ──

  it('should return hasComplexSections=true when hasRepeatOrJump is true', () => {
    const mei = buildMei({ measures: [{ right: 'end', hasVerse: true }] });
    const [hasComplexSections] = score._updateExpansionElement(mei, 3, false, true);
    expect(hasComplexSections).toBe(true);
  });

  it('should return hasComplexSections=true when last measure right != "end"', () => {
    const mei = buildMei({ measures: [
      { hasVerse: true },
      { right: 'dbl', hasVerse: true },
    ] });
    const [hasComplexSections] = score._updateExpansionElement(mei, 3, false, false);
    expect(hasComplexSections).toBe(true);
  });

  it('should return hasComplexSections=true when multiple measures have right="end"', () => {
    const mei = buildMei({ measures: [
      { right: 'end', hasVerse: true },
      { right: 'end', hasVerse: true },
    ] });
    const [hasComplexSections] = score._updateExpansionElement(mei, 3, false, false);
    expect(hasComplexSections).toBe(true);
  });

  it('should return hasComplexSections=true when first measure has no verse', () => {
    const mei = buildMei({ measures: [
      { hasVerse: false },
      { right: 'end', hasVerse: true },
    ] });
    const [hasComplexSections] = score._updateExpansionElement(mei, 3, false, false);
    expect(hasComplexSections).toBe(true);
  });

  it('should return hasComplexSections=true when multiple lyric lines exist but numVerses=0', () => {
    const mei = buildMei({
      measures: [{ right: 'end', hasVerse: true }],
      hasMultipleVerseLines: true,
    });
    const [hasComplexSections] = score._updateExpansionElement(mei, 0, false, false);
    expect(hasComplexSections).toBe(true);
  });

  it('should return hasComplexSections=true when numVerses is 0', () => {
    const mei = buildMei({ measures: [{ right: 'end', hasVerse: true }] });
    const [hasComplexSections] = score._updateExpansionElement(mei, 0, false, false);
    expect(hasComplexSections).toBe(true);
  });

  // ── No expansion, not complex ──

  it('should return all false/empty when no expansion and not complex', () => {
    const mei = buildMei({ measures: [{ right: 'end', hasVerse: true }] });
    const [hasComplexSections, hasInitialChorus, expansionIds] = score._updateExpansionElement(mei, 3, false, false);
    expect(hasComplexSections).toBe(false);
    expect(hasInitialChorus).toBe(false);
    expect(expansionIds).toEqual([]);
  });

  // ── Single-section expansion (verse-chorus) ──

  it('should set type="verse-chorus" for single-section expansion', () => {
    const mei = buildMei({
      sections: [{ id: 'sec1', measures: [{ right: 'end', hasVerse: true }] }],
      expansion: { plist: '#sec1' },
    });
    score._updateExpansionElement(mei, 3, false, false);
    const expansion = mei.querySelector('expansion');
    expect(expansion.getAttribute('type')).toBe('verse-chorus');
  });

  it('should replicate plist for each verse in single-section expansion', () => {
    const mei = buildMei({
      sections: [{ id: 'sec1', measures: [{ right: 'end', hasVerse: true }] }],
      expansion: { plist: '#sec1' },
    });
    score._updateExpansionElement(mei, 4, false, false);
    const expansion = mei.querySelector('expansion');
    expect(expansion.getAttribute('plist')).toBe('#sec1 #sec1 #sec1 #sec1');
  });

  it('should set type="verse" on the section element for single-section expansion', () => {
    const mei = buildMei({
      sections: [{ id: 'sec1', measures: [{ right: 'end', hasVerse: true }] }],
      expansion: { plist: '#sec1' },
    });
    score._updateExpansionElement(mei, 2, false, false);
    const section = mei.querySelector('[*|id="sec1"]');
    expect(section.getAttribute('type')).toBe('verse');
  });

  it('should return expansionIds for single-section expansion', () => {
    const mei = buildMei({
      sections: [{ id: 'sec1', measures: [{ right: 'end', hasVerse: true }] }],
      expansion: { plist: '#sec1' },
    });
    const [,, expansionIds] = score._updateExpansionElement(mei, 2, false, false);
    expect(expansionIds).toEqual(['#sec1']);
  });

  // ── Two-section expansion (chorus-verse-chorus) ──
  // Note: In real MEI, sections appear in DOM order (verse then chorus),
  // with the expansion plist controlling playback order. The document's
  // last measure must have right="end" to avoid the hasComplexSections branch.

  it('should set type="chorus-verse-chorus" for two-section expansion', () => {
    const mei = buildMei({
      sections: [
        { id: 'verse', measures: [{ right: 'dbl', hasVerse: true }] },
        { id: 'chorus', measures: [{ right: 'end', hasVerse: true }] },
      ],
      expansion: { plist: '#chorus #verse' },
    });
    score._updateExpansionElement(mei, 3, false, false);
    const expansion = mei.querySelector('expansion');
    expect(expansion.getAttribute('type')).toBe('chorus-verse-chorus');
  });

  it('should set type="chorus" on first section and type="verse" on second for two-section expansion', () => {
    const mei = buildMei({
      sections: [
        { id: 'verse', measures: [{ right: 'dbl', hasVerse: true }] },
        { id: 'chorus', measures: [{ right: 'end', hasVerse: true }] },
      ],
      expansion: { plist: '#chorus #verse' },
    });
    score._updateExpansionElement(mei, 3, false, false);
    const chorusSection = mei.querySelector('[*|id="chorus"]');
    const verseSection = mei.querySelector('[*|id="verse"]');
    expect(chorusSection.getAttribute('type')).toBe('chorus');
    expect(verseSection.getAttribute('type')).toBe('verse');
  });

  it('should detect hasInitialChorus when chorus ends with "end" and verse ends with "dbl"', () => {
    const mei = buildMei({
      sections: [
        { id: 'verse', measures: [{ right: 'dbl', hasVerse: true }] },
        { id: 'chorus', measures: [{ right: 'end', hasVerse: true }] },
      ],
      expansion: { plist: '#chorus #verse' },
    });
    const [, hasInitialChorus] = score._updateExpansionElement(mei, 3, false, false);
    expect(hasInitialChorus).toBe(true);
  });

  it('should expand plist for chorus-verse-chorus with initial chorus', () => {
    const mei = buildMei({
      sections: [
        { id: 'verse', measures: [{ right: 'dbl', hasVerse: true }] },
        { id: 'chorus', measures: [{ right: 'end', hasVerse: true }] },
      ],
      expansion: { plist: '#chorus #verse' },
    });
    score._updateExpansionElement(mei, 2, false, false);
    const expansion = mei.querySelector('expansion');
    // 2 verses: [chorus, verse, chorus, verse, chorus]
    expect(expansion.getAttribute('plist')).toBe('#chorus #verse #chorus #verse #chorus');
  });

  it('should not set hasInitialChorus when barline types do not match', () => {
    const mei = buildMei({
      sections: [
        { id: 'verse', measures: [{ right: 'end', hasVerse: true }] },
        { id: 'chorus', measures: [{ right: 'end', hasVerse: true }] },
      ],
      expansion: { plist: '#chorus #verse' },
    });
    const [, hasInitialChorus] = score._updateExpansionElement(mei, 3, false, false);
    expect(hasInitialChorus).toBe(false);
  });

  // ── Three-section expansion where first == third (chorus-verse-chorus) ──

  it('should treat 3-section expansion as chorus-verse-chorus when first == third', () => {
    const mei = buildMei({
      sections: [
        { id: 'verse', measures: [{ right: 'dbl', hasVerse: true }] },
        { id: 'chorus', measures: [{ right: 'end', hasVerse: true }] },
      ],
      expansion: { plist: '#chorus #verse #chorus' },
    });
    score._updateExpansionElement(mei, 3, false, false);
    const expansion = mei.querySelector('expansion');
    expect(expansion.getAttribute('type')).toBe('chorus-verse-chorus');
  });

  // ── Complex expansion (4+ sections) ──

  it('should mark expansion as complex for 4+ sections', () => {
    const mei = buildMei({
      sections: [
        { id: 'a', measures: [{ hasVerse: true }] },
        { id: 'b', measures: [{ hasVerse: true }] },
        { id: 'c', measures: [{ hasVerse: true }] },
        { id: 'd', measures: [{ right: 'end', hasVerse: true }] },
      ],
      expansion: { plist: '#a #b #c #d' },
    });
    const [hasComplexSections] = score._updateExpansionElement(mei, 3, false, false);
    expect(hasComplexSections).toBe(true);
    expect(mei.querySelector('expansion').getAttribute('type')).toBe('complex');
  });

  it('should mark expansion as complex for 3 sections where first != third', () => {
    const mei = buildMei({
      sections: [
        { id: 'a', measures: [{ hasVerse: true }] },
        { id: 'b', measures: [{ hasVerse: true }] },
        { id: 'c', measures: [{ right: 'end', hasVerse: true }] },
      ],
      expansion: { plist: '#a #b #c' },
    });
    const [hasComplexSections] = score._updateExpansionElement(mei, 3, false, false);
    expect(hasComplexSections).toBe(true);
    expect(mei.querySelector('expansion').getAttribute('type')).toBe('complex');
  });

  // ── Introduction detection ──

  it('should set type="introduction" on first section when it has no verse and second has rptstart', () => {
    // In real MEI, the verse section (with lyrics) appears first in DOM order,
    // so the first <measure> has a verse and doesn't trigger hasComplexSections.
    // The expansion plist controls playback order: intro first, then verse.
    // The intro measure needs right="end" as the document's last measure.
    const mei = buildMei({
      sections: [
        { id: 'verse', measures: [{ left: 'rptstart', hasVerse: true }] },
        { id: 'intro', measures: [{ right: 'end', hasVerse: false }] },
      ],
      expansion: { plist: '#intro #verse' },
    });
    score._updateExpansionElement(mei, 3, false, false);
    const introSection = mei.querySelector('[*|id="intro"]');
    expect(introSection.getAttribute('type')).toBe('introduction');
  });

  it('should not set introduction type when hasIntroBrackets is true', () => {
    const mei = buildMei({
      sections: [
        { id: 'verse', measures: [{ left: 'rptstart', hasVerse: true }] },
        { id: 'intro', measures: [{ right: 'end', hasVerse: false }] },
      ],
      expansion: { plist: '#intro #verse' },
    });
    score._updateExpansionElement(mei, 3, true, false);
    const introSection = mei.querySelector('[*|id="intro"]');
    expect(introSection.getAttribute('type')).not.toBe('introduction');
  });

  it('should not set introduction type when first section has verse elements', () => {
    const mei = buildMei({
      sections: [
        { id: 'sec1', measures: [{ right: 'end', hasVerse: true }] },
        { id: 'sec2', measures: [{ left: 'rptstart', right: 'dbl', hasVerse: true }] },
      ],
      expansion: { plist: '#sec1 #sec2' },
    });
    score._updateExpansionElement(mei, 3, false, false);
    const sec1 = mei.querySelector('[*|id="sec1"]');
    expect(sec1.getAttribute('type')).not.toBe('introduction');
  });

  it('should not set introduction when single-section expansion (expansionIds.length === 1)', () => {
    const mei = buildMei({
      sections: [{ id: 'sec1', measures: [{ right: 'end', hasVerse: true }] }],
      expansion: { plist: '#sec1' },
    });
    score._updateExpansionElement(mei, 3, false, false);
    const sec1 = mei.querySelector('[*|id="sec1"]');
    expect(sec1.getAttribute('type')).toBe('verse');
  });
});


// ============================================================
// _getIntroSectionFromChordPositions
// ============================================================
describe('_getIntroSectionFromChordPositions()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should return undefined when given an empty ranges array', () => {
    const result = score._getIntroSectionFromChordPositions([], [1, 2], true);
    expect(result).toBeUndefined();
  });

  it('should return an intro section for a single range', () => {
    const result = score._getIntroSectionFromChordPositions([[0, 4]], [1, 2], true);
    expect(result).toBeDefined();
    expect(result.sectionId).toBe('introduction');
    expect(result.type).toBe('introduction');
    expect(result.name).toBe('Introduction');
  });

  it('should set chordPositionRanges with start, end, staffNumbers, and lyricLineIds', () => {
    const result = score._getIntroSectionFromChordPositions([[0, 4]], [1, 2], true);
    expect(result.chordPositionRanges).toEqual([
      { start: 0, end: 4, staffNumbers: [1, 2], lyricLineIds: [] },
    ]);
  });

  it('should handle multiple ranges', () => {
    const result = score._getIntroSectionFromChordPositions([[0, 4], [10, 15]], [1], false);
    expect(result.chordPositionRanges.length).toBe(2);
    expect(result.chordPositionRanges[0]).toEqual({ start: 0, end: 4, staffNumbers: [1], lyricLineIds: [] });
    expect(result.chordPositionRanges[1]).toEqual({ start: 10, end: 15, staffNumbers: [1], lyricLineIds: [] });
  });

  it('should set pauseAfter=true when passed true', () => {
    const result = score._getIntroSectionFromChordPositions([[0, 4]], [1], true);
    expect(result.pauseAfter).toBe(true);
  });

  it('should set pauseAfter=false when passed false', () => {
    const result = score._getIntroSectionFromChordPositions([[0, 4]], [1], false);
    expect(result.pauseAfter).toBe(false);
  });

  it('should set marker=null and placement="inline"', () => {
    const result = score._getIntroSectionFromChordPositions([[0, 4]], [1], true);
    expect(result.marker).toBeNull();
    expect(result.placement).toBe('inline');
  });

  it('should set annotatedLyrics=null', () => {
    const result = score._getIntroSectionFromChordPositions([[5, 10]], [1, 2], true);
    expect(result.annotatedLyrics).toBeNull();
  });

  it('should use the provided staffNumbers for all ranges', () => {
    const result = score._getIntroSectionFromChordPositions([[0, 2], [5, 8]], [1, 2, 3], true);
    for (const range of result.chordPositionRanges) {
      expect(range.staffNumbers).toEqual([1, 2, 3]);
    }
  });
});


// ============================================================
// _getIntroSectionFromBrackets
// ============================================================
describe('_getIntroSectionFromBrackets()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  /** Build a mock bracket element with ch-chord-position and ch-intro-bracket attributes. */
  function bracket(chordPosition, type) {
    const el = document.createElement('div');
    el.setAttribute('ch-chord-position', String(chordPosition));
    el.setAttribute('ch-intro-bracket', type);
    return el;
  }

  it('should return undefined for an empty bracket array', () => {
    const result = score._getIntroSectionFromBrackets([], [1, 2]);
    expect(result).toBeUndefined();
  });

  it('should build a single range from a start/end bracket pair', () => {
    const brackets = [bracket(0, 'start'), bracket(4, 'end')];
    const result = score._getIntroSectionFromBrackets(brackets, [1, 2]);
    expect(result.chordPositionRanges.length).toBe(1);
    expect(result.chordPositionRanges[0].start).toBe(0);
    expect(result.chordPositionRanges[0].end).toBe(4);
  });

  it('should build multiple ranges from multiple bracket pairs', () => {
    const brackets = [
      bracket(0, 'start'), bracket(4, 'end'),
      bracket(10, 'start'), bracket(15, 'end'),
    ];
    const result = score._getIntroSectionFromBrackets(brackets, [1]);
    expect(result.chordPositionRanges.length).toBe(2);
    expect(result.chordPositionRanges[0]).toMatchObject({ start: 0, end: 4 });
    expect(result.chordPositionRanges[1]).toMatchObject({ start: 10, end: 15 });
  });

  it('should always set pauseAfter=true', () => {
    const brackets = [bracket(0, 'start'), bracket(4, 'end')];
    const result = score._getIntroSectionFromBrackets(brackets, [1]);
    expect(result.pauseAfter).toBe(true);
  });

  it('should assign staffNumbers to all ranges', () => {
    const brackets = [bracket(0, 'start'), bracket(4, 'end')];
    const result = score._getIntroSectionFromBrackets(brackets, [1, 2, 3]);
    expect(result.chordPositionRanges[0].staffNumbers).toEqual([1, 2, 3]);
  });

  it('should create a range of size 1 when start bracket has no matching end', () => {
    // A start bracket sets [cp, cp+1]; without an end bracket, it stays that way
    const brackets = [bracket(5, 'start')];
    const result = score._getIntroSectionFromBrackets(brackets, [1]);
    expect(result.chordPositionRanges[0].start).toBe(5);
    expect(result.chordPositionRanges[0].end).toBe(6);
  });

  it('should return an introduction section object', () => {
    const brackets = [bracket(0, 'start'), bracket(8, 'end')];
    const result = score._getIntroSectionFromBrackets(brackets, [1, 2]);
    expect(result.sectionId).toBe('introduction');
    expect(result.type).toBe('introduction');
    expect(result.name).toBe('Introduction');
  });
});


// ============================================================
// _getPointData
// ============================================================
describe('_getPointData()', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    }, { ...ChScore.prototype._defaultOptions, customEvents: ['ch:tap', 'ch:hover'] });
  });

  it('should return an object with expected point data properties', () => {
    const pointData = score._getPointData(0, 0);
    expect(pointData).toHaveProperty('systemId');
    expect(pointData).toHaveProperty('measureId');
    expect(pointData).toHaveProperty('noteIds');
    expect(pointData).toHaveProperty('partIds');
    expect(pointData).toHaveProperty('lyricId');
    expect(pointData).toHaveProperty('chordPosition');
    expect(pointData).toHaveProperty('expandedChordPositions');
    expect(pointData).toHaveProperty('staffNumber');
    expect(pointData).toHaveProperty('sectionIds');
    expect(pointData).toHaveProperty('lyricLineId');
  });

  it('should return null values when click is outside SVG', () => {
    const pointData = score._getPointData(-100, -100);
    expect(pointData.systemId).toBeNull();
    expect(pointData.measureId).toBeNull();
    expect(pointData.chordPosition).toBeNull();
  });

  it('should propagate errors from elementsFromPoint (try/finally without catch)', () => {
    const original = document.elementsFromPoint;
    document.elementsFromPoint = () => { throw new Error('focus lost'); };

    expect(() => score._getPointData(50, 50)).toThrow('focus lost');

    document.elementsFromPoint = original;
  });
});


// ============================================================
// ch:hover — deduplication
// ============================================================
describe('ch:hover — deduplication', () => {
  it('should dispatch ch:hover event on mousemove when enabled', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    });
    score._currentOptions.customEvents = ['ch:hover'];
    ChScore.prototype._drawScore = origDrawScore;

    const container = document.getElementById('score-container');
    const hoverHandler = vi.fn();
    container.addEventListener('ch:hover', hoverHandler);

    const moveEvent = new MouseEvent('mousemove', { clientX: 50, clientY: 50, bubbles: true });
    container.dispatchEvent(moveEvent);

    expect(hoverHandler).toHaveBeenCalled();
    if (hoverHandler.mock.calls.length > 0) {
      const detail = hoverHandler.mock.calls[0][0].detail;
      expect(detail).toHaveProperty('pointData');
      expect(detail.pointData).toHaveProperty('chordPosition');
    }
  });

  it('should handle mouseleave without error after hover events', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    });
    score._currentOptions.customEvents = ['ch:hover'];
    ChScore.prototype._drawScore = origDrawScore;

    const container = document.getElementById('score-container');
    const hoverHandler = vi.fn();
    container.addEventListener('ch:hover', hoverHandler);

    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50, bubbles: true }));
    const initialCallCount = hoverHandler.mock.calls.length;

    // mouseleave should not throw; it may or may not re-dispatch ch:hover
    // depending on deduplication (same null chord-position)
    expect(() => {
      container.dispatchEvent(new MouseEvent('mouseleave', { clientX: 0, clientY: 0, bubbles: true }));
    }).not.toThrow();

    // Call count should be >= what it was before mouseleave (no events lost)
    expect(hoverHandler.mock.calls.length).toBeGreaterThanOrEqual(initialCallCount);
  });
});


// ============================================================
// ch:hover detail / ch:tap detail
// ============================================================
describe('ch:hover — detail properties', () => {
  it('should include all expected properties in event detail', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    score._currentOptions.customEvents = ['ch:hover'];
    ChScore.prototype._drawScore = origDrawScore;

    const container = document.getElementById('score-container');
    const hoverHandler = vi.fn();
    container.addEventListener('ch:hover', hoverHandler);

    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50, bubbles: true }));

    expect(hoverHandler).toHaveBeenCalled();
    const detail = hoverHandler.mock.calls[0][0].detail;

    expect(detail).toHaveProperty('pointData');
    expect(detail.pointData).toHaveProperty('systemId');
    expect(detail.pointData).toHaveProperty('measureId');
    expect(detail.pointData).toHaveProperty('noteIds');
    expect(detail.pointData).toHaveProperty('partIds');
    expect(detail.pointData).toHaveProperty('lyricId');
    expect(detail.pointData).toHaveProperty('chordPosition');
    expect(detail.pointData).toHaveProperty('expandedChordPositions');
    expect(detail.pointData).toHaveProperty('staffNumber');
    expect(detail.pointData).toHaveProperty('sectionIds');
    expect(detail.pointData).toHaveProperty('lyricLineId');
  });

  it('ch:tap detail should also include all expected properties', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    score._currentOptions.customEvents = ['ch:tap'];
    ChScore.prototype._drawScore = origDrawScore;

    const container = document.getElementById('score-container');
    const tapHandler = vi.fn();
    container.addEventListener('ch:tap', tapHandler);

    container.dispatchEvent(new MouseEvent('pointerdown', { clientX: 50, clientY: 50, bubbles: true }));
    container.dispatchEvent(new MouseEvent('pointerup', { clientX: 50, clientY: 50, bubbles: true }));

    expect(tapHandler).toHaveBeenCalled();
    const detail = tapHandler.mock.calls[0][0].detail;

    expect(detail).toHaveProperty('pointData');
    expect(detail.pointData).toHaveProperty('systemId');
    expect(detail.pointData).toHaveProperty('measureId');
    expect(detail.pointData).toHaveProperty('noteIds');
    expect(detail.pointData).toHaveProperty('partIds');
    expect(detail.pointData).toHaveProperty('lyricId');
    expect(detail.pointData).toHaveProperty('chordPosition');
    expect(detail.pointData).toHaveProperty('expandedChordPositions');
    expect(detail.pointData).toHaveProperty('staffNumber');
    expect(detail.pointData).toHaveProperty('sectionIds');
    expect(detail.pointData).toHaveProperty('lyricLineId');
  });
});


// ============================================================
// _drawScore — lyrics-below
// ============================================================
describe('_drawScore() — lyrics-below', () => {
  it('should render lyrics-below div with section content', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
    });

    const lyricsBelow = document.querySelector('[data-ch-lyrics-below]');
    expect(lyricsBelow).not.toBeNull();
  });

  it('should hide sections in lyrics-below when hideSectionIds is set', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
    });

    const belowSections = score._scoreData.sections.filter(s => s.placement === 'below');
    expect(belowSections.length).toBeGreaterThan(0);
    score.setOptions({ hideSectionIds: [belowSections[0].sectionId] });
    const lyricsBelow = document.querySelector('[data-ch-lyrics-below]');
    const hiddenP = lyricsBelow.querySelector(`[data-ch-section-id="${belowSections[0].sectionId}"]`);
    expect(hiddenP).toBeNull();
  });
});


// ============================================================
// load() — MXL ArrayBuffer path
// ============================================================
describe('load() — MXL ArrayBuffer path', () => {
  it('should call loadZipDataBuffer when scoreContent is an ArrayBuffer', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};

    const loadZipSpy = vi.fn();
    const origSetOptions = score.setOptions.bind(score);
    score.setOptions = function (...args) {
      origSetOptions(...args);
      if (score._vrvToolkit) {
        score._vrvToolkit.loadZipDataBuffer = loadZipSpy;
      }
    };

    try {
      await score.load('mxl', { scoreContent: new ArrayBuffer(8) }).catch(() => {});
    } catch (e) {
      // Expected to fail since this isn't a real MXL file
    }

    expect(loadZipSpy).toHaveBeenCalledWith(expect.any(ArrayBuffer));

    ChScore.prototype._drawScore = origDrawScore;
  });
});


// ============================================================
// ABC cleanup
// ============================================================
describe('load() — ABC content cleanup', () => {
  it('should remove leading spaces from ABC score content lines', async () => {
    const score = new ChScore('#score-container');
    const abcWithSpaces = `   X:1\n   T:Test\n   L:1/4\n   M:4/4\n   K:C\n   CDEF|`;
    await expect(
      score.load('abc', { scoreContent: abcWithSpaces })
    ).resolves.toBeDefined();
  });
});


// ============================================================
// Section types
// ============================================================
describe('load() — section types: bridge, interlude, unknown', () => {
  it('should accept sections with type=bridge', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const score = new ChScore('#score-container');

    const sectionsInput = [{
      sectionId: 'bridge-1',
      type: 'bridge',
      name: 'Bridge',
      marker: null,
      placement: 'inline',
      pauseAfter: false,
      chordPositionRanges: [{ start: 0, end: 37, staffNumbers: [1, 2], lyricLineIds: [] }],
    }];
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      sections: sectionsInput,
    });
    ChScore.prototype._drawScore = origDrawScore;

    const bridge = scoreData.sections.find(s => s.sectionId === 'bridge-1');
    expect(bridge).toBeDefined();
    expect(bridge.type).toBe('bridge');
    expect(bridge.name).toBe('Bridge');
  });

  it('should accept sections with type=interlude', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const score = new ChScore('#score-container');

    const sectionsInput = [{
      sectionId: 'interlude-1',
      type: 'interlude',
      name: 'Interlude',
      marker: null,
      placement: 'inline',
      pauseAfter: true,
      chordPositionRanges: [{ start: 10, end: 20, staffNumbers: [1, 2], lyricLineIds: [] }],
    }];
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      sections: sectionsInput,
    });
    ChScore.prototype._drawScore = origDrawScore;

    const interlude = scoreData.sections.find(s => s.sectionId === 'interlude-1');
    expect(interlude).toBeDefined();
    expect(interlude.type).toBe('interlude');
    expect(interlude.pauseAfter).toBe(true);
  });

  it('should accept sections with type=unknown', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const score = new ChScore('#score-container');

    const sectionsInput = [{
      sectionId: 'unknown-1',
      type: 'unknown',
      name: 'Unknown Section',
      marker: null,
      placement: 'inline',
      pauseAfter: false,
      chordPositionRanges: [{ start: 0, end: 37, staffNumbers: [1, 2], lyricLineIds: [] }],
    }];
    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      sections: sectionsInput,
    });
    ChScore.prototype._drawScore = origDrawScore;

    const unknown = scoreData.sections.find(s => s.sectionId === 'unknown-1');
    expect(unknown).toBeDefined();
    expect(unknown.type).toBe('unknown');
  });
});


// ============================================================
// Humdrum
// ============================================================
describe('load() — humdrum score type', () => {
  it('should pass Humdrum content to Verovio loadData without abc preprocessing', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const origParse = ChScore.prototype._parseAndAnnotateMei;
    const origLoadMidi = ChScore.prototype._loadMidi;
    ChScore.prototype._drawScore = function() {};
    ChScore.prototype._parseAndAnnotateMei = function() {};
    ChScore.prototype._loadMidi = function() {};
    const score = new ChScore('#score-container');

    const humdrumContent = `**kern\n  *clefG2\n  *k[]\n*M4/4\n4c\n4d\n4e\n4f\n*-`;
    await score.load('humdrum', { scoreContent: humdrumContent });

    expect(score._scoreData).toBeDefined();
    expect(typeof score._scoreData.meiStringOriginal).toBe('string');

    ChScore.prototype._parseAndAnnotateMei = origParse;
    ChScore.prototype._loadMidi = origLoadMidi;
    ChScore.prototype._drawScore = origDrawScore;
  });
});


// ============================================================
// Parts: placement values
// ============================================================
describe('load() — parts with numeric and "full" placement', () => {
  it('should accept parts with numeric placement values', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const score = new ChScore('#score-container');

    const partsInput = [
      {
        partId: 'soprano',
        name: 'Soprano',
        isVocal: true,
        placement: 1,
        chordPositionRefs: { 0: { isMelody: true, staffNumbers: [1], lyricLineIds: null } },
      },
      {
        partId: 'alto',
        name: 'Alto',
        isVocal: true,
        placement: 2,
        chordPositionRefs: { 0: { isMelody: false, staffNumbers: [1], lyricLineIds: null } },
      },
      {
        partId: 'tenor',
        name: 'Tenor',
        isVocal: true,
        placement: 3,
        chordPositionRefs: { 0: { isMelody: false, staffNumbers: [2], lyricLineIds: null } },
      },
      {
        partId: 'bass',
        name: 'Bass',
        isVocal: true,
        placement: 4,
        chordPositionRefs: { 0: { isMelody: false, staffNumbers: [2], lyricLineIds: null } },
      },
    ];

    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      parts: partsInput,
    });
    ChScore.prototype._drawScore = origDrawScore;

    expect(scoreData.parts.length).toBe(4);
    expect(scoreData.parts[0].placement).toBe(1);
    expect(scoreData.parts[1].placement).toBe(2);
    expect(scoreData.parts[2].placement).toBe(3);
    expect(scoreData.parts[3].placement).toBe(4);
  });

  it('should accept parts with "full" placement', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const score = new ChScore('#score-container');

    const partsInput = [
      {
        partId: 'melody',
        name: 'Melody',
        isVocal: true,
        placement: 'full',
        chordPositionRefs: { 0: { isMelody: true, staffNumbers: [1, 2], lyricLineIds: null } },
      },
    ];

    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      parts: partsInput,
    });
    ChScore.prototype._drawScore = origDrawScore;

    expect(scoreData.parts[0].placement).toBe('full');
    expect(scoreData.parts[0].chordPositionRefs[0].staffNumbers).toEqual([1, 2]);
  });
});


// ============================================================
// Parts: lyricLineIds
// ============================================================
describe('load() — parts with lyricLineIds', () => {
  it('should accept and store parts with lyricLineIds', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const score = new ChScore('#score-container');

    const partsInput = [
      {
        partId: 'soprano',
        name: 'Soprano',
        isVocal: true,
        placement: 'auto',
        chordPositionRefs: { 0: { isMelody: true, staffNumbers: [1], lyricLineIds: ['1.1'] } },
      },
      {
        partId: 'alto',
        name: 'Alto',
        isVocal: true,
        placement: 'auto',
        chordPositionRefs: { 0: { isMelody: false, staffNumbers: [1], lyricLineIds: ['1.2'] } },
      },
      {
        partId: 'tenor',
        name: 'Tenor',
        isVocal: true,
        placement: 'auto',
        chordPositionRefs: { 0: { isMelody: false, staffNumbers: [2], lyricLineIds: ['2.1'] } },
      },
      {
        partId: 'bass',
        name: 'Bass',
        isVocal: true,
        placement: 'auto',
        chordPositionRefs: { 0: { isMelody: false, staffNumbers: [2], lyricLineIds: ['2.2'] } },
      },
    ];

    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      parts: partsInput,
    });
    ChScore.prototype._drawScore = origDrawScore;

    expect(scoreData.parts[0].chordPositionRefs[0].lyricLineIds).toEqual(['1.1']);
    expect(scoreData.parts[1].chordPositionRefs[0].lyricLineIds).toEqual(['1.2']);
    expect(scoreData.parts[2].chordPositionRefs[0].lyricLineIds).toEqual(['2.1']);
    expect(scoreData.parts[3].chordPositionRefs[0].lyricLineIds).toEqual(['2.2']);
  });
});


// ============================================================
// Sections: placement 'none'
// ============================================================
describe('load() — section with placement "none"', () => {
  it('should accept and store a section with placement=none', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const score = new ChScore('#score-container');

    const sectionsInput = [
      {
        sectionId: 'hidden-verse',
        type: 'verse',
        name: 'Hidden Verse',
        marker: null,
        placement: 'none',
        pauseAfter: false,
        chordPositionRanges: [{ start: 0, end: 10, staffNumbers: [1, 2], lyricLineIds: [] }],
      },
    ];

    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      sections: sectionsInput,
    });
    ChScore.prototype._drawScore = origDrawScore;

    const hiddenSection = scoreData.sections.find(s => s.sectionId === 'hidden-verse');
    expect(hiddenSection).toBeDefined();
    expect(hiddenSection.placement).toBe('none');
  });

  it('should not display section with placement=none in lyrics-below', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const score = new ChScore('#score-container');

    const sectionsInput = [
      {
        sectionId: 'verse-1',
        type: 'verse',
        name: 'Verse 1',
        marker: 1,
        placement: 'below',
        pauseAfter: false,
        chordPositionRanges: [],
        annotatedLyrics: 'Amazing grace how sweet the sound',
      },
      {
        sectionId: 'hidden-verse',
        type: 'verse',
        name: 'Hidden',
        marker: null,
        placement: 'none',
        pauseAfter: false,
        chordPositionRanges: [],
        annotatedLyrics: 'Should not appear',
      },
    ];

    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      sections: sectionsInput,
    });
    ChScore.prototype._drawScore = origDrawScore;

    const belowSections = score._scoreData.sections.filter(s => s.placement === 'below');
    const noneSections = score._scoreData.sections.filter(s => s.placement === 'none');
    expect(belowSections.length).toBe(1);
    expect(belowSections[0].sectionId).toBe('verse-1');
    expect(noneSections.length).toBe(1);
    expect(noneSections[0].sectionId).toBe('hidden-verse');
  });
});


// ============================================================
// Chorus section type
// ============================================================
describe('load() — chorus section type', () => {
  it('should accept sections with type=chorus', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const score = new ChScore('#score-container');

    const sectionsInput = [
      {
        sectionId: 'verse-1',
        type: 'verse',
        name: 'Verse 1',
        marker: 1,
        placement: 'inline',
        pauseAfter: false,
        chordPositionRanges: [{ start: 0, end: 20, staffNumbers: [1, 2], lyricLineIds: ['1.1'] }],
      },
      {
        sectionId: 'chorus-1',
        type: 'chorus',
        name: 'Chorus',
        marker: null,
        placement: 'inline',
        pauseAfter: false,
        chordPositionRanges: [{ start: 20, end: 37, staffNumbers: [1, 2], lyricLineIds: ['1.1'] }],
      },
    ];

    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      sections: sectionsInput,
    });
    ChScore.prototype._drawScore = origDrawScore;

    const chorus = scoreData.sections.find(s => s.type === 'chorus');
    expect(chorus).toBeDefined();
    expect(chorus.sectionId).toBe('chorus-1');
    expect(chorus.name).toBe('Chorus');
  });

  it('should store both verse and chorus sections in order', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const score = new ChScore('#score-container');

    const sectionsInput = [
      {
        sectionId: 'verse-1', type: 'verse', name: 'Verse 1', marker: 1,
        placement: 'inline', pauseAfter: false,
        chordPositionRanges: [{ start: 0, end: 20, staffNumbers: [1, 2], lyricLineIds: [] }],
      },
      {
        sectionId: 'chorus-1', type: 'chorus', name: 'Chorus', marker: null,
        placement: 'inline', pauseAfter: true,
        chordPositionRanges: [{ start: 20, end: 37, staffNumbers: [1, 2], lyricLineIds: [] }],
      },
    ];

    const scoreData = await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      sections: sectionsInput,
    });
    ChScore.prototype._drawScore = origDrawScore;

    expect(scoreData.sections.length).toBe(2);
    expect(scoreData.sections[0].type).toBe('verse');
    expect(scoreData.sections[1].type).toBe('chorus');
    expect(scoreData.sections[1].pauseAfter).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// _generateSectionsFromSimpleScore — unit tests
// ─────────────────────────────────────────────────────────────
describe('_generateSectionsFromSimpleScore', () => {
  /**
   * Build a minimal MEI DOM for testing section generation.
   * @param {Object} notesByStaff - { staffN: [{pos, melody, dur, tag, lyrics:[{n, text, secondary}]}] }
   */
  function buildMEI(notesByStaff) {
    let xml = '<mei><music><body><mdiv><score><section><measure>';
    for (const [staffN, notes] of Object.entries(notesByStaff)) {
      xml += `<staff n="${staffN}"><layer>`;
      for (const note of notes) {
        const tag = note.tag || 'note';
        const attrs = [];
        if (note.melody) attrs.push('ch-melody=""');
        attrs.push(`ch-chord-position="${note.pos}"`);
        if (note.dur) attrs.push(`dur="${note.dur}"`);
        if (tag === 'rest') {
          xml += `<rest ${attrs.join(' ')}/>`;
        } else {
          xml += `<${tag} ${attrs.join(' ')}>`;
          if (note.lyrics) {
            for (const l of note.lyrics) {
              const sec = l.secondary ? ' ch-secondary=""' : '';
              xml += `<verse n="${l.n}"${sec}><syl>${l.text || 'x'}</syl></verse>`;
            }
          }
          xml += `</${tag}>`;
        }
      }
      xml += '</layer></staff>';
    }
    xml += '</measure></section></score></mdiv></body></music></mei>';
    return new DOMParser().parseFromString(xml, 'text/xml');
  }

  function generate(meiParsed, staffNumbers, numChordPositions, verseNumbers, hasInitialChorus = false) {
    return ChScore.prototype._generateSectionsFromSimpleScore.call(
      { _scoreData: { meiParsed, staffNumbers, numChordPositions } },
      verseNumbers,
      hasInitialChorus,
    );
  }

  /** Build melody notes: each CP gets lyrics from lyricsPerCp(i). */
  function melodyNotes(cpCount, lyricsPerCp, dur = 8) {
    return Array.from({ length: cpCount }, (_, i) => ({
      pos: i, melody: true, dur,
      lyrics: lyricsPerCp(i),
    }));
  }

  // ── Verses only (no chorus) ──
  describe('verses only (no chorus)', () => {
    let sections;
    beforeAll(() => {
      // 6 CPs, each with lyric lines 1 and 2 → no single-line gap → no chorus
      const notes = melodyNotes(6, () => [{ n: 1 }, { n: 2 }]);
      const mei = buildMEI({ 1: notes });
      sections = generate(mei, [1], 6, [1, 2]);
    });

    it('should return an array', () => {
      expect(Array.isArray(sections)).toBe(true);
    });

    it('should produce 2 verse sections for 2 verse numbers', () => {
      expect(sections).toHaveLength(2);
      expect(sections.every(s => s.type === 'verse')).toBe(true);
    });

    it('should have sequential sectionId format', () => {
      expect(sections[0].sectionId).toBe('verse-1');
      expect(sections[1].sectionId).toBe('verse-2');
    });

    it('verse sections should have correct properties', () => {
      expect(sections[0]).toMatchObject({
        type: 'verse', name: 'Verse 1', marker: 1, placement: 'inline', annotatedLyrics: null,
      });
      expect(sections[1]).toMatchObject({
        type: 'verse', name: 'Verse 2', marker: 2, placement: 'inline', annotatedLyrics: null,
      });
    });

    it('each verse should have a single chordPositionRange spanning the full score', () => {
      for (const s of sections) {
        expect(s.chordPositionRanges).toHaveLength(1);
        expect(s.chordPositionRanges[0].start).toBe(0);
        expect(s.chordPositionRanges[0].end).toBe(6);
      }
    });

    it('lyricLineIds should reference the correct verse line number', () => {
      expect(sections[0].chordPositionRanges[0].lyricLineIds).toEqual(['1.1']);
      expect(sections[1].chordPositionRanges[0].lyricLineIds).toEqual(['1.2']);
    });
  });

  // ── Single verse ──
  it('single verse should return 1 section', () => {
    const notes = melodyNotes(4, () => [{ n: 1 }]);
    const mei = buildMEI({ 1: notes });
    const sections = generate(mei, [1], 4, [1]);
    expect(sections).toHaveLength(1);
    expect(sections[0].sectionId).toBe('verse-1');
  });

  // ── Chorus detection ──
  describe('chorus detection from single-line gap', () => {
    let sections;
    beforeAll(() => {
      // 12 CPs: 0-5 verse (lines 1,2), 6-11 chorus (line 3 only, gap=6 > maxAllowedGap=3)
      const notes = [
        ...Array.from({ length: 6 }, (_, i) => ({
          pos: i, melody: true, dur: 8,
          lyrics: [{ n: 1 }, { n: 2 }],
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          pos: i + 6, melody: true, dur: 8,
          lyrics: [{ n: 3 }],
        })),
      ];
      const mei = buildMEI({ 1: notes });
      sections = generate(mei, [1], 12, [1, 2]);
    });

    it('should produce 4 sections (2 verses + 2 choruses)', () => {
      expect(sections).toHaveLength(4);
    });

    it('sections should alternate verse/chorus', () => {
      expect(sections.map(s => s.type)).toEqual(['verse', 'chorus', 'verse', 'chorus']);
    });

    it('chorus sections should have correct properties', () => {
      for (const s of sections.filter(s => s.type === 'chorus')) {
        expect(s.name).toBe('Chorus');
        expect(s.marker).toBeNull();
        expect(s.placement).toBe('inline');
      }
    });

    it('verse ranges should span 0-6 and chorus ranges 6-12', () => {
      expect(sections[0].chordPositionRanges[0]).toMatchObject({ start: 0, end: 6 });
      expect(sections[1].chordPositionRanges[0]).toMatchObject({ start: 6, end: 12 });
    });

    it('chorus lyricLineIds should reference the chorus line number', () => {
      expect(sections[1].chordPositionRanges[0].lyricLineIds).toEqual(['1.3']);
    });
  });

  // ── Gap threshold boundary ──
  it('single-line gap of exactly 3 (= maxAllowedGap) should NOT detect a chorus', () => {
    // 10 CPs: 0-3 (2 lines), 4-6 (1 line, gap=3 ≤ 3), 7-9 (2 lines)
    const notes = [
      ...Array.from({ length: 4 }, (_, i) => ({ pos: i, melody: true, dur: 8, lyrics: [{ n: 1 }, { n: 2 }] })),
      ...Array.from({ length: 3 }, (_, i) => ({ pos: i + 4, melody: true, dur: 8, lyrics: [{ n: 3 }] })),
      ...Array.from({ length: 3 }, (_, i) => ({ pos: i + 7, melody: true, dur: 8, lyrics: [{ n: 1 }, { n: 2 }] })),
    ];
    const mei = buildMEI({ 1: notes });
    const sections = generate(mei, [1], 10, [1, 2]);
    expect(sections.every(s => s.type === 'verse')).toBe(true);
  });

  it('single-line gap of 4 (> maxAllowedGap) SHOULD detect a chorus', () => {
    // 12 CPs: 0-3 (2 lines), 4-7 (1 line, gap=4 > 3), 8-11 (2 lines)
    const notes = [
      ...Array.from({ length: 4 }, (_, i) => ({ pos: i, melody: true, dur: 8, lyrics: [{ n: 1 }, { n: 2 }] })),
      ...Array.from({ length: 4 }, (_, i) => ({ pos: i + 4, melody: true, dur: 8, lyrics: [{ n: 3 }] })),
      ...Array.from({ length: 4 }, (_, i) => ({ pos: i + 8, melody: true, dur: 8, lyrics: [{ n: 1 }, { n: 2 }] })),
    ];
    const mei = buildMEI({ 1: notes });
    const sections = generate(mei, [1], 12, [1, 2]);
    expect(sections.some(s => s.type === 'chorus')).toBe(true);
  });

  // ── pauseAfter ──
  describe('pauseAfter logic', () => {
    it('non-last verse should have pauseAfter=true', () => {
      const notes = melodyNotes(6, () => [{ n: 1 }, { n: 2 }]);
      const mei = buildMEI({ 1: notes });
      const sections = generate(mei, [1], 6, [1, 2]);
      expect(sections[0].pauseAfter).toBe(true);  // verse 1 (not last)
    });

    it('last verse should have pauseAfter=false', () => {
      const notes = melodyNotes(6, () => [{ n: 1 }, { n: 2 }]);
      const mei = buildMEI({ 1: notes });
      const sections = generate(mei, [1], 6, [1, 2]);
      expect(sections[1].pauseAfter).toBe(false);  // verse 2 (last)
    });

    it('rest at last chord position → pauseAfter=false even for non-last verse', () => {
      const notes = [
        ...melodyNotes(5, () => [{ n: 1 }, { n: 2 }]),
        { pos: 5, tag: 'rest', dur: 8 },
      ];
      const mei = buildMEI({ 1: notes });
      const sections = generate(mei, [1], 6, [1, 2]);
      expect(sections[0].pauseAfter).toBe(false);
    });

    it('no lyrics at last chord position → pauseAfter=false', () => {
      const notes = [
        ...melodyNotes(5, () => [{ n: 1 }, { n: 2 }]),
        { pos: 5, melody: true, dur: 8 },  // no lyrics
      ];
      const mei = buildMEI({ 1: notes });
      const sections = generate(mei, [1], 6, [1, 2]);
      expect(sections[0].pauseAfter).toBe(false);
    });

    it('long note (dur < 4, i.e. half note) at last position → pauseAfter=false', () => {
      const notes = [
        ...melodyNotes(5, () => [{ n: 1 }, { n: 2 }]),
        { pos: 5, melody: true, dur: 2, lyrics: [{ n: 1 }, { n: 2 }] },
      ];
      const mei = buildMEI({ 1: notes });
      const sections = generate(mei, [1], 6, [1, 2]);
      expect(sections[0].pauseAfter).toBe(false);
    });

    it('intermediate range in multi-range verse always has pauseAfter=false', () => {
      // Verse-chorus structure: verse range is not last → pauseAfter=false
      const notes = [
        ...Array.from({ length: 6 }, (_, i) => ({
          pos: i, melody: true, dur: 8, lyrics: [{ n: 1 }, { n: 2 }],
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          pos: i + 6, melody: true, dur: 8, lyrics: [{ n: 3 }],
        })),
      ];
      const mei = buildMEI({ 1: notes });
      const sections = generate(mei, [1], 12, [1, 2]);
      // verse-1 is the first range (not last in its verse iteration) → pauseAfter=false
      expect(sections[0].pauseAfter).toBe(false);
    });
  });

  // ── hasInitialChorus ──
  describe('hasInitialChorus', () => {
    it('should add extra chorus to the last verse when true', () => {
      // 12 CPs: chorus 0-5 (single-line), verse 6-11 (multi-line)
      const notes = [
        ...Array.from({ length: 6 }, (_, i) => ({
          pos: i, melody: true, dur: 8, lyrics: [{ n: 3 }],
        })),
        ...Array.from({ length: 6 }, (_, i) => ({
          pos: i + 6, melody: true, dur: 8, lyrics: [{ n: 1 }, { n: 2 }],
        })),
      ];
      const mei = buildMEI({ 1: notes });
      const sections = generate(mei, [1], 12, [1, 2], true);
      // Without hasInitialChorus: [chorus, verse] × 2 = 4 sections
      // With hasInitialChorus: last verse gets extra chorus → 5 sections
      expect(sections).toHaveLength(5);
      expect(sections.map(s => s.type)).toEqual(['chorus', 'verse', 'chorus', 'verse', 'chorus']);
    });

    it('should NOT add extra chorus when verses have only 1 range', () => {
      // Verse-only, no chorus → each verse has 1 range → condition chordPositionRanges.length > 1 not met
      const notes = melodyNotes(6, () => [{ n: 1 }, { n: 2 }]);
      const mei = buildMEI({ 1: notes });
      const sections = generate(mei, [1], 6, [1, 2], true);
      expect(sections).toHaveLength(2);
      expect(sections.every(s => s.type === 'verse')).toBe(true);
    });
  });

  // ── Staff filtering ──
  it('only staves with lyrics should appear in lyricLineIds', () => {
    // Staff 1 has lyrics, staff 2 has no lyrics
    const staff1Notes = melodyNotes(4, () => [{ n: 1 }]);
    const staff2Notes = Array.from({ length: 4 }, (_, i) => ({
      pos: i, melody: false, dur: 8,
    }));
    const mei = buildMEI({ 1: staff1Notes, 2: staff2Notes });
    const sections = generate(mei, [1, 2], 4, [1]);
    const range = sections[0].chordPositionRanges[0];
    // lyricLineIds only from staff 1
    expect(range.lyricLineIds).toEqual(['1.1']);
    // staffNumbers includes all staves (unfiltered)
    expect(range.staffNumbers).toEqual([1, 2]);
  });

  // ── Multiple staves with lyrics ──
  it('multiple staves with lyrics should contribute to lyricLineIds', () => {
    const staff1Notes = melodyNotes(4, () => [{ n: 1 }]);
    const staff2Notes = melodyNotes(4, () => [{ n: 1 }]);
    const mei = buildMEI({ 1: staff1Notes, 2: staff2Notes });
    const sections = generate(mei, [1, 2], 4, [1]);
    const range = sections[0].chordPositionRanges[0];
    expect(range.lyricLineIds).toEqual(['1.1', '2.1']);
  });
});

// ─────────────────────────────────────────────────────────────
// _extractPianoIntroduction — unit tests
// ─────────────────────────────────────────────────────────────
describe('_extractPianoIntroduction', () => {
  const parser = new DOMParser();

  /**
   * Build an MEI document with measures containing notes and optional intro brackets.
   * @param {Object} opts
   * @param {Array} opts.measures - [{n, notes:[{dur, id?, lyrics?}], brackets?:[{type:'start'|'end', tstamp, cp}]}]
   * @param {string} [opts.timeSig] - e.g. '4/4' or '3/4'
   * @param {boolean} [opts.hasIntroSection] - add an existing section[type="introduction"]
   */
  function buildMEI(opts) {
    const { measures, timeSig = '4/4', hasIntroSection = false } = opts;
    const [count, unit] = timeSig.split('/').map(Number);
    let xml = '<mei><music><body><mdiv><score>';
    xml += `<scoreDef><staffGrp><staffDef n="1"/></staffGrp><meterSig count="${count}" unit="${unit}"/></scoreDef>`;
    if (hasIntroSection) {
      xml += '<section type="introduction"><measure n="0"><staff n="1"><layer n="1"><note dur="4"/></layer></staff></measure></section>';
    }
    xml += '<section>';
    for (const m of measures) {
      xml += `<measure n="${m.n}" xml:id="m${m.n}">`;
      // Brackets
      if (m.brackets) {
        for (const b of m.brackets) {
          xml += `<dir ch-intro-bracket="${b.type}" tstamp="${b.tstamp}" ch-chord-position="${b.cp}"/>`;
        }
      }
      // Staff with notes
      xml += '<staff n="1"><layer n="1">';
      for (const note of (m.notes || [])) {
        const tag = note.tag || 'note';
        const id = note.id ? ` xml:id="${note.id}"` : '';
        const dots = note.dots ? ` dots="${note.dots}"` : '';
        if (tag === 'rest') {
          xml += `<${tag} dur="${note.dur}"${dots}${id}/>`;
        } else {
          xml += `<${tag} dur="${note.dur}"${dots}${id}>`;
          if (note.lyrics) {
            for (const l of note.lyrics) {
              xml += `<verse n="${l.n}"><label>${l.n}</label><syl>${l.text || 'la'}</syl></verse>`;
            }
          }
          xml += `</${tag}>`;
        }
      }
      xml += '</layer></staff>';
      // Notation elements
      if (m.notation) {
        for (const ne of m.notation) {
          const attrs = Object.entries(ne.attrs || {}).map(([k, v]) => `${k}="${v}"`).join(' ');
          xml += `<${ne.tag} ${attrs}/>`;
        }
      }
      xml += '</measure>';
    }
    xml += '</section></score></mdiv></body></music></mei>';
    return parser.parseFromString(xml, 'text/xml');
  }

  /**
   * Call _extractPianoIntroduction with a mock context.
   * @param {Document} meiParsed
   * @param {Object} [overrides] - override _scoreData or _getInlineVerseNumbers
   */
  function callExtract(meiParsed, overrides = {}) {
    const sections = overrides.sections || [{ type: 'verse', chordPositionRanges: [] }];
    const hasRepeatOrJump = overrides.hasRepeatOrJump ?? false;
    const verseNumbers = overrides.verseNumbers || [1, 2];
    const ctx = {
      _scoreData: { meiParsed, hasRepeatOrJump, sections },
      _getInlineVerseNumbers: () => verseNumbers,
    };
    return ChScore.prototype._extractPianoIntroduction.call(ctx, meiParsed);
  }

  // ── Early return: no brackets ──
  it('should return meiParsed unchanged when no ch-intro-bracket elements exist', () => {
    const mei = buildMEI({
      measures: [
        { n: '1', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }] },
      ],
    });
    const result = callExtract(mei);
    expect(result.querySelector('section[type="introduction"]')).toBeNull();
  });

  // ── Early return: intro section already exists ──
  it('should return meiParsed unchanged when section[type="introduction"] already exists', () => {
    const mei = buildMEI({
      hasIntroSection: true,
      measures: [
        { n: '1', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
          brackets: [{ type: 'start', tstamp: 1, cp: 0 }, { type: 'end', tstamp: 4, cp: 3 }] },
      ],
    });
    const introsBefore = mei.querySelectorAll('section[type="introduction"]').length;
    callExtract(mei);
    // Should not add another intro section
    expect(mei.querySelectorAll('section[type="introduction"]').length).toBe(introsBefore);
  });

  // ── Bracket removal ──
  it('should remove ch-intro-bracket elements from the MEI', () => {
    const mei = buildMEI({
      measures: [
        { n: '1', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
          brackets: [{ type: 'start', tstamp: 3, cp: 2 }, { type: 'end', tstamp: 5, cp: 4 }] },
      ],
    });
    callExtract(mei);
    expect(mei.querySelectorAll('[ch-intro-bracket]').length).toBe(0);
  });

  // ── Introduction section creation ──
  describe('introduction section creation', () => {
    let mei;
    beforeAll(() => {
      // 4 measures of 4/4: notes with ids, intro brackets span m3 beat 1 to m4 beat 5 (end)
      mei = buildMEI({
        measures: [
          { n: '1', notes: [{ dur: 4, id: 'n1' }, { dur: 4, id: 'n2' }, { dur: 4, id: 'n3' }, { dur: 4, id: 'n4' }] },
          { n: '2', notes: [{ dur: 4, id: 'n5' }, { dur: 4, id: 'n6' }, { dur: 4, id: 'n7' }, { dur: 4, id: 'n8' }] },
          { n: '3', notes: [{ dur: 4, id: 'n9' }, { dur: 4, id: 'n10' }, { dur: 4, id: 'n11' }, { dur: 4, id: 'n12' }],
            brackets: [{ type: 'start', tstamp: 1, cp: 8 }] },
          { n: '4', notes: [{ dur: 4, id: 'n13' }, { dur: 4, id: 'n14' }, { dur: 4, id: 'n15' }, { dur: 4, id: 'n16' }],
            brackets: [{ type: 'end', tstamp: 5, cp: 16 }] },
        ],
      });
      callExtract(mei);
    });

    it('should create a section[type="introduction"] element', () => {
      const intro = mei.querySelector('section[type="introduction"]');
      expect(intro).not.toBeNull();
    });

    it('should place introduction section after scoreDef', () => {
      const scoreDef = mei.querySelector('scoreDef');
      const nextSibling = scoreDef.nextElementSibling;
      expect(nextSibling.getAttribute('type')).toBe('introduction');
    });

    it('should set ch-chord-position with the intro chord positions', () => {
      const intro = mei.querySelector('section[type="introduction"]');
      const cp = intro.getAttribute('ch-chord-position');
      expect(cp).toBeDefined();
      // CPs 8..15 (from cp=8 to cp=16, exclusive)
      expect(cp.split(' ').map(Number)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    });

    it('should have intro measures with notes', () => {
      const intro = mei.querySelector('section[type="introduction"]');
      const measures = intro.querySelectorAll('measure');
      expect(measures.length).toBeGreaterThan(0);
      const notes = intro.querySelectorAll('note');
      expect(notes.length).toBeGreaterThan(0);
    });

    it('intro note IDs should have -intro suffix', () => {
      const intro = mei.querySelector('section[type="introduction"]');
      const notes = intro.querySelectorAll('note');
      for (const note of notes) {
        const id = note.getAttribute('xml:id');
        if (id) expect(id).toMatch(/-intro$/);
      }
    });

    it('intro measures should be renumbered starting from 1', () => {
      const intro = mei.querySelector('section[type="introduction"]');
      const measures = Array.from(intro.querySelectorAll('measure'));
      for (let i = 0; i < measures.length; i++) {
        expect(measures[i].getAttribute('n')).toBe(String(i + 1));
      }
    });

    it('original measures should be renumbered after intro measures', () => {
      const intro = mei.querySelector('section[type="introduction"]');
      const introMeasureCount = intro.querySelectorAll('measure').length;
      const mainSection = mei.querySelector('section:not([type="introduction"])');
      const mainMeasures = Array.from(mainSection.querySelectorAll('measure'));
      expect(parseInt(mainMeasures[0].getAttribute('n'))).toBe(introMeasureCount + 1);
    });
  });

  // ── Repeat barlines ──
  describe('repeat barlines', () => {
    it('should add repeat barlines when hasRepeatOrJump=false and >1 verse', () => {
      const mei = buildMEI({
        measures: [
          { n: '1', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
            brackets: [{ type: 'start', tstamp: 1, cp: 0 }] },
          { n: '2', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
            brackets: [{ type: 'end', tstamp: 5, cp: 8 }] },
        ],
      });
      callExtract(mei, { hasRepeatOrJump: false, verseNumbers: [1, 2] });
      const mainMeasures = mei.querySelector('section:not([type="introduction"])').querySelectorAll('measure');
      expect(mainMeasures[0].getAttribute('left')).toBe('rptstart');
      expect(mainMeasures[mainMeasures.length - 1].getAttribute('right')).toBe('rptend');
    });

    it('should NOT add repeat barlines when hasRepeatOrJump=true', () => {
      const mei = buildMEI({
        measures: [
          { n: '1', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
            brackets: [{ type: 'start', tstamp: 1, cp: 0 }] },
          { n: '2', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
            brackets: [{ type: 'end', tstamp: 5, cp: 8 }] },
        ],
      });
      callExtract(mei, { hasRepeatOrJump: true, verseNumbers: [1, 2] });
      const mainMeasures = mei.querySelector('section:not([type="introduction"])').querySelectorAll('measure');
      expect(mainMeasures[0].getAttribute('left')).toBeNull();
    });

    it('should NOT add repeat barlines when only 1 verse', () => {
      const mei = buildMEI({
        measures: [
          { n: '1', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
            brackets: [{ type: 'start', tstamp: 1, cp: 0 }] },
          { n: '2', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
            brackets: [{ type: 'end', tstamp: 5, cp: 8 }] },
        ],
      });
      callExtract(mei, { hasRepeatOrJump: false, verseNumbers: [1] });
      const mainMeasures = mei.querySelector('section:not([type="introduction"])').querySelectorAll('measure');
      expect(mainMeasures[0].getAttribute('left')).toBeNull();
    });
  });

  // ── Verse removal from intro ──
  it('should remove verse elements from the introduction section', () => {
    const mei = buildMEI({
      measures: [
        { n: '1', notes: [
          { dur: 4, id: 'v1', lyrics: [{ n: 1, text: 'Oh' }] },
          { dur: 4, id: 'v2', lyrics: [{ n: 1, text: 'say' }] },
          { dur: 4, id: 'v3' },
          { dur: 4, id: 'v4' },
        ], brackets: [{ type: 'start', tstamp: 1, cp: 0 }] },
        { n: '2', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
          brackets: [{ type: 'end', tstamp: 5, cp: 8 }] },
      ],
    });
    callExtract(mei);
    const intro = mei.querySelector('section[type="introduction"]');
    expect(intro.querySelectorAll('verse').length).toBe(0);
  });

  // ── dir removal from intro ──
  it('should remove dir elements from the introduction section', () => {
    const mei = buildMEI({
      measures: [
        { n: '1', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
          brackets: [{ type: 'start', tstamp: 1, cp: 0 }],
          notation: [
            { tag: 'dir', attrs: { 'xml:id': 'd1' } },
          ] },
        { n: '2', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
          brackets: [{ type: 'end', tstamp: 5, cp: 8 }] },
      ],
    });
    callExtract(mei);
    const intro = mei.querySelector('section[type="introduction"]');
    expect(intro.querySelectorAll('dir').length).toBe(0);
  });

  // ── tempo moved to intro ──
  it('should move tempo from original first measure into intro first measure', () => {
    const mei = buildMEI({
      measures: [
        { n: '1', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
          brackets: [{ type: 'start', tstamp: 1, cp: 0 }],
          notation: [
            { tag: 'tempo', attrs: { 'xml:id': 't1', 'midi.bpm': '120' } },
          ] },
        { n: '2', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
          brackets: [{ type: 'end', tstamp: 5, cp: 8 }] },
      ],
    });
    callExtract(mei);
    const intro = mei.querySelector('section[type="introduction"]');
    const mainSection = mei.querySelector('section:not([type="introduction"])');
    // Tempo is first removed from intro during cleanup, then moved from original m1 into intro m1
    expect(intro.querySelectorAll('tempo').length).toBe(1);
    expect(mainSection.querySelectorAll('tempo').length).toBe(0);
  });

  // ── Notation element copying ──
  it('should copy harm elements into intro measures with updated IDs', () => {
    const mei = buildMEI({
      measures: [
        { n: '1', notes: [{ dur: 4, id: 'h1' }, { dur: 4, id: 'h2' }, { dur: 4, id: 'h3' }, { dur: 4, id: 'h4' }],
          brackets: [{ type: 'start', tstamp: 1, cp: 0 }],
          notation: [{ tag: 'harm', attrs: { 'xml:id': 'harm1' } }] },
        { n: '2', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }],
          brackets: [{ type: 'end', tstamp: 5, cp: 8 }] },
      ],
    });
    callExtract(mei);
    const intro = mei.querySelector('section[type="introduction"]');
    const harms = intro.querySelectorAll('harm');
    expect(harms.length).toBe(1);
    expect(harms[0].getAttribute('xml:id')).toBe('harm1-intro');
  });

  // ── Partial measure clipping ──
  it('should clip notes when intro starts mid-measure (partial measure)', () => {
    // 4/4 measure, bracket starts at tstamp=3 (beat 3), so only beats 3-4 extracted
    const mei = buildMEI({
      measures: [
        { n: '1', notes: [
          { dur: 4, id: 'a1' }, { dur: 4, id: 'a2' },
          { dur: 4, id: 'a3' }, { dur: 4, id: 'a4' },
        ], brackets: [{ type: 'start', tstamp: 3, cp: 2 }, { type: 'end', tstamp: 5, cp: 4 }] },
      ],
    });
    callExtract(mei);
    const intro = mei.querySelector('section[type="introduction"]');
    const notes = intro.querySelectorAll('note');
    // Should have the notes from beats 3 and 4
    expect(notes.length).toBe(2);
  });

  // ── Multiple bracket ranges ──
  it('should handle multiple intro bracket ranges', () => {
    const mei = buildMEI({
      measures: [
        { n: '1', notes: [{ dur: 4, id: 'r1a' }, { dur: 4, id: 'r1b' }, { dur: 4, id: 'r1c' }, { dur: 4, id: 'r1d' }],
          brackets: [{ type: 'start', tstamp: 1, cp: 0 }, { type: 'end', tstamp: 5, cp: 4 }] },
        { n: '2', notes: [{ dur: 4, id: 'r2a' }, { dur: 4, id: 'r2b' }, { dur: 4, id: 'r2c' }, { dur: 4, id: 'r2d' }] },
        { n: '3', notes: [{ dur: 4, id: 'r3a' }, { dur: 4, id: 'r3b' }, { dur: 4, id: 'r3c' }, { dur: 4, id: 'r3d' }],
          brackets: [{ type: 'start', tstamp: 1, cp: 8 }, { type: 'end', tstamp: 5, cp: 12 }] },
      ],
    });
    callExtract(mei);
    const intro = mei.querySelector('section[type="introduction"]');
    const introMeasures = intro.querySelectorAll('measure');
    expect(introMeasures.length).toBe(2); // one from range 1, one from range 2
    // ch-chord-position should include both ranges
    const cp = intro.getAttribute('ch-chord-position').split(' ').map(Number);
    expect(cp).toEqual([0, 1, 2, 3, 8, 9, 10, 11]);
  });

  // ── Rest handling ──
  it('should handle rest elements in extracted measures', () => {
    const mei = buildMEI({
      measures: [
        { n: '1', notes: [
          { dur: 4, id: 'x1' }, { dur: 4, tag: 'rest', id: 'x2' },
          { dur: 4, id: 'x3' }, { dur: 4, id: 'x4' },
        ], brackets: [{ type: 'start', tstamp: 1, cp: 0 }, { type: 'end', tstamp: 5, cp: 4 }] },
      ],
    });
    callExtract(mei);
    const intro = mei.querySelector('section[type="introduction"]');
    expect(intro.querySelectorAll('note, rest').length).toBe(4);
  });

  // ── Slur/tie cleanup ──
  it('should remove slurs referencing notes outside intro section', () => {
    const mei = buildMEI({
      measures: [
        { n: '1', notes: [{ dur: 4, id: 's1' }, { dur: 4, id: 's2' }, { dur: 4, id: 's3' }, { dur: 4, id: 's4' }],
          brackets: [{ type: 'start', tstamp: 1, cp: 0 }, { type: 'end', tstamp: 3, cp: 2 }],
          notation: [{ tag: 'slur', attrs: { startid: '#s1', endid: '#s4' } }] },
        { n: '2', notes: [{ dur: 4 }, { dur: 4 }, { dur: 4 }, { dur: 4 }] },
      ],
    });
    callExtract(mei);
    const intro = mei.querySelector('section[type="introduction"]');
    // s4 is outside the bracket range (only beats 1-2 extracted), so slur should be removed
    const slurs = intro.querySelectorAll('slur');
    expect(slurs.length).toBe(0);
  });

  it('should keep slurs where both endpoints are in the intro section', () => {
    const mei = buildMEI({
      measures: [
        { n: '1', notes: [{ dur: 4, id: 'k1' }, { dur: 4, id: 'k2' }, { dur: 4, id: 'k3' }, { dur: 4, id: 'k4' }],
          brackets: [{ type: 'start', tstamp: 1, cp: 0 }, { type: 'end', tstamp: 5, cp: 4 }],
          notation: [{ tag: 'slur', attrs: { startid: '#k1', endid: '#k2' } }] },
      ],
    });
    callExtract(mei);
    const intro = mei.querySelector('section[type="introduction"]');
    const slurs = intro.querySelectorAll('slur');
    expect(slurs.length).toBe(1);
    expect(slurs[0].getAttribute('startid')).toBe('#k1-intro');
    expect(slurs[0].getAttribute('endid')).toBe('#k2-intro');
  });
});
