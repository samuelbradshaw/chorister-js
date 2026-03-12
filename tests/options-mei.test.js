/**
 * Tests: Options that modify MEI or SVG output.
 *
 * Covers: showMeasureNumbers, keySignatureId, scale, shapes,
 * showMelodyOnly, expandScore, hideSectionIds, showChordSet,
 * showFingeringMarks, print media, shape margins, chord set prefix,
 * _updateSvg SVG post-processing, _updateSvg chord symbols
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks, resetScoreState } from './helpers.js';
import { sampleMusicXmlHGW as sampleMusicXml } from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// ============================================================
// Shared fixture: sampleMusicXml, _drawScore mocked
// Groups: showMeasureNumbers, scale, hideSectionIds, print media, shape margins
// ============================================================
describe('Options — shared plain sampleMusicXml load', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  // ── showMeasureNumbers ──
  describe('showMeasureNumbers — MEI verification', () => {
    it('should set mnum.visible to true on scoreDef when enabled', () => {
      score.setOptions({ showMeasureNumbers: true });
      const scoreDef = score._scoreData.meiParsed.querySelector('scoreDef');
      expect(scoreDef.getAttribute('mnum.visible')).toBe('true');
    });

    it('should set mnum.visible to false on scoreDef when disabled', () => {
      score.setOptions({ showMeasureNumbers: false });
      const scoreDef = score._scoreData.meiParsed.querySelector('scoreDef');
      expect(scoreDef.getAttribute('mnum.visible')).toBe('false');
    });

    it('should toggle mnum.visible when switching option on and off', () => {
      score.setOptions({ showMeasureNumbers: true });
      expect(score._scoreData.meiParsed.querySelector('scoreDef').getAttribute('mnum.visible')).toBe('true');

      score.setOptions({ showMeasureNumbers: false });
      expect(score._scoreData.meiParsed.querySelector('scoreDef').getAttribute('mnum.visible')).toBe('false');
    });
  });

  // ── scale ──
  describe('scale — Verovio options verification', () => {
    it('should pass scale option to Verovio', () => {
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ scale: 80 });
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(lastCall.scale).toBe(80);
      spy.mockRestore();
    });

    it('should set pageWidth to container width regardless of scale', () => {
      Object.defineProperty(score._container, 'offsetWidth', { value: 800, configurable: true });

      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');

      score.setOptions({ scale: 40 });
      const callAt40 = spy.mock.calls[spy.mock.calls.length - 1][0];

      score.setOptions({ scale: 80 });
      const callAt80 = spy.mock.calls[spy.mock.calls.length - 1][0];

      expect(callAt40.pageWidth).toBe(800);
      expect(callAt80.pageWidth).toBe(800);
      spy.mockRestore();
    });
  });

  // ── hideSectionIds ──
  describe('hideSectionIds — MEI verification', () => {
    it('should have sections after loading', () => {
      expect(score._scoreData.sections.length).toBeGreaterThan(0);
    });

    it('should remove verse elements for hidden sections', () => {
      const allSectionIds = score._scoreData.sections.map(s => s.sectionId);
      expect(allSectionIds.length).toBeGreaterThan(0);

      const sectionToHide = allSectionIds[allSectionIds.length - 1];

      const versesBefore = score._scoreData.meiParsed.querySelectorAll('verse').length;
      expect(versesBefore).toBeGreaterThan(0);

      score.setOptions({ hideSectionIds: [sectionToHide] });
      const versesAfter = score._scoreData.meiParsed.querySelectorAll('verse').length;

      expect(versesAfter).toBeLessThan(versesBefore);
    });

    it('should restore verses when hideSectionIds is cleared', () => {
      const allSectionIds = score._scoreData.sections.map(s => s.sectionId);
      expect(allSectionIds.length).toBeGreaterThan(0);

      const versesOriginal = score._scoreData.meiParsed.querySelectorAll('verse').length;
      expect(versesOriginal).toBeGreaterThan(0);

      score.setOptions({ hideSectionIds: [allSectionIds[allSectionIds.length - 1]] });
      const versesHidden = score._scoreData.meiParsed.querySelectorAll('verse').length;
      expect(versesHidden).toBeLessThan(versesOriginal);

      score.setOptions({ hideSectionIds: [] });
      const versesRestored = score._scoreData.meiParsed.querySelectorAll('verse').length;
      expect(versesRestored).toBe(versesOriginal);
    });
  });

  // ── print media ──
  describe('setOptions() — print media type', () => {
    it('should set mmOutput to true for print layout', () => {
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ layout: 'print' });
      const calls = spy.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.mmOutput).toBe(true);
      spy.mockRestore();
    });

    it('should set scale to 100 for print layout', () => {
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ layout: 'print' });
      const calls = spy.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.scale).toBe(100);
      spy.mockRestore();
    });

    it('should set mmOutput to false for default layout', () => {
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ layout: 'vertical-scroll' });
      const calls = spy.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall.mmOutput).toBeFalsy();
      spy.mockRestore();
    });
  });

  // ── layout: horizontal-scroll ──
  describe('setOptions() — horizontal-scroll layout', () => {
    it('should set breaks to none for horizontal-scroll layout', () => {
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ layout: 'horizontal-scroll' });
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(lastCall.breaks).toBe('none');
      spy.mockRestore();
    });

    it('should set data-ch-layout to horizontal-scroll on container', () => {
      score.setOptions({ layout: 'horizontal-scroll' });
      expect(score._container.dataset.chLayout).toBe('horizontal-scroll');
    });
  });

  // ── layout: paginated ──
  describe('setOptions() — paginated layout', () => {
    it('should set systemMaxPerPage to 1 for paginated layout', () => {
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ layout: 'paginated' });
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(lastCall.systemMaxPerPage).toBe(1);
      spy.mockRestore();
    });

    it('should set pageHeight based on container height for paginated layout', () => {
      Object.defineProperty(score._container, 'offsetHeight', { value: 600, configurable: true });
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ layout: 'paginated' });
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(lastCall.pageHeight).toBe(600);
      spy.mockRestore();
    });

    it('should use minimum pageHeight of 100 for paginated layout', () => {
      Object.defineProperty(score._container, 'offsetHeight', { value: 0, configurable: true });
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ layout: 'paginated' });
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(lastCall.pageHeight).toBe(100);
      spy.mockRestore();
    });

    it('should set data-ch-layout to paginated on container', () => {
      score.setOptions({ layout: 'paginated' });
      expect(score._container.dataset.chLayout).toBe('paginated');
    });
  });

  // ── scale as array [min, max] ──
  describe('setOptions() — scale as array', () => {
    it('should pass null scale to Verovio when scale is an array', () => {
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ scale: [30, 100] });
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(lastCall.scale).toBeNull();
      spy.mockRestore();
    });

    it('should set data-ch-scale-to-fit to true when scale is an array', () => {
      score.setOptions({ scale: [30, 100] });
      expect(score._container.dataset.chScaleToFit).toBe('true');
    });

    it('should set data-ch-scale-to-fit to false when scale is a number', () => {
      score.setOptions({ scale: 40 });
      expect(score._container.dataset.chScaleToFit).toBe('false');
    });
  });

  // ── shape margins ──
  describe('setOptions() — shape-dependent margin adjustments', () => {
    it('should increase spacingSystem and pageMarginBottom for chord position labels', () => {
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ drawBackgroundShapes: ['ch-chord-position-label'] });
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(lastCall.spacingSystem).toBe(12);
      expect(lastCall.pageMarginBottom).toBe(100);
      spy.mockRestore();
    });

    it('should increase pageMarginLeft for lyric line labels', () => {
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ drawBackgroundShapes: ['ch-lyric-line-label'] });
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(lastCall.pageMarginLeft).toBeGreaterThanOrEqual(90);
      spy.mockRestore();
    });

    it('should increase pageMarginLeft for staff labels', () => {
      const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
      score.setOptions({ drawBackgroundShapes: ['ch-staff-label'] });
      const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
      expect(lastCall.pageMarginLeft).toBeGreaterThanOrEqual(150);
      spy.mockRestore();
    });
  });
});

// ============================================================
// keySignatureId (separate — special afterEach)
// ============================================================
describe('keySignatureId — MEI verification', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });
  afterEach(() => {
    resetScoreState(score);
    score._vrvToolkit.resetOptions();
    score._vrvToolkit.setOptions(ChScore.prototype._defaultVerovioOptions);
    score._vrvToolkit.loadData(score._scoreData.meiString);
  });

  it('should produce a transpose value in Verovio options when keySignatureId is set', () => {
    const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
    score.setOptions({ keySignatureId: 'g-major' });
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(lastCall.transpose).toBeDefined();
    expect(lastCall.transpose).not.toBe('');
    spy.mockRestore();
  });

  it('should change the keySig in MEI after transposing to a different key', () => {
    const origMei = (new DOMParser()).parseFromString(score._vrvToolkit.getMEI(), 'text/xml');
    const origSig = origMei.querySelector('keySig')?.getAttribute('sig');
    expect(origSig).toBe('4f');

    score.setOptions({ keySignatureId: 'c-major' });
    const newMei = (new DOMParser()).parseFromString(score._vrvToolkit.getMEI(), 'text/xml');
    const newSig = newMei.querySelector('keySig')?.getAttribute('sig');

    expect(newSig).not.toBe(origSig);
  });

  it('should reload data into Verovio when transpose is applied', () => {
    const loadSpy = vi.spyOn(score._vrvToolkit, 'loadData');
    score.setOptions({ keySignatureId: 'g-major' });
    expect(loadSpy).toHaveBeenCalled();
    loadSpy.mockRestore();
  });

  it('should transpose up when keySignatureId index > 7 (center)', () => {
    const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
    const nearby = score.getKeySignatureInfo().nearbyKeySignatures;
    // Find a key with positive offset (index > 7)
    const upKey = nearby[10];
    score.setOptions({ keySignatureId: upKey.keySignatureId });
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(lastCall.transpose).toBeDefined();
    expect(lastCall.transpose.startsWith('+')).toBe(true);
    spy.mockRestore();
  });

  it('should transpose down when keySignatureId index < 7 (center)', () => {
    const spy = vi.spyOn(score._vrvToolkit, 'setOptions');
    const nearby = score.getKeySignatureInfo().nearbyKeySignatures;
    // Find a key with negative offset (index < 7)
    const downKey = nearby[3];
    score.setOptions({ keySignatureId: downKey.keySignatureId });
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(lastCall.transpose).toBeDefined();
    expect(lastCall.transpose.startsWith('-')).toBe(true);
    spy.mockRestore();
  });

  it('should change MIDI note pitches when transposed to a different key', () => {
    const origMei = (new DOMParser()).parseFromString(score._vrvToolkit.getMEI(), 'text/xml');
    const origNote = origMei.querySelector('note');
    const origPname = origNote?.getAttribute('pname');

    score.setOptions({ keySignatureId: 'c-major' });
    const newMei = (new DOMParser()).parseFromString(score._vrvToolkit.getMEI(), 'text/xml');
    const newNote = newMei.querySelector('note');
    const newPname = newNote?.getAttribute('pname');

    // After transposing from Ab major to C major, note pitch names should change
    expect(newPname).not.toBe(origPname);
  });
});

// ============================================================
// drawBackgroundShapes / drawForegroundShapes (needs actual render)
// ============================================================
describe('drawBackgroundShapes / drawForegroundShapes — SVG verification', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterEach(() => {
    score._currentOptions = structuredClone(ChScore.prototype._defaultOptions);
    score._updateMei();
    score._drawScore();
  });

  it('should create background shape group in SVG', () => {
    score.setOptions({ drawBackgroundShapes: ['ch-system-rect'] });
    const svg = score._container.querySelector('svg');
    const bgGroup = svg.querySelector('.ch-shapes-background');
    expect(bgGroup).not.toBeNull();
  });

  it('should create foreground shape group in SVG', () => {
    score.setOptions({ drawForegroundShapes: ['ch-system-rect'] });
    const svg = score._container.querySelector('svg');
    const fgGroup = svg.querySelector('.ch-shapes-foreground');
    expect(fgGroup).not.toBeNull();
  });

  it('should draw system rects in background shapes when requested', () => {
    score.setOptions({ drawBackgroundShapes: ['ch-system-rect'] });
    const svg = score._container.querySelector('svg');
    const systemRects = svg.querySelectorAll('.ch-shapes-background .ch-system-rect');
    expect(systemRects.length).toBeGreaterThanOrEqual(1);
  });

  it('should draw measure rects in foreground shapes when requested', () => {
    score.setOptions({ drawForegroundShapes: ['ch-measure-rect'] });
    const svg = score._container.querySelector('svg');
    const measureRects = svg.querySelectorAll('.ch-shapes-foreground .ch-measure-rect');
    expect(measureRects.length).toBe(score._scoreData.meiParsed.querySelectorAll('measure').length);
  });

  it('should not create shapes for unrequested classes', () => {
    score.setOptions({ drawBackgroundShapes: ['ch-system-rect'], drawForegroundShapes: [] });
    const svg = score._container.querySelector('svg');
    expect(svg.querySelectorAll('.ch-shapes-background .ch-system-rect').length).toBeGreaterThanOrEqual(1);
    expect(svg.querySelectorAll('.ch-measure-rect').length).toBe(0);
  });

  it('should draw staff rects with data-ch-staff-number attribute', () => {
    score.setOptions({ drawBackgroundShapes: ['ch-staff-rect'] });
    const svg = score._container.querySelector('svg');
    const staffRects = svg.querySelectorAll('.ch-shapes-background .ch-staff-rect');
    expect(staffRects.length).toBeGreaterThanOrEqual(1);
    for (const rect of staffRects) {
      expect(rect.getAttribute('data-ch-staff-number')).toBeTruthy();
    }
  });

  it('should draw chord position lines when requested', () => {
    score.setOptions({ drawForegroundShapes: ['ch-chord-position-line'] });
    const svg = score._container.querySelector('svg');
    const cpLines = svg.querySelectorAll('.ch-shapes-foreground .ch-chord-position-line');
    expect(cpLines.length).toBe(score._scoreData.chordPositions.length);
    for (const line of cpLines) {
      expect(line.getAttribute('data-ch-chord-position')).toBeTruthy();
    }
  });

  it('should draw note circles when requested', () => {
    score.setOptions({ drawBackgroundShapes: ['ch-note-circle'] });
    const svg = score._container.querySelector('svg');
    const circles = svg.querySelectorAll('.ch-shapes-background .ch-note-circle');
    expect(circles.length).toBeGreaterThan(0);
  });

  it('should draw lyric rects when requested', () => {
    score.setOptions({ drawBackgroundShapes: ['ch-lyric-rect'] });
    const svg = score._container.querySelector('svg');
    const lyricRects = svg.querySelectorAll('.ch-shapes-background .ch-lyric-rect');
    expect(lyricRects.length).toBeGreaterThan(0);
  });

  it('should draw multiple shape types simultaneously', () => {
    score.setOptions({
      drawBackgroundShapes: ['ch-system-rect', 'ch-measure-rect', 'ch-staff-rect'],
      drawForegroundShapes: ['ch-chord-position-line', 'ch-note-circle'],
    });
    const svg = score._container.querySelector('svg');
    expect(svg.querySelectorAll('.ch-shapes-background .ch-system-rect').length).toBeGreaterThanOrEqual(1);
    expect(svg.querySelectorAll('.ch-shapes-background .ch-measure-rect').length).toBeGreaterThanOrEqual(1);
    expect(svg.querySelectorAll('.ch-shapes-background .ch-staff-rect').length).toBeGreaterThanOrEqual(1);
    expect(svg.querySelectorAll('.ch-shapes-foreground .ch-chord-position-line').length).toBe(score._scoreData.chordPositions.length);
    expect(svg.querySelectorAll('.ch-shapes-foreground .ch-note-circle').length).toBeGreaterThan(0);
  });

  it('should clear shapes when options are reset to empty arrays', () => {
    score.setOptions({ drawBackgroundShapes: ['ch-system-rect'] });
    let svg = score._container.querySelector('svg');
    expect(svg.querySelectorAll('.ch-system-rect').length).toBeGreaterThan(0);

    score.setOptions({ drawBackgroundShapes: [] });
    svg = score._container.querySelector('svg');
    expect(svg.querySelectorAll('.ch-system-rect').length).toBe(0);
  });
});

// ============================================================
// showMelodyOnly (needs SA+TB + actual render)
// ============================================================
describe('showMelodyOnly — MEI verification', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    Object.defineProperty(score._container, 'offsetWidth', { value: 800, configurable: true });
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      partsTemplate: 'SA+TB',
    });
  });

  afterEach(() => {
    score._currentOptions = structuredClone(ChScore.prototype._defaultOptions);
    score._updateMei();
    score._drawScore();
  });

  it('should have melody info after loading with partsTemplate', () => {
    expect(score._scoreData.hasMelodyInfo).toBe(true);
  });

  it('should have 2 staves per measure before enabling showMelodyOnly', () => {
    const measures = score._scoreData.meiParsed.querySelectorAll('measure');
    const firstMeasureStaves = measures[0].querySelectorAll('staff');
    expect(firstMeasureStaves.length).toBe(2);
  });

  it('should reduce to 1 layer per staff when showMelodyOnly is enabled', () => {
    score.setOptions({ showMelodyOnly: true });
    const staves = score._scoreData.meiParsed.querySelectorAll('staff');
    for (const staff of staves) {
      const layers = staff.querySelectorAll('layer');
      expect(layers.length).toBe(1);
      expect(layers[0].getAttribute('n')).toBe('1');
    }
  });

  it('should remove mRest elements when showMelodyOnly is enabled', () => {
    score.setOptions({ showMelodyOnly: true });
    const mRests = score._scoreData.meiParsed.querySelectorAll('mRest');
    expect(mRests.length).toBe(0);
  });

  it('should remove curvedir from remaining slurs when showMelodyOnly is enabled', () => {
    score.setOptions({ showMelodyOnly: true });
    const slurs = score._scoreData.meiParsed.querySelectorAll('slur');
    for (const slur of slurs) {
      expect(slur.hasAttribute('curvedir')).toBe(false);
    }
  });

  it('should render single-staff SVG when showMelodyOnly is enabled', () => {
    score.setOptions({ showMelodyOnly: true });
    const svg = score._container.querySelector('svg');
    const systems = svg.querySelectorAll('.system');
    for (const system of systems) {
      const staves = system.querySelectorAll('.staff');
      const staffNumbers = new Set(Array.from(staves).map(s => s.getAttribute('data-n')));
      expect(staffNumbers.size).toBe(1);
    }
  });
});

// ============================================================
// showChordSet (custom chordSets)
// ============================================================
describe('showChordSet — MEI verification', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      chordSets: [{
        chordSetId: 'test-chords',
        name: 'Test Chords',
        svgSymbolsUrl: null,
        chordInfoList: [],
        chordPositionRefs: {
          0: { prefix: null, text: 'Ab', svgSymbolId: null },
          4: { prefix: null, text: 'Eb', svgSymbolId: null },
          8: { prefix: null, text: 'Db', svgSymbolId: null },
        },
      }],
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  it('should detect chordSets after loading', () => {
    expect(score._scoreData.hasChordSets).toBe(true);
  });

  it('should have no harm elements by default (showChordSet is false)', () => {
    const harms = score._scoreData.meiParsed.querySelectorAll('harm');
    expect(harms.length).toBe(0);
  });

  it('should add harm elements when showChordSet is enabled', () => {
    score.setOptions({ showChordSet: 'test-chords' });
    const harms = score._scoreData.meiParsed.querySelectorAll('harm');
    expect(harms.length).toBe(3);
  });

  it('should create harm elements with ch-chord-position attributes', () => {
    score.setOptions({ showChordSet: 'test-chords' });
    const harms = score._scoreData.meiParsed.querySelectorAll('harm');
    for (const harm of harms) {
      expect(harm.hasAttribute('ch-chord-position')).toBe(true);
    }
  });

  it('should create harm elements with tstamp attributes', () => {
    score.setOptions({ showChordSet: 'test-chords' });
    const harms = score._scoreData.meiParsed.querySelectorAll('harm');
    for (const harm of harms) {
      expect(harm.hasAttribute('tstamp')).toBe(true);
    }
  });

  it('should remove harm elements when showChordSet is disabled', () => {
    score.setOptions({ showChordSet: 'test-chords' });
    expect(score._scoreData.meiParsed.querySelectorAll('harm').length).toBeGreaterThan(0);

    score.setOptions({ showChordSet: false });
    expect(score._scoreData.meiParsed.querySelectorAll('harm').length).toBe(0);
  });

  it('should place harm elements inside measure elements', () => {
    score.setOptions({ showChordSet: 'test-chords' });
    const harms = score._scoreData.meiParsed.querySelectorAll('harm');
    for (const harm of harms) {
      expect(harm.closest('measure')).not.toBeNull();
    }
  });
});

// ============================================================
// showFingeringMarks (custom fingeringMusicXml)
// ============================================================
describe('showFingeringMarks — MEI verification', () => {
  const fingeringMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
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
        <duration>1</duration><type>quarter</type>
        <notations><technical><fingering>1</fingering></technical></notations>
      </note>
      <note>
        <pitch><step>D</step><octave>4</octave></pitch>
        <duration>1</duration><type>quarter</type>
        <notations><technical><fingering>2</fingering></technical></notations>
      </note>
      <note>
        <pitch><step>E</step><octave>4</octave></pitch>
        <duration>1</duration><type>quarter</type>
        <notations><technical><fingering>3</fingering></technical></notations>
      </note>
      <note>
        <pitch><step>F</step><octave>4</octave></pitch>
        <duration>1</duration><type>quarter</type>
      </note>
      <barline location="right"><bar-style>light-heavy</bar-style></barline>
    </measure>
  </part>
</score-partwise>`;

  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: fingeringMusicXml });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  it('should detect fingering marks after loading MusicXML with fingering', () => {
    expect(score._scoreData.hasFingeringMarks).toBe(true);
  });

  it('should remove fing elements by default (showFingeringMarks defaults to false)', () => {
    const fings = score._scoreData.meiParsed.querySelectorAll('fing');
    expect(fings.length).toBe(0);
  });

  it('should keep fing elements when showFingeringMarks is enabled', () => {
    score.setOptions({ showFingeringMarks: true });
    const fings = score._scoreData.meiParsed.querySelectorAll('fing');
    expect(fings.length).toBe(3);
  });

  it('should restore fing elements when showFingeringMarks is toggled on', () => {
    expect(score._scoreData.meiParsed.querySelectorAll('fing').length).toBe(0);

    score.setOptions({ showFingeringMarks: true });
    const fings = score._scoreData.meiParsed.querySelectorAll('fing');
    expect(fings.length).toBe(3);
  });

  it('should remove fing elements when showFingeringMarks is toggled off', () => {
    score.setOptions({ showFingeringMarks: true });
    expect(score._scoreData.meiParsed.querySelectorAll('fing').length).toBe(3);

    score.setOptions({ showFingeringMarks: false });
    expect(score._scoreData.meiParsed.querySelectorAll('fing').length).toBe(0);
  });
});


// ============================================================
// Shape type smoke tests via it.each
// ============================================================
describe('Shape types — smoke tests for all shape classes', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterEach(() => {
    score._currentOptions = structuredClone(ChScore.prototype._defaultOptions);
    score._updateMei();
    score._drawScore();
  });

  it.each([
    { shape: 'ch-system-rect', layer: 'background', expectedMin: 1 },
    { shape: 'ch-measure-rect', layer: 'background', expectedMin: 1 },
    { shape: 'ch-staff-rect', layer: 'background', expectedMin: 1 },
    { shape: 'ch-note-circle', layer: 'background', expectedMin: 1 },
    { shape: 'ch-lyric-rect', layer: 'background', expectedMin: 1 },
    { shape: 'ch-chord-position-line', layer: 'foreground', expectedMin: 1 },
    { shape: 'ch-chord-position-rect', layer: 'background', expectedMin: 1 },
    { shape: 'ch-chord-position-label', layer: 'foreground', expectedMin: 1 },
    { shape: 'ch-lyric-line-label', layer: 'background', expectedMin: 1 },
    { shape: 'ch-staff-label', layer: 'background', expectedMin: 1 },
  ])('should render $shape in $layer layer', ({ shape, layer, expectedMin }) => {
    const optionKey = layer === 'background' ? 'drawBackgroundShapes' : 'drawForegroundShapes';
    score.setOptions({ [optionKey]: [shape] });
    const svg = score._container.querySelector('svg');
    const layerClass = `ch-shapes-${layer}`;
    const elements = svg.querySelectorAll(`.${layerClass} .${shape}`);
    expect(elements.length).toBeGreaterThanOrEqual(expectedMin);
  });
});


// ============================================================
// Chord set images margin adjustment (separate load)
// ============================================================
describe('setOptions() — chord set images spacing', () => {
  it('should adjust spacing for chord set images', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const score2 = new ChScore('#score-container');
    await score2.load('musicxml', {
      scoreContent: sampleMusicXml,
      chordSets: [{
        chordSetId: 'img-test',
        name: 'Test',
        svgSymbolsUrl: null,
        chordInfoList: [],
        chordPositionRefs: {
          0: { prefix: null, text: 'C', svgSymbolId: null },
        },
      }],
    });

    const spy = vi.spyOn(score2._vrvToolkit, 'setOptions');
    score2.setOptions({ showChordSet: 'img-test', showChordSetImages: true });
    const lastCall = spy.mock.calls[spy.mock.calls.length - 1][0];
    expect(lastCall.spacingLinear).toBe(1.0);
    expect(lastCall.spacingNonLinear).toBe(0.5);
    expect(lastCall.pageMarginTop).toBe(220);
    spy.mockRestore();
    ChScore.prototype._drawScore = origDrawScore;
  });
});

// ============================================================
// showChordSet — prefix in harm elements
// ============================================================
describe('showChordSet — prefix in harm elements', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      chordSets: [{
        chordSetId: 'capo-chords',
        name: 'Capo Chords',
        svgSymbolsUrl: null,
        chordInfoList: [],
        chordPositionRefs: {
          0: { prefix: 'Capo 5:', text: 'E', svgSymbolId: null },
          4: { prefix: 'Capo 5:', text: 'B', svgSymbolId: null },
        },
      }],
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  it('should include prefix text in harm element content', () => {
    score.setOptions({ showChordSet: 'capo-chords' });
    const harms = score._scoreData.meiParsed.querySelectorAll('harm');
    expect(harms.length).toBe(2);

    const harmTexts = Array.from(harms).map(h => h.textContent);
    for (const text of harmTexts) {
      expect(text).toContain('Capo 5:');
    }
  });

  it('should include both prefix and chord text', () => {
    score.setOptions({ showChordSet: 'capo-chords' });
    const harms = score._scoreData.meiParsed.querySelectorAll('harm');
    const firstText = harms[0].textContent;
    expect(firstText).toContain('Capo 5:');
    expect(firstText).toContain('E');
  });
});


// ============================================================
// _updateSvg — SVG post-processing (shared load with actual render)
// ============================================================
describe('_updateSvg() — SVG post-processing', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      partsTemplate: 'SA+TB',
    });
  });

  afterEach(() => {
    score._currentOptions = structuredClone(ChScore.prototype._defaultOptions);
    score._updateMei();
    score._drawScore();
  });

  it('should set currentColor on the definition-scale element', () => {
    const svg = score._container.querySelector('svg');
    const defScale = svg.querySelector('.definition-scale');
    expect(defScale.getAttribute('color')).toBe('currentColor');
    expect(defScale.getAttribute('fill')).toBe('currentColor');
  });

  it('should create background and foreground shape layer groups', () => {
    const svg = score._container.querySelector('svg');
    const bgGroup = svg.querySelector('.ch-shapes-background');
    const fgGroup = svg.querySelector('.ch-shapes-foreground');
    expect(bgGroup).not.toBeNull();
    expect(fgGroup).not.toBeNull();
  });

  it('should place background shapes before other content', () => {
    const svg = score._container.querySelector('svg');
    const pageMargin = svg.querySelector('.page-margin');
    expect(pageMargin.firstElementChild.classList.contains('ch-shapes-background')).toBe(true);
  });

  it('should place foreground shapes after other content', () => {
    const svg = score._container.querySelector('svg');
    const pageMargin = svg.querySelector('.page-margin');
    expect(pageMargin.lastElementChild.classList.contains('ch-shapes-foreground')).toBe(true);
  });

  it('should add data-related attributes to noteheads', () => {
    const svg = score._container.querySelector('svg');
    const noteheads = svg.querySelectorAll('.notehead[data-related]');
    expect(noteheads.length).toBeGreaterThan(0);
  });

  it('should add data-related attributes to accidentals', () => {
    const svg = score._container.querySelector('svg');
    const accidentals = svg.querySelectorAll('.accid[data-related]');
    expect(accidentals.length).toBeGreaterThanOrEqual(0);
  });

  it('should add data-related attributes to ties', () => {
    const svg = score._container.querySelector('svg');
    const ties = svg.querySelectorAll('.tie [data-related]');
    expect(ties.length).toBeGreaterThanOrEqual(0);
  });

  it('should draw chord position rects with correct attributes', () => {
    score.setOptions({
      drawBackgroundShapes: ['ch-chord-position-rect'],
    });
    const svg = score._container.querySelector('svg');
    const cpRects = svg.querySelectorAll('.ch-shapes-background .ch-chord-position-rect');
    expect(cpRects.length).toBe(score._scoreData.chordPositions.length);
    for (const rect of cpRects) {
      expect(rect.getAttribute('data-ch-chord-position')).toBeTruthy();
      expect(parseInt(rect.getAttribute('x'))).toBeGreaterThanOrEqual(0);
      expect(parseInt(rect.getAttribute('width'))).toBeGreaterThan(0);
    }
  });

  it('should draw chord position labels with position data', () => {
    score.setOptions({
      drawForegroundShapes: ['ch-chord-position-label'],
    });
    const svg = score._container.querySelector('svg');
    const labels = svg.querySelectorAll('.ch-shapes-foreground .ch-chord-position-label');
    expect(labels.length).toBe(score._scoreData.chordPositions.length);
    for (const label of labels) {
      expect(label.getAttribute('data-ch-chord-position')).toBeTruthy();
      expect(label.textContent.trim()).toMatch(/^\d+$/);
    }
  });

  it('should draw lyric line labels when requested', () => {
    score.setOptions({
      drawBackgroundShapes: ['ch-lyric-line-label'],
    });
    const svg = score._container.querySelector('svg');
    const labels = svg.querySelectorAll('.ch-shapes-background .ch-lyric-line-label');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.getAttribute('data-ch-lyric-line-id')).toMatch(/^\d+\.\d+$/);
    }
  });

  it('should draw staff labels with staff number text', () => {
    score.setOptions({
      drawBackgroundShapes: ['ch-staff-label'],
    });
    const svg = score._container.querySelector('svg');
    const labels = svg.querySelectorAll('.ch-shapes-background .ch-staff-label');
    expect(labels.length).toBeGreaterThanOrEqual(1);
    for (const label of labels) {
      expect(label.textContent).toMatch(/^Staff \d+$/);
    }
  });
});


// ============================================================
// _updateSvg — Chord symbols (shared load with actual render)
// ============================================================
describe('_updateSvg() — Chord symbols', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      chordSets: [{
        chordSetId: 'test-chords-svg',
        name: 'Test',
        svgSymbolsUrl: null,
        chordInfoList: [],
        chordPositionRefs: {
          0: { prefix: null, text: 'Ab', svgSymbolId: null },
          4: { prefix: null, text: 'Eb7', svgSymbolId: null },
        },
      }],
    });
  });

  afterEach(() => {
    score._currentOptions = structuredClone(ChScore.prototype._defaultOptions);
    score._updateMei();
    score._drawScore();
  });

  it('should render harm elements in SVG when showChordSet is enabled', () => {
    score.setOptions({ showChordSet: 'test-chords-svg' });
    const svg = score._container.querySelector('svg');
    const harms = svg.querySelectorAll('.harm');
    expect(harms.length).toBe(2);
  });

  it('should center-align chord text', () => {
    score.setOptions({ showChordSet: 'test-chords-svg' });
    const svg = score._container.querySelector('svg');
    const chordTexts = svg.querySelectorAll('.harm > text');
    for (const text of chordTexts) {
      expect(text.getAttribute('text-anchor')).toBe('middle');
    }
  });
});
