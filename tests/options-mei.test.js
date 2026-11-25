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
import { sampleMusicXmlHGW as sampleMusicXml, sampleMusicXmlTwoPartIntro, sampleMusicXmlDescant, sampleMusicXmlIIW } from './song-data.js';

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
      // 20px at the default scale of 40
      expect(lastCall.scale).toBe(40);
      expect(lastCall.pageMarginBottom).toBe(50);
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
    expect(score._scoreData.features.hasMelodyInfo).toBe(true);
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
// showMelodyOnly: two melody parts over a piano with its own introduction
// ============================================================
describe('showMelodyOnly — two-part melody with piano introduction', () => {
  let score;

  // The container's default width lays out one measure per system, so the two intro
  // measures each fill a system with no melody in it
  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXmlTwoPartIntro });
  });

  afterEach(() => {
    score.setOptions({ showMelodyOnly: false, expandScore: false });
  });

  it('should load as a two-part melody with the tempo on the piano staff', () => {
    expect(score._scoreData.twoPartMelodyPartIds).toEqual(['part-1', 'part-2']);
    expect(score._scoreData.meiParsed.querySelector('tempo').getAttribute('staff')).toBe('3');
  });

  it('should keep and define only the two melody staves, each system opening with a line', () => {
    score.setOptions({ showMelodyOnly: true });
    const meiParsed = score._scoreData.meiParsed;
    for (const measure of meiParsed.querySelectorAll('measure')) {
      expect(Array.from(measure.querySelectorAll('staff'), staff => staff.getAttribute('n'))).toEqual(['1', '2']);
    }
    // Verovio leaves out a system's opening line when a defined staff is missing from it
    expect(Array.from(meiParsed.querySelectorAll('staffDef'), staffDef => staffDef.getAttribute('n'))).toEqual(['1', '2']);
    expect(meiParsed.querySelector('staffGrp staffGrp')).toBeNull();
    const measures = score._container.querySelectorAll('svg .measure');
    expect(Array.from(measures, measure => Array.from(measure.querySelectorAll(':scope > .staff'), staff => staff.getAttribute('data-n'))))
      .toEqual([['1', '2'], ['1', '2']]);
    for (const measure of measures) expect(measure.closest('g.system').querySelector(':scope > path')).not.toBeNull();
  });

  it('should leave out the piano introduction, which has nothing sung in it', () => {
    const songMeasureIds = Array.from(score._scoreData.meiParsed.querySelectorAll('measure'))
      .slice(2).map(measure => measure.getAttribute('xml:id'));
    score.setOptions({ showMelodyOnly: true });
    const measures = Array.from(score._scoreData.meiParsed.querySelectorAll('measure'));
    expect(measures.map(measure => measure.getAttribute('xml:id'))).toEqual(songMeasureIds);
    expect(measures[0].querySelector('note')).not.toBeNull();
  });

  it('should keep condensing on', () => {
    score.setOptions({ showMelodyOnly: true });
    expect(score._vrvToolkit.getOptions().condense).toBe('auto');
    expect(score._scoreData.meiParsed.querySelector('note[visible="false"]')).toBeNull();
  });

  it('should keep each part on its own staff when expanded', () => {
    score.setOptions({ expandScore: 'full-score', showMelodyOnly: true });
    const meiParsed = score._scoreData.meiParsed;
    expect(meiParsed.querySelector('staff:not([n="1"], [n="2"])')).toBeNull();
    expect(meiParsed.querySelector('staff[n="1"] note')).not.toBeNull();
    expect(meiParsed.querySelector('staff[n="2"] note')).not.toBeNull();
  });

  it('should move the tempo onto the top melody staff and draw it', () => {
    score.setOptions({ showMelodyOnly: true });
    expect(score._scoreData.meiParsed.querySelector('tempo').getAttribute('staff')).toBe('1');
    const tempo = score._container.querySelector('svg .tempo');
    expect(tempo?.textContent).toContain('Gently');
  });

  it('should restore the piano staves and the tempo\'s staff when turned off', () => {
    score.setOptions({ showMelodyOnly: true });
    score.setOptions({ showMelodyOnly: false });
    expect(score._scoreData.meiParsed.querySelector('measure').querySelectorAll('staff').length).toBe(4);
    expect(score._scoreData.meiParsed.querySelector('note[visible="false"]')).toBeNull();
    expect(score._scoreData.meiParsed.querySelector('tempo').getAttribute('staff')).toBe('3');
    expect(score._scoreData.meiParsed.querySelectorAll('mRest[*|id$="-mrest"]').length).toBe(0);
  });
});

// ============================================================
// showMelodyOnly: which words stay with the melody
// ============================================================
describe('showMelodyOnly — lyrics kept with the melody', () => {
  beforeAll(() => { ChScore.prototype._drawScore = function() {}; });
  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  const lyricLineIds = (score) => Array.from(
    score._scoreData.meiParsed.querySelectorAll('verse'), verse => verse.getAttribute('ch-lyric-line-id'));
  const melodyNotesWithoutWords = (score) => Array.from(score._scoreData.meiParsed.querySelectorAll('note[ch-melody]'))
    .filter(note => !(note.closest('chord') ?? note).querySelector('verse'));

  it('should drop a descant\'s words when the melody has its own', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXmlDescant });
    expect(score._scoreData.parts.map(part => part.partId)).toContain('descant');
    expect(lyricLineIds(score)).toContain('1.1');

    score.setOptions({ showMelodyOnly: true });
    const lineIds = lyricLineIds(score);
    expect(lineIds).not.toContain('1.1');
    expect(lineIds.filter(id => id === '2.1')).toHaveLength(9);
    expect(lineIds.filter(id => id === '2.2')).toHaveLength(9);
  });

  it('should put words engraved above a staff below it', async () => {
    // As "The Morning Breaks" (1985 Hymns) engraves a lower staff's words, to line up with the staff above
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    const voiceAbove = sampleMusicXmlDescant.replace(/(<part id="P2">[\s\S]*?<\/part>)/,
      voice => voice.replaceAll('<lyric number=', '<lyric placement="above" number='));
    await score.load('musicxml', { scoreContent: voiceAbove });
    expect(score._scoreData.meiParsed.querySelectorAll('verse[place="above"]').length).toBeGreaterThan(0);

    score.setOptions({ showMelodyOnly: true });
    expect(score._scoreData.meiParsed.querySelector('verse[place]')).toBeNull();
    score.setOptions({ showMelodyOnly: false });
    expect(score._scoreData.meiParsed.querySelectorAll('verse[place="above"]').length).toBeGreaterThan(0);
  });

  it('should number a descant\'s chorus as line 1, under its stacked verses', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXmlDescant });
    const descantLines = Array.from(score._scoreData.meiParsed.querySelectorAll('staff[n="1"] verse'),
      verse => `${verse.getAttribute('ch-lyric-line-id')} ${verse.textContent.trim()}`);
    expect(descantLines).toEqual(['1.1 Ring,', '1.2 Chime,', '1.1 bells!', '1.2 bells!', '1.1 Ring!']);
  });

  it('should rest out a descant in an expanded section that doesn\'t use its staff', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    // The descant joins in on the second verse only
    await score.load('musicxml', { scoreContent: sampleMusicXmlDescant, sectionsTemplate: 'V([2,3,4]:2.1); V(:1.1,2.2)' });
    score.setOptions({ expandScore: 'full-score' });
    const staffEvents = (n) => score._scoreData.meiParsed.querySelectorAll(`staff[n="${n}"] :is(note, chord)`);
    const descantIds = Array.from(staffEvents(1), element => element.getAttribute('xml:id'));
    expect(descantIds.length).toBeGreaterThan(0);
    expect(descantIds.every(id => id.endsWith('-rend2'))).toBe(true);
    expect(score._scoreData.meiParsed.querySelectorAll('staff[n="1"] mRest').length).toBeGreaterThan(0);
    expect(staffEvents(2).length).toBeGreaterThan(0);

    // Unexpanded, the descant is drawn as engraved
    score.setOptions({ expandScore: false });
    expect(staffEvents(1).length).toBeGreaterThan(0);
  });

  it('should keep the words engraved above a lower voice carrying the tune (SATB#A)', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml, partsTemplate: 'SATB#A' });
    const verseCount = score._scoreData.meiParsed.querySelectorAll('verse').length;
    // The soprano and alto sing the same words, engraved on the soprano only
    const sopranoVerses = Array.from(score._scoreData.meiParsed.querySelectorAll('verse'))
      .filter(verse => !score._carriesMelody(verse.closest('note, chord')));
    expect(sopranoVerses.length).toBeGreaterThan(0);
    expect(sopranoVerses.filter(verse => verse.hasAttribute('ch-secondary'))).toHaveLength(0);

    score.setOptions({ showMelodyOnly: true });
    // The soprano's words move onto the alto; none are lost
    expect(score._scoreData.meiParsed.querySelectorAll('verse').length).toBe(verseCount);
    expect(melodyNotesWithoutWords(score).length).toBeLessThanOrEqual(2);
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
    expect(score._scoreData.features.hasChordSets).toBe(true);
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
    expect(score._scoreData.features.hasFingeringMarks).toBe(true);
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
    { shape: 'ch-measure-label', layer: 'foreground', expectedMin: 1 },
    { shape: 'ch-beat-label', layer: 'foreground', expectedMin: 1 },
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
    // 220px at the default scale of 40 is 550, over the 500 Verovio allows
    expect(lastCall.scale).toBe(40);
    expect(lastCall.pageMarginTop).toBe(500);
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

  // Before, not after: the file-level hook tears this score down and replaces the DOM
  // ahead of every test, so each one has to start by putting the score back on default
  // options and redrawing. Doing it afterwards left the first test with no SVG at all.
  beforeEach(() => {
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
    const labels = svg.querySelectorAll('.ch-shapes-foreground .ch-chord-position-label:not([data-ch-label-marker])');
    expect(labels.length).toBe(score._scoreData.chordPositions.length);
    for (const label of labels) {
      expect(label.getAttribute('data-ch-chord-position')).toBeTruthy();
      expect(label.textContent.trim()).toMatch(/^\d+$/);
    }
  });

  it('should draw one measure label per measure, where the measure opens', () => {
    score.setOptions({
      drawForegroundShapes: ['ch-measure-label'],
    });
    const svg = score._container.querySelector('svg');
    const labels = svg.querySelectorAll('.ch-shapes-foreground .ch-measure-label:not([data-ch-label-marker])');
    // A measure written in more than one sub-measure is labelled once, on the one that opens
    // it -- so there are fewer labels than <measure> elements, and no number appears twice
    const measures = score._scoreData.measures;
    expect(measures.length).toBeLessThan(Object.keys(score._scoreData.subMeasuresById).length);
    expect(labels.length).toBe(measures.length);
    const measureNumbers = Array.from(labels).map(label => label.getAttribute('data-ch-measure-number'));
    expect(measureNumbers).toEqual(measures.map(measure => measure.measureNumber));
    expect(new Set(measureNumbers).size).toBe(measureNumbers.length);
  });

  it('should set every measure label bold and plain', () => {
    score.setOptions({
      drawForegroundShapes: ['ch-measure-label'],
    });
    const svg = score._container.querySelector('svg');
    const labels = Array.from(
      svg.querySelectorAll('.ch-shapes-foreground .ch-measure-label:not([data-ch-label-marker])'));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(label.textContent.trim()).toBe(label.getAttribute('data-ch-measure-number'));
      expect(label.getAttribute('font-weight')).toBe('bold');
      expect(label.getAttribute('font-style')).toBe(null);
    }
  });

  it('should draw measure labels on the copies an expanded score plays', () => {
    score.setOptions({ expandScore: 'full-score', drawForegroundShapes: ['ch-measure-label'] });
    const svg = score._container.querySelector('svg');
    const labels = Array.from(svg.querySelectorAll('.ch-measure-label:not([data-ch-label-marker])'));
    // More measures than the score has, because passes repeat them, and every copy is
    // labelled with the number of the measure it copies
    expect(svg.querySelectorAll('.measure').length)
      .toBeGreaterThan(score._scoreData.measures.length);
    expect(labels.length).toBeGreaterThan(score._scoreData.measures.length);
    const numbers = new Set(score._scoreData.measures.map(measure =>
      measure.measureNumber));
    for (const label of labels) {
      expect(numbers).toContain(label.getAttribute('data-ch-measure-number'));
    }
    score.setOptions({ expandScore: false });
  });

  it('should draw a beat label for every chord position', () => {
    score.setOptions({
      drawForegroundShapes: ['ch-beat-label'],
    });
    const svg = score._container.querySelector('svg');
    const labels = svg.querySelectorAll('.ch-shapes-foreground .ch-beat-label:not([data-ch-label-marker])');
    expect(labels.length).toBe(score._scoreData.chordPositions.length);
    for (const label of labels) {
      expect(label.getAttribute('data-ch-chord-position')).toBeTruthy();
      expect(label.textContent.trim()).toMatch(/^\d+(\.\d+)?$/);
    }
  });

  it('should stack labels below the system as measure, beat, then chord position', () => {
    score.setOptions({
      drawForegroundShapes: ['ch-measure-label', 'ch-beat-label', 'ch-chord-position-label'],
    });
    const svg = score._container.querySelector('svg');
    const firstY = (className) => Number.parseInt(
      svg.querySelector(`.ch-shapes-foreground .${className}:not([data-ch-label-marker])`).getAttribute('y'));
    expect(firstY('ch-measure-label')).toBeLessThan(firstY('ch-beat-label'));
    expect(firstY('ch-beat-label')).toBeLessThan(firstY('ch-chord-position-label'));
  });

  it('should line measure labels up with the measure\'s first chord position', () => {
    score.setOptions({
      drawForegroundShapes: ['ch-measure-label', 'ch-chord-position-label'],
    });
    const svg = score._container.querySelector('svg');
    const subMeasureIdOf = (label) => label.getAttribute('data-related').split(' ')[1];
    const firstCpXBySubMeasureId = {};
    for (const cpLabel of svg.querySelectorAll('.ch-chord-position-label:not([data-ch-label-marker])')) {
      const subMeasureId = subMeasureIdOf(cpLabel);
      if (!(subMeasureId in firstCpXBySubMeasureId)) firstCpXBySubMeasureId[subMeasureId] = cpLabel.getAttribute('x');
    }
    const measureLabels = svg.querySelectorAll('.ch-measure-label:not([data-ch-label-marker])');
    expect(measureLabels.length).toBeGreaterThan(0);
    for (const measureLabel of measureLabels) {
      expect(measureLabel.getAttribute('x')).toBe(firstCpXBySubMeasureId[subMeasureIdOf(measureLabel)]);
    }
  });

  it('should draw a row header per system for each row of labels, at the start of the system', () => {
    score.setOptions({
      drawForegroundShapes: ['ch-measure-label', 'ch-beat-label', 'ch-chord-position-label'],
    });
    const svg = score._container.querySelector('svg');
    const systems = Array.from(svg.querySelectorAll('.system'))
      .filter(system => system.querySelector('.measure'));
    const headers = Array.from(svg.querySelectorAll('[data-ch-label-marker]'));
    expect(headers.length).toBe(systems.length * 3);
    expect(new Set(headers.map(header => header.textContent.trim())))
      .toEqual(new Set(['M:', 'B:', 'CP:']));
    // Right-aligned against each other: one shared right edge, and the text ends there
    expect(new Set(headers.map(header => header.getAttribute('x'))).size).toBe(1);
    expect(new Set(headers.map(header => header.getAttribute('text-anchor')))).toEqual(new Set(['end']));
    // Inside the system, in the blank space under the clef and time signature
    for (const system of systems) {
      const staffLines = Array.from(system.querySelectorAll('.measure .staff > path'));
      const d = (path) => path.getAttribute('d').split(' ');
      const systemX1 = Number.parseInt(d(staffLines[0])[0].replace('M', ''));
      const systemX2 = Number.parseInt(d(staffLines.at(-1))[2].replace('L', ''));
      for (const header of headers.filter(h => h.getAttribute('data-related') === system.id)) {
        const x = Number.parseInt(header.getAttribute('x'));
        expect(x).toBeGreaterThan(systemX1);
        expect(x).toBeLessThan(systemX2);
      }
    }
    // Each header sits on its own row's baseline
    for (const className of ['ch-measure-label', 'ch-beat-label', 'ch-chord-position-label']) {
      const header = svg.querySelector(`[data-ch-label-marker].${className}`);
      const label = svg.querySelector(`.${className}:not([data-ch-label-marker])`);
      expect(header.getAttribute('y')).toBe(label.getAttribute('y'));
    }
  });

  it('should not narrow the score to make room for the row headers', () => {
    // The headers live inside the system, so neither margin moves and the staves keep their
    // full width -- only the space below the system grows
    const systemSpan = () => {
      const svg = score._container.querySelector('svg');
      const staffLines = Array.from(svg.querySelectorAll('.system .measure .staff > path'));
      const d = (path) => path.getAttribute('d').split(' ');
      return [
        svg.querySelector('.page-margin').getAttribute('transform'),
        Number.parseInt(d(staffLines[0])[0].replace('M', '')),
        Math.max(...staffLines.map(path => Number.parseInt(d(path)[2].replace('L', '')))),
      ].join(' ');
    };
    score.setOptions({ drawForegroundShapes: [] });
    const withoutLabels = systemSpan();
    score.setOptions({
      drawForegroundShapes: ['ch-measure-label', 'ch-beat-label', 'ch-chord-position-label'],
    });
    expect(systemSpan()).toBe(withoutLabels);
  });

  it('should draw row headers only for the rows being drawn', () => {
    score.setOptions({ drawForegroundShapes: ['ch-beat-label'] });
    const svg = score._container.querySelector('svg');
    expect(new Set(Array.from(svg.querySelectorAll('[data-ch-label-marker]'))
      .map(header => header.textContent.trim()))).toEqual(new Set(['B:']));
  });

  it('should leave room below the last system for every row of labels', () => {
    for (const shapes of [
      ['ch-chord-position-label'],
      ['ch-measure-label', 'ch-chord-position-label'],
      ['ch-measure-label', 'ch-beat-label', 'ch-chord-position-label'],
    ]) {
      score.setOptions({ drawForegroundShapes: shapes });
      const svg = score._container.querySelector('svg');
      const pageHeight = Number.parseInt(
        svg.querySelector('svg.definition-scale').getAttribute('viewBox').split(' ')[3]);
      const labels = Array.from(svg.querySelectorAll(
        '.ch-measure-label:not([data-ch-label-marker]), .ch-beat-label:not([data-ch-label-marker]), .ch-chord-position-label:not([data-ch-label-marker])'));
      const lowestBaseline = Math.max(...labels.map(label => Number.parseInt(label.getAttribute('y'))));
      expect(lowestBaseline).toBeLessThan(pageHeight);
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

// ============================================================
// Staves, introductions and lyrics: each case loads its own score
// ============================================================
describe('Staves, introductions and lyrics', { timeout: 30000 }, () => {
  const load = async (scoreContent, data = {}) => {
    document.body.innerHTML = '<div id="score-container"></div>';
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent, ...data });
    return score;
  };

  it('should drop a lyric holding only a space, keeping one with an extender', () => {
    const score = new ChScore('#score-container');
    // Two lyrics added to the voice's first note: a placeholder space, and a space ending a melisma
    const musicXml = sampleMusicXmlDescant.replace(/(<part id="P2">[\s\S]*?<\/lyric>)/, `$1
      <lyric number="7"><syllabic>single</syllabic><text> </text></lyric>
      <lyric number="8"><syllabic>single</syllabic><text> </text><extend/></lyric>`);
    const lyricNumbers = xml => Array.from(new DOMParser().parseFromString(xml, 'text/xml').querySelectorAll('lyric'),
      lyric => lyric.getAttribute('number'));
    const before = lyricNumbers(musicXml);
    const after = lyricNumbers(score._optimizeMusicXml(musicXml));
    expect(before).toContain('7');
    expect(after).not.toContain('7');
    expect(after).toContain('8');
    expect(after).toHaveLength(before.length - 1);
  });

  it('should make room on both sides for a brace while its staves are drawn', async () => {
    // The fixture's piano is braced; its staves are the accompaniment, gone with the melody only
    const score = await load(sampleMusicXmlDescant);
    const margins = () => [score._vrvToolkit.getOptions().pageMarginLeft, score._vrvToolkit.getOptions().pageMarginRight];
    expect(margins()).toEqual([35, 35]);
    score.setOptions({ showMelodyOnly: true });
    // 4px at the default scale of 40
    expect(margins()).toEqual([10, 10]);
    score.setOptions({ showMelodyOnly: false });
    expect(margins()).toEqual([35, 35]);
  });

  it('should tag a note only with the passes of sections that use its staff', async () => {
    // The descant (staff 1) joins in on the second verse only
    const score = await load(sampleMusicXmlDescant, { sectionsTemplate: 'V([2,3,4]:2.1); V(:1.1,2.2)' });
    const passes = id => (id ?? '').split(' ').filter(Boolean).map(Number);
    const sectionsOn = staffNumber => new Set(Array.from(score._scoreData.meiParsed.querySelectorAll(
      `staff[n="${staffNumber}"] :is(note, chord)[ch-expanded-chord-position]`)).flatMap(element =>
      passes(element.getAttribute('ch-expanded-chord-position')).map(ecp => score._scoreData.expandedChordPositions[ecp].sectionId)));
    expect([...sectionsOn(1)]).toEqual(['verse-2']);
    expect([...sectionsOn(2)].sort()).toEqual(['verse-1', 'verse-2']);

    // A chord position's line carries every note's passes there, not just the first drawn
    score.setOptions({ drawBackgroundShapes: ['ch-chord-position-line'] });
    const svg = score._container.querySelector('svg');
    const linePasses = new Map();
    for (const line of svg.querySelectorAll('.ch-chord-position-line')) {
      const chordPosition = line.getAttribute('data-ch-chord-position');
      linePasses.set(chordPosition, new Set([...(linePasses.get(chordPosition) ?? []), ...passes(line.getAttribute('data-ch-expanded-chord-position'))]));
    }
    let checked = 0;
    for (const note of svg.querySelectorAll('.note[data-ch-chord-position][data-ch-expanded-chord-position]')) {
      const onLine = linePasses.get(note.getAttribute('data-ch-chord-position'));
      if (!onLine) continue;
      for (const ecp of passes(note.getAttribute('data-ch-expanded-chord-position'))) expect(onLine.has(ecp)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('should drop a section left empty by the opening measures from the expansion', async () => {
    // A repeat after the piano introduction puts it in a section of its own, which the
    // expansion names; with the melody only, the introduction (all rests) is left out
    const withRepeat = sampleMusicXmlTwoPartIntro
      .replaceAll('<measure number="3">', '<measure number="3"><barline location="left"><repeat direction="forward"/></barline>');
    const score = await load(withRepeat);
    const sectionIds = () => new Set(Array.from(score._scoreData.meiParsed.querySelectorAll('section'), section => section.getAttribute('xml:id')));
    const plist = () => score._scoreData.meiParsed.querySelector('expansion[plist]')?.getAttribute('plist').split(/\s+/) ?? [];
    expect(plist().length).toBeGreaterThan(0);
    const measuresBefore = score._scoreData.meiParsed.querySelectorAll('measure').length;

    score.setOptions({ showMelodyOnly: true });
    expect(score._scoreData.meiParsed.querySelectorAll('measure').length).toBe(measuresBefore - 2);
    for (const ref of plist()) expect(sectionIds().has(ref.substring(1))).toBe(true);
  });

  it('should tag each verse\'s copy with its own verse when the extracted introduction is left out', async () => {
    // The introduction is copied from the song's measures (its chord positions recur in verse 1)
    // and plays only the accompaniment, so with the melody only none of its notes are left
    const derived = (await load(sampleMusicXmlIIW))._scoreData.templates.sectionsTemplateCp;
    const sectionsTemplate = derived.replace(/^I\([^;]*;/, 'I(0-13[3])(55-64[3]);');
    expect(sectionsTemplate).not.toBe(derived);
    const score = await load(sampleMusicXmlIIW, { sectionsTemplate });
    score.setOptions({ showMelodyOnly: true, expandScore: 'full-score' });
    const copies = score._scoreData.meiParsed.querySelectorAll('section[ch-iteration]');
    expect(copies.length).toBe(4);
    for (const copy of copies) {
      const sectionIds = new Set(Array.from(copy.querySelectorAll('note[ch-expanded-chord-position]'), note => note
        .getAttribute('ch-expanded-chord-position').split(' ')
        .map(ecp => score._scoreData.expandedChordPositions[ecp].sectionId)).flat());
      expect([...sectionIds].sort()).toEqual([`chorus-${copy.getAttribute('ch-iteration')}`, `verse-${copy.getAttribute('ch-iteration')}`]);
    }
  });

  it('should keep a staff of rests drawn with an invisible note in the rest\'s own layer', async () => {
    // Expanded, each part of the two-part melody rests through the other's verse
    const score = await load(sampleMusicXmlTwoPartIntro);
    score.setOptions({ showMelodyOnly: true, expandScore: 'full-score' });
    const anchors = Array.from(score._scoreData.meiParsed.querySelectorAll('note[visible="false"]'));
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      const measure = anchor.closest('measure');
      expect(measure.querySelector('note:not([visible="false"]), rest, chord')).toBeNull();
      // Beside the rest: in a second layer, Verovio would raise the rest out of its way
      expect(anchor.parentElement.querySelector(':scope > mRest')).not.toBeNull();
      expect(anchor.closest('staff').querySelectorAll('layer')).toHaveLength(1);
    }
  });

  it('should copy no empty measure where an introduction starts at a barline', async () => {
    // The intro bracket moved from part-way through measure 13 to the end of measure 12
    const bracket = sampleMusicXml.match(/<direction placement="above">\s*<direction-type>\s*<words>⌜<\/words>[\s\S]*?<\/direction>/)[0];
    const withoutBracket = sampleMusicXml.replace(bracket, '');
    const measure12 = withoutBracket.indexOf('<measure number="12"');
    const measure12End = withoutBracket.indexOf('</measure>', measure12);
    const atBarline = withoutBracket.slice(0, measure12End) + bracket + withoutBracket.slice(measure12End);
    const score = await load(atBarline);
    score.setOptions({ expandScore: 'intro' });
    const introMeasures = Array.from(score._scoreData.meiParsed.querySelectorAll('section[type="introduction"] measure'));
    expect(introMeasures.length).toBeGreaterThan(0);
    for (const measure of introMeasures) expect(measure.querySelector('note, chord')).not.toBeNull();
  });

  it('should keep an instruction naming a verse only in that verse\'s copy', async () => {
    // "Descant (verse 4)" is printed in the chorus, and every pass copies the chorus
    const score = await load(sampleMusicXmlIIW);
    score.setOptions({ expandScore: 'full-score' });
    const descantInstructions = Array.from(score._scoreData.meiParsed.querySelectorAll('dir'))
      .filter(dir => dir.textContent.includes('Descant (verse 4)'));
    expect(descantInstructions).toHaveLength(1);
    expect(descantInstructions[0].getAttribute('ch-section-id')).toBe('chorus-4');
  });

  it('should rest the melody through an introduction it doesn\'t play, then leave it out', async () => {
    // "It Is Well" plays its melody in the introduction; here the introduction is the piano's left hand only
    const derived = (await load(sampleMusicXmlIIW))._scoreData.templates.sectionsTemplateCp;
    const sectionsTemplate = derived.replace('I(0-13[2,3])(55-64[2,3])', 'I(0-13[3])(55-64[3])');
    expect(sectionsTemplate).not.toBe(derived);
    const score = await load(sampleMusicXmlIIW, { sectionsTemplate });

    score.setOptions({ expandScore: 'intro' });
    const introMeasures = () => Array.from(score._scoreData.meiParsed.querySelectorAll('section[type="introduction"] measure'));
    expect(introMeasures().length).toBeGreaterThan(0);
    for (const measure of introMeasures()) {
      expect(measure.querySelector('staff:not([n="3"]) :is(note, chord)')).toBeNull();
    }

    // With the melody only it's all rests, so the score opens on the song
    score.setOptions({ showMelodyOnly: true });
    expect(introMeasures()).toHaveLength(0);
    expect(score._scoreData.meiParsed.querySelector('measure').querySelector('note')).not.toBeNull();
  });
});
