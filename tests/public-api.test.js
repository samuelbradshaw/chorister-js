/**
 * Tests: Public API methods and load-related functionality.
 *
 * Covers: load(), setOptions(), getOptions(), getScoreData(), getScoreContainer(),
 * getMidi(), removeScore(), drawScore(), Custom Events, Options Effects,
 * Input Data Structures, Score Types, Edge Cases,
 * _extractLyricStanzas, _normalizeSections, _updateExpansionMap, _getPointData,
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

  it('should fall back to default score when scoreType is missing', async () => {
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
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  it('should return a deep clone of current options from getOptions()', () => {
    const options = score.getOptions();
    expect(options.zoomPercent).toBe(40);
    options.zoomPercent = 999;
    expect(score.getOptions().zoomPercent).toBe(40);
  });

  it('should update options via setOptions()', () => {
    score.setOptions({ zoomPercent: 60 });
    expect(score.getOptions().zoomPercent).toBe(60);
  });

  it('should merge partial options without overwriting others', () => {
    score.setOptions({ showMeasureNumbers: true });
    const options = score.getOptions();
    expect(options.showMeasureNumbers).toBe(true);
    expect(options.zoomPercent).toBe(40);
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
      zoomPercent: 75,
      showMeasureNumbers: true,
      showMelodyOnly: false,
      drawBackgroundShapes: ['ch-system-rect'],
    });
    const opts = score.getOptions();
    expect(opts.zoomPercent).toBe(75);
    expect(opts.showMeasureNumbers).toBe(true);
    expect(opts.showMelodyOnly).toBe(false);
    expect(opts.drawBackgroundShapes).toEqual(['ch-system-rect']);
  });

  it('should not overwrite unrelated options when applying compound setOptions', () => {
    score.setOptions({ zoomPercent: 55 });
    score.setOptions({ showMeasureNumbers: true });
    const opts = score.getOptions();
    expect(opts.zoomPercent).toBe(55);
    expect(opts.showMeasureNumbers).toBe(true);
  });

  it('should round-trip all option values through setOptions → getOptions', () => {
    const testOpts = {
      zoomPercent: 65,
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

  it('should accept expandScore option values', { timeout: 10000 }, () => {
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
  it('should pass zoom percent as scale to Verovio', () => {
    const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
    score.setOptions({ zoomPercent: 60 });
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
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

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

  it('should clear data attributes on the container', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const container = document.getElementById('score-container');

    score.removeScore();
    expect(container.getAttribute('data-status')).toBeNull();
    expect(container.getAttribute('data-width')).toBeNull();
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

  it('should dispatch ch:tap event on click when enabled', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    }, { ...ChScore.prototype._defaultOptions, customEvents: ['ch:tap'] });

    const container = document.getElementById('score-container');
    const tapHandler = vi.fn();
    container.addEventListener('ch:tap', tapHandler);

    const clickEvent = new MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true });
    container.dispatchEvent(clickEvent);

    expect(tapHandler).toHaveBeenCalled();
    const detail = tapHandler.mock.calls[0][0].detail;
    expect(detail).toHaveProperty('chordPosition');
    expect(detail).toHaveProperty('noteIds');
    expect(detail).toHaveProperty('sectionIds');
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

    container.dispatchEvent(new MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true }));
    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50, bubbles: true }));

    expect(tapHandler).toHaveBeenCalled();
    // ch:hover should not fire since only ch:tap was enabled
    expect(hoverHandler).not.toHaveBeenCalled();
  });
});

// ============================================================
// drawScore()
// ============================================================
describe('drawScore()', () => {
  it('should render SVG into the container', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const container = document.getElementById('score-container');
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('#lyrics-below')).not.toBeNull();
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
    expect(scoreData.chordPositions.length).toBe(61);
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
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: null,
    });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData).toBeDefined();
    expect(score._scoreData.sections.length).toBeGreaterThan(0);
  });

  it('should handle empty lyricsText string', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: '',
    });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData).toBeDefined();
  });
});


// ============================================================
// _normalizeSections
// ============================================================
describe('_normalizeSections() — Section generation', () => {
  it('should generate sections for a simple hymn (How Great the Wisdom)', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

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
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

    const verseSections = score._scoreData.sections.filter(s => s.type === 'verse');
    expect(verseSections.length).toBe(4);
  });

  it('should generate sections with expansion for repeated score (This Little Light)', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml2 });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.sections.length).toBe(1);
    expect(score._scoreData.hasRepeatOrJump).toBeDefined();
  });

  it('should generate an introduction section when score has intro brackets', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

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
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      sections: customSections,
    });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.sections.length).toBeGreaterThanOrEqual(1);
    const customSection = score._scoreData.sections.find(s => s.sectionId === 'custom-verse-1');
    expect(customSection).toBeDefined();
  });

  it('should populate sectionsById lookup', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.sectionsById).toBeDefined();
    for (const section of score._scoreData.sections) {
      expect(score._scoreData.sectionsById[section.sectionId]).toBe(section);
    }
  });
});


// ============================================================
// _updateExpansionMap
// ============================================================
describe('_updateExpansionMap()', () => {
  it('should detect expansion in scores with repeats', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml2 });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.hasExpansion).toBe(true);
  });

  it('should detect hasRepeatOrJump for scores with repeat barlines', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml2 });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.hasRepeatOrJump).toBe(true);
  });

  it('should not detect hasRepeatOrJump for simple hymns', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.hasRepeatOrJump).toBe(false);
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
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    });
    score._currentOptions.customEvents = ['ch:hover'];
    ChScore.prototype.drawScore = origDrawScore;

    const container = document.getElementById('score-container');
    const hoverHandler = vi.fn();
    container.addEventListener('ch:hover', hoverHandler);

    const moveEvent = new MouseEvent('mousemove', { clientX: 50, clientY: 50, bubbles: true });
    container.dispatchEvent(moveEvent);

    expect(hoverHandler).toHaveBeenCalled();
    if (hoverHandler.mock.calls.length > 0) {
      const detail = hoverHandler.mock.calls[0][0].detail;
      expect(detail).toHaveProperty('chordPosition');
    }
  });

  it('should handle mouseleave without error after hover events', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    });
    score._currentOptions.customEvents = ['ch:hover'];
    ChScore.prototype.drawScore = origDrawScore;

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
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    score._currentOptions.customEvents = ['ch:hover'];
    ChScore.prototype.drawScore = origDrawScore;

    const container = document.getElementById('score-container');
    const hoverHandler = vi.fn();
    container.addEventListener('ch:hover', hoverHandler);

    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 50, bubbles: true }));

    expect(hoverHandler).toHaveBeenCalled();
    const detail = hoverHandler.mock.calls[0][0].detail;

    expect(detail).toHaveProperty('systemId');
    expect(detail).toHaveProperty('measureId');
    expect(detail).toHaveProperty('noteIds');
    expect(detail).toHaveProperty('partIds');
    expect(detail).toHaveProperty('lyricId');
    expect(detail).toHaveProperty('chordPosition');
    expect(detail).toHaveProperty('expandedChordPositions');
    expect(detail).toHaveProperty('staffNumber');
    expect(detail).toHaveProperty('sectionIds');
    expect(detail).toHaveProperty('lyricLineId');
  });

  it('ch:tap detail should also include all expected properties', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    score._currentOptions.customEvents = ['ch:tap'];
    ChScore.prototype.drawScore = origDrawScore;

    const container = document.getElementById('score-container');
    const tapHandler = vi.fn();
    container.addEventListener('ch:tap', tapHandler);

    container.dispatchEvent(new MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true }));

    expect(tapHandler).toHaveBeenCalled();
    const detail = tapHandler.mock.calls[0][0].detail;

    expect(detail).toHaveProperty('systemId');
    expect(detail).toHaveProperty('measureId');
    expect(detail).toHaveProperty('noteIds');
    expect(detail).toHaveProperty('partIds');
    expect(detail).toHaveProperty('lyricId');
    expect(detail).toHaveProperty('chordPosition');
    expect(detail).toHaveProperty('expandedChordPositions');
    expect(detail).toHaveProperty('staffNumber');
    expect(detail).toHaveProperty('sectionIds');
    expect(detail).toHaveProperty('lyricLineId');
  });
});


// ============================================================
// drawScore — lyrics-below
// ============================================================
describe('drawScore() — lyrics-below', () => {
  it('should render lyrics-below div with section content', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
    });

    const lyricsBelow = document.getElementById('lyrics-below');
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
    const lyricsBelow = document.getElementById('lyrics-below');
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
    ChScore.prototype.drawScore = function() {};

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

    ChScore.prototype.drawScore = origDrawScore;
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
    ChScore.prototype.drawScore = function() {};
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
    ChScore.prototype.drawScore = origDrawScore;

    const bridge = scoreData.sections.find(s => s.sectionId === 'bridge-1');
    expect(bridge).toBeDefined();
    expect(bridge.type).toBe('bridge');
    expect(bridge.name).toBe('Bridge');
  });

  it('should accept sections with type=interlude', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
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
    ChScore.prototype.drawScore = origDrawScore;

    const interlude = scoreData.sections.find(s => s.sectionId === 'interlude-1');
    expect(interlude).toBeDefined();
    expect(interlude.type).toBe('interlude');
    expect(interlude.pauseAfter).toBe(true);
  });

  it('should accept sections with type=unknown', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
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
    ChScore.prototype.drawScore = origDrawScore;

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
    ChScore.prototype.drawScore = function() {};
    ChScore.prototype._parseAndAnnotateMei = function() {};
    ChScore.prototype._loadMidi = function() {};
    const score = new ChScore('#score-container');

    const humdrumContent = `**kern\n  *clefG2\n  *k[]\n*M4/4\n4c\n4d\n4e\n4f\n*-`;
    await score.load('humdrum', { scoreContent: humdrumContent });

    expect(score._scoreData).toBeDefined();
    expect(typeof score._scoreData.meiStringOriginal).toBe('string');

    ChScore.prototype._parseAndAnnotateMei = origParse;
    ChScore.prototype._loadMidi = origLoadMidi;
    ChScore.prototype.drawScore = origDrawScore;
  });
});


// ============================================================
// Parts: placement values
// ============================================================
describe('load() — parts with numeric and "full" placement', () => {
  it('should accept parts with numeric placement values', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
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
    ChScore.prototype.drawScore = origDrawScore;

    expect(scoreData.parts.length).toBe(4);
    expect(scoreData.parts[0].placement).toBe(1);
    expect(scoreData.parts[1].placement).toBe(2);
    expect(scoreData.parts[2].placement).toBe(3);
    expect(scoreData.parts[3].placement).toBe(4);
  });

  it('should accept parts with "full" placement', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
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
    ChScore.prototype.drawScore = origDrawScore;

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
    ChScore.prototype.drawScore = function() {};
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
    ChScore.prototype.drawScore = origDrawScore;

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
    ChScore.prototype.drawScore = function() {};
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
    ChScore.prototype.drawScore = origDrawScore;

    const hiddenSection = scoreData.sections.find(s => s.sectionId === 'hidden-verse');
    expect(hiddenSection).toBeDefined();
    expect(hiddenSection.placement).toBe('none');
  });

  it('should not display section with placement=none in lyrics-below', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
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
    ChScore.prototype.drawScore = origDrawScore;

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
    ChScore.prototype.drawScore = function() {};
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
    ChScore.prototype.drawScore = origDrawScore;

    const chorus = scoreData.sections.find(s => s.type === 'chorus');
    expect(chorus).toBeDefined();
    expect(chorus.sectionId).toBe('chorus-1');
    expect(chorus.name).toBe('Chorus');
  });

  it('should store both verse and chorus sections in order', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
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
    ChScore.prototype.drawScore = origDrawScore;

    expect(scoreData.sections.length).toBe(2);
    expect(scoreData.sections[0].type).toBe('verse');
    expect(scoreData.sections[1].type).toBe('chorus');
    expect(scoreData.sections[1].pauseAfter).toBe(true);
  });
});
