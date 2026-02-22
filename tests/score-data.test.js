/**
 * Tests: scoreData properties — measures, notesAndRestsById, keySignatureInfo,
 * scalar properties, chordPositions, expandedChordPositions, midiNoteSequence,
 * getKeySignatureInfo public method.
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import './setup.js';
import {
  initChScore, setupStandardHooks, resetScoreState,
  sampleMusicXml, sampleMusicXml2,
} from './helpers.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// ============================================================
// Expanded chord positions (individual loads)
// ============================================================
describe('Expanded chord positions', () => {
  it('should generate expandedChordPositions array after loading', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.expandedChordPositions).toBeDefined();
    expect(score._scoreData.expandedChordPositions.length).toBe(156);
  });

  it('should have expandedChordPositions with sectionId references', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.expandedChordPositions.length).toBe(156);
    for (const ecp of score._scoreData.expandedChordPositions) {
      expect(ecp.sectionId).toBeDefined();
      expect(score._scoreData.sectionsById[ecp.sectionId]).toBeDefined();
    }
  });

  it('should have more expanded chord positions than chord positions for multi-verse hymns', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

    // How Great the Wisdom has 6 verses + intro, so expanded > chord positions
    expect(score._scoreData.expandedChordPositions.length).toBe(156);
    expect(score._scoreData.chordPositions.length).toBe(37);
  });

  it('should have audibleExpandedChordPositions subset', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.audibleExpandedChordPositions).toBeDefined();
    expect(score._scoreData.audibleExpandedChordPositions.length).toBe(156);
    expect(score._scoreData.expandedChordPositions.length).toBe(156);
  });
});


// ============================================================
// Shared 2-score fixture for remaining describes
// ============================================================
describe('scoreData — shared HGW + TLL fixture', () => {
  let hgwScore, tllScore;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="s1"></div><div id="s2"></div>';
    ChScore.prototype.drawScore = function() {};

    hgwScore = new ChScore('#s1');
    await hgwScore.load('musicxml', { scoreContent: sampleMusicXml });

    tllScore = new ChScore('#s2');
    await tllScore.load('musicxml', { scoreContent: sampleMusicXml2 });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

  // ── measures ──
  describe('scoreData.measures', () => {
    it('HGW should have 16 measures', () => {
      expect(hgwScore._scoreData.measures.length).toBe(16);
    });

    it('TLL should have 15 measures', () => {
      expect(tllScore._scoreData.measures.length).toBe(15);
    });

    it('measuresById should match measures length (HGW)', () => {
      expect(Object.keys(hgwScore._scoreData.measuresById).length).toBe(16);
    });

    it('measuresById should match measures length (TLL)', () => {
      expect(Object.keys(tllScore._scoreData.measuresById).length).toBe(15);
    });

    it('each measure should have all expected properties', () => {
      const expectedKeys = [
        'durationQ', 'endQ', 'firstChordPosition', 'isFirstMeasure',
        'isLastMeasure', 'measureId', 'measureType', 'rightBarLine',
        'startQ', 'systemNumber', 'timeSignature',
      ];
      for (const m of hgwScore._scoreData.measures) {
        for (const key of expectedKeys) {
          expect(m).toHaveProperty(key);
        }
      }
    });

    it('HGW first measure should be partial-pickup in 3/4', () => {
      const m = hgwScore._scoreData.measures[0];
      expect(m.measureType).toBe('partial-pickup');
      expect(m.timeSignature).toEqual([3, 4]);
      expect(m.isFirstMeasure).toBe(true);
      expect(m.isLastMeasure).toBe(false);
      expect(m.rightBarLine).toBe('single');
      expect(m.startQ).toBe(0);
      expect(m.endQ).toBe(1);
      expect(m.durationQ).toBe(1);
      expect(m.firstChordPosition).toBe(0);
    });

    it('HGW last measure should be partial-pickdown ending', () => {
      const m = hgwScore._scoreData.measures[15];
      expect(m.measureType).toBe('partial-pickdown');
      expect(m.isFirstMeasure).toBe(false);
      expect(m.isLastMeasure).toBe(true);
      expect(m.rightBarLine).toBe('end');
      expect(m.startQ).toBe(40);
      expect(m.endQ).toBe(42);
      expect(m.durationQ).toBe(2);
      expect(m.firstChordPosition).toBe(36);
    });

    it('TLL first measure should be full in 4/4', () => {
      const m = tllScore._scoreData.measures[0];
      expect(m.measureType).toBe('full');
      expect(m.timeSignature).toEqual([4, 4]);
      expect(m.isFirstMeasure).toBe(true);
      expect(m.isLastMeasure).toBe(false);
      expect(m.startQ).toBe(0);
      expect(m.endQ).toBe(4);
      expect(m.durationQ).toBe(4);
      expect(m.firstChordPosition).toBe(0);
    });

    it('TLL last measure should end with rightBarLine=end', () => {
      const m = tllScore._scoreData.measures[14];
      expect(m.isLastMeasure).toBe(true);
      expect(m.rightBarLine).toBe('end');
      expect(m.startQ).toBe(56);
      expect(m.endQ).toBe(60);
      expect(m.durationQ).toBe(4);
      expect(m.firstChordPosition).toBe(59);
    });

    it('measuresById should map every measureId correctly', () => {
      for (const m of hgwScore._scoreData.measures) {
        expect(hgwScore._scoreData.measuresById[m.measureId]).toBe(m);
      }
    });

    it('measure startQ/endQ should form contiguous sequence (HGW)', () => {
      const measures = hgwScore._scoreData.measures;
      for (let i = 1; i < measures.length; i++) {
        expect(measures[i].startQ).toBe(measures[i - 1].endQ);
      }
    });

    it('exactly one measure should be first and one last (HGW)', () => {
      const firsts = hgwScore._scoreData.measures.filter(m => m.isFirstMeasure);
      const lasts = hgwScore._scoreData.measures.filter(m => m.isLastMeasure);
      expect(firsts.length).toBe(1);
      expect(lasts.length).toBe(1);
    });
  });

  // ── notesAndRestsById ──
  describe('scoreData.notesAndRestsById', () => {
    it('HGW should have 128 notes/rests', () => {
      expect(Object.keys(hgwScore._scoreData.notesAndRestsById).length).toBe(128);
    });

    it('TLL should have 109 notes/rests', () => {
      expect(Object.keys(tllScore._scoreData.notesAndRestsById).length).toBe(109);
    });

    it('each entry should have all expected properties', () => {
      const expectedKeys = [
        'chordPosition', 'durationQ', 'elementId', 'endQ',
        'expandedChordPositions', 'isAudible', 'isCue', 'isGrace',
        'isMelody', 'isRest', 'isTiedNote', 'layerNumber',
        'lyricSyllables', 'meiElement', 'meiMeasureElement',
        'partIds', 'pitch', 'staffNumber', 'startQ', 'tiedNoteId',
      ];
      const entries = Object.values(hgwScore._scoreData.notesAndRestsById);
      for (const nr of entries.slice(0, 10)) {
        for (const key of expectedKeys) {
          expect(nr).toHaveProperty(key);
        }
      }
    });

    it('HGW first note should have pitch 63 on staff 1', () => {
      const entries = Object.values(hgwScore._scoreData.notesAndRestsById);
      const firstNote = entries[0];
      expect(firstNote.pitch).toBe(63);
      expect(firstNote.staffNumber).toBe(1);
      expect(firstNote.layerNumber).toBe(1);
      expect(firstNote.isRest).toBe(false);
      expect(firstNote.isCue).toBe(false);
      expect(firstNote.isGrace).toBe(false);
      expect(firstNote.isAudible).toBe(true);
      expect(firstNote.startQ).toBe(0);
      expect(firstNote.endQ).toBe(1);
      expect(firstNote.durationQ).toBe(1);
      expect(firstNote.chordPosition).toBe(0);
    });

    it('HGW first note should have 4 lyric syllables', () => {
      const entries = Object.values(hgwScore._scoreData.notesAndRestsById);
      const firstNote = entries[0];
      expect(firstNote.lyricSyllables).toEqual(['How', 'His', 'By', 'He']);
    });

    it('every elementId key should match the entry elementId', () => {
      for (const [key, entry] of Object.entries(hgwScore._scoreData.notesAndRestsById)) {
        expect(entry.elementId).toBe(key);
      }
    });

    it('all notes should reference valid chord positions', () => {
      const maxCp = hgwScore._scoreData.chordPositions.length - 1;
      for (const entry of Object.values(hgwScore._scoreData.notesAndRestsById)) {
        expect(entry.chordPosition).toBeGreaterThanOrEqual(0);
        expect(entry.chordPosition).toBeLessThanOrEqual(maxCp);
      }
    });

    it('staffNumber should be 1 or 2 for all HGW entries', () => {
      for (const entry of Object.values(hgwScore._scoreData.notesAndRestsById)) {
        expect([1, 2]).toContain(entry.staffNumber);
      }
    });
  });

  // ── keySignatureInfo ──
  describe('scoreData.keySignatureInfo', () => {
    it('HGW should be in A-flat major', () => {
      const ksi = hgwScore._scoreData.keySignatureInfo;
      expect(ksi.keySignatureId).toBe('a-flat-major');
      expect(ksi.tonality).toBe('major');
      expect(ksi.name).toBe('A♭ major');
      expect(ksi.mxlFifths).toBe('-4');
      expect(ksi.meiSig).toBe('4f');
      expect(ksi.meiPnameAccid).toBe('af');
      expect(ksi.midiPitch).toBe(56);
    });

    it('TLL should be in C major', () => {
      const ksi = tllScore._scoreData.keySignatureInfo;
      expect(ksi.keySignatureId).toBe('c-major');
      expect(ksi.tonality).toBe('major');
      expect(ksi.name).toBe('C major');
      expect(ksi.mxlFifths).toBe('0');
      expect(ksi.meiSig).toBe('0');
      expect(ksi.meiPnameAccid).toBe('c');
      expect(ksi.midiPitch).toBe(60);
    });

    it('HGW nearbyKeySignatures should have 15 entries', () => {
      expect(hgwScore._scoreData.keySignatureInfo.nearbyKeySignatures.length).toBe(15);
    });

    it('TLL nearbyKeySignatures should have 15 entries', () => {
      expect(tllScore._scoreData.keySignatureInfo.nearbyKeySignatures.length).toBe(15);
    });

    it('nearbyKeySignatures should be sorted by midiPitchOffset', () => {
      const nearby = hgwScore._scoreData.keySignatureInfo.nearbyKeySignatures;
      for (let i = 1; i < nearby.length; i++) {
        expect(nearby[i].midiPitchOffset).toBeGreaterThanOrEqual(nearby[i - 1].midiPitchOffset);
      }
    });

    it('HGW self should appear at offset 0 in nearbyKeySignatures', () => {
      const nearby = hgwScore._scoreData.keySignatureInfo.nearbyKeySignatures;
      const self = nearby.find(k => k.midiPitchOffset === 0);
      expect(self).toBeDefined();
      expect(self.keySignatureId).toBe('a-flat-major');
    });

    it('each nearbyKeySignature should have required properties', () => {
      const expectedKeys = [
        'keySignatureId', 'midiPitchOffset', 'mxlFifths', 'meiSig',
        'meiPnameAccid', 'midiPitch', 'tonality', 'name',
      ];
      for (const k of hgwScore._scoreData.keySignatureInfo.nearbyKeySignatures) {
        for (const key of expectedKeys) {
          expect(k).toHaveProperty(key);
        }
      }
    });
  });

  // ── scalar properties ──
  describe('scoreData scalar properties', () => {
    it('HGW staffNumbers should be [1, 2]', () => {
      expect(hgwScore._scoreData.staffNumbers).toEqual([1, 2]);
    });

    it('TLL staffNumbers should be [1, 2]', () => {
      expect(tllScore._scoreData.staffNumbers).toEqual([1, 2]);
    });

    it('HGW hasLyrics should be true', () => {
      expect(hgwScore._scoreData.hasLyrics).toBe(true);
    });

    it('TLL hasLyrics should be true', () => {
      expect(tllScore._scoreData.hasLyrics).toBe(true);
    });

    it('HGW numChordPositions should be 37', () => {
      expect(hgwScore._scoreData.numChordPositions).toBe(37);
    });

    it('TLL numChordPositions should be 61', () => {
      expect(tllScore._scoreData.numChordPositions).toBe(61);
    });

    it('numChordPositions should match chordPositions.length', () => {
      expect(hgwScore._scoreData.numChordPositions).toBe(hgwScore._scoreData.chordPositions.length);
      expect(tllScore._scoreData.numChordPositions).toBe(tllScore._scoreData.chordPositions.length);
    });

    it('HGW hasRepeatOrJump should be false', () => {
      expect(hgwScore._scoreData.hasRepeatOrJump).toBe(false);
    });

    it('TLL hasRepeatOrJump should be true', () => {
      expect(tllScore._scoreData.hasRepeatOrJump).toBe(true);
    });
  });

  // ── chordPositions ──
  describe('scoreData.chordPositions internal structure', () => {
    it('each CP should have all expected properties', () => {
      const expectedKeys = [
        'chordPosition', 'durationQ', 'endQ', 'expandedChordPositions',
        'isAudible', 'isDownbeat', 'isSingleLine', 'measureId',
        'melodyNote', 'midiDuration', 'midiEndTime', 'midiNotesByPitch',
        'midiQpm', 'midiStartTime', 'notesAndRests', 'startQ',
      ];
      for (const cp of hgwScore._scoreData.chordPositions) {
        for (const key of expectedKeys) {
          expect(cp).toHaveProperty(key);
        }
      }
    });

    it('HGW CP[0] should have correct timing values', () => {
      const cp = hgwScore._scoreData.chordPositions[0];
      expect(cp.chordPosition).toBe(0);
      expect(cp.startQ).toBe(0);
      expect(cp.endQ).toBe(1);
      expect(cp.durationQ).toBe(1);
      expect(cp.isAudible).toBe(true);
      expect(cp.isDownbeat).toBe(false);
    });

    it('HGW CP[0] should have 4 notesAndRests', () => {
      const cp = hgwScore._scoreData.chordPositions[0];
      expect(cp.notesAndRests.length).toBe(4);
    });

    it('HGW CP[0] melodyNote should have pitch 63', () => {
      const cp = hgwScore._scoreData.chordPositions[0];
      expect(cp.melodyNote).not.toBeNull();
      expect(cp.melodyNote.pitch).toBe(63);
      expect(cp.melodyNote.isMelody).toBe(true);
      expect(cp.melodyNote.lyricSyllables).toEqual(['How', 'His', 'By', 'He']);
    });

    it('HGW CP[0] expandedChordPositions should map to 4 verses', () => {
      const cp = hgwScore._scoreData.chordPositions[0];
      expect(cp.expandedChordPositions).toEqual({
        'verse-1': [8], 'verse-2': [45], 'verse-3': [82], 'verse-4': [119],
      });
    });

    it('HGW CP[18] (midpoint) should be a downbeat at startQ=19', () => {
      const cp = hgwScore._scoreData.chordPositions[18];
      expect(cp.chordPosition).toBe(18);
      expect(cp.startQ).toBe(19);
      expect(cp.endQ).toBe(21);
      expect(cp.durationQ).toBe(2);
      expect(cp.isDownbeat).toBe(true);
    });

    it('HGW last CP should be at chordPosition 36', () => {
      const cp = hgwScore._scoreData.chordPositions[36];
      expect(cp.chordPosition).toBe(36);
      expect(cp.startQ).toBe(40);
      expect(cp.endQ).toBe(42);
      expect(cp.durationQ).toBe(2);
      expect(cp.isDownbeat).toBe(true);
      expect(cp.isAudible).toBe(true);
    });

    it('HGW last CP expandedChordPositions should include introduction', () => {
      const cp = hgwScore._scoreData.chordPositions[36];
      expect(cp.expandedChordPositions).toEqual({
        'introduction': [7], 'verse-1': [44], 'verse-2': [81],
        'verse-3': [118], 'verse-4': [155],
      });
    });

    it('TLL CP[0] should have 2 notesAndRests and pitch 67 melody', () => {
      const cp = tllScore._scoreData.chordPositions[0];
      expect(cp.notesAndRests.length).toBe(2);
      expect(cp.melodyNote.pitch).toBe(67);
      expect(cp.startQ).toBe(0);
      expect(cp.endQ).toBe(1);
      expect(cp.isDownbeat).toBe(true);
    });

    it('TLL last CP should be a single line (1 note)', () => {
      const cp = tllScore._scoreData.chordPositions[60];
      expect(cp.notesAndRests.length).toBe(1);
      expect(cp.isSingleLine).toBe(true);
      expect(cp.melodyNote).toBeNull();
      expect(cp.startQ).toBe(58);
      expect(cp.endQ).toBe(60);
    });

    it('chordPosition index should match array index (HGW)', () => {
      for (let i = 0; i < hgwScore._scoreData.chordPositions.length; i++) {
        expect(hgwScore._scoreData.chordPositions[i].chordPosition).toBe(i);
      }
    });

    it('every CP measureId should exist in measuresById (HGW)', () => {
      for (const cp of hgwScore._scoreData.chordPositions) {
        expect(hgwScore._scoreData.measuresById[cp.measureId]).toBeDefined();
      }
    });

    it('startQ/endQ should form non-overlapping sequence (HGW)', () => {
      const cps = hgwScore._scoreData.chordPositions;
      for (let i = 1; i < cps.length; i++) {
        expect(cps[i].startQ).toBeGreaterThanOrEqual(cps[i - 1].startQ);
      }
    });
  });

  // ── midiNoteSequence ──
  describe('scoreData.midiNoteSequence', () => {
    it('HGW midiNoteSequence should have 4 notes (mock Magenta)', () => {
      expect(hgwScore._scoreData.midiNoteSequence.notes.length).toBe(4);
    });

    it('TLL midiNoteSequence should have 4 notes (mock Magenta)', () => {
      expect(tllScore._scoreData.midiNoteSequence.notes.length).toBe(4);
    });

    it('HGW midiNoteSequence.totalTime should be 2', () => {
      expect(hgwScore._scoreData.midiNoteSequence.totalTime).toBe(2);
    });

    it('TLL midiNoteSequence.totalTime should be 2', () => {
      expect(tllScore._scoreData.midiNoteSequence.totalTime).toBe(2);
    });

    it('tempos should have one entry at time=0 with qpm=120', () => {
      expect(hgwScore._scoreData.midiNoteSequence.tempos).toEqual([{ time: 0, qpm: 120 }]);
    });

    it('midiNoteSequence should have expected top-level keys', () => {
      const keys = Object.keys(hgwScore._scoreData.midiNoteSequence).sort();
      expect(keys).toEqual(['notes', 'tempos', 'totalQuantizedSteps', 'totalTime']);
    });

    it('midiType should be verovio for default load', () => {
      expect(hgwScore._scoreData.midiType).toBe('verovio');
    });
  });

  // ── getKeySignatureInfo public ──
  describe('getKeySignatureInfo() — public method', () => {
    it('should return the same object as scoreData.keySignatureInfo', () => {
      expect(hgwScore.getKeySignatureInfo()).toBe(hgwScore._scoreData.keySignatureInfo);
    });

    it('HGW should return A-flat major via public method', () => {
      const ksi = hgwScore.getKeySignatureInfo();
      expect(ksi.keySignatureId).toBe('a-flat-major');
      expect(ksi.name).toBe('A♭ major');
    });

    it('TLL should return C major via public method', () => {
      const ksi = tllScore.getKeySignatureInfo();
      expect(ksi.keySignatureId).toBe('c-major');
      expect(ksi.name).toBe('C major');
    });
  });

  // ── nearbyKeySignatures centering ──
  describe('nearbyKeySignatures — centering and offsets', () => {
    it('HGW self key (A♭ major) should appear at index 7 (center) of nearbyKeySignatures', () => {
      const nearby = hgwScore._scoreData.keySignatureInfo.nearbyKeySignatures;
      expect(nearby[7].keySignatureId).toBe('a-flat-major');
      expect(nearby[7].midiPitchOffset).toBe(0);
    });

    it('TLL self key (C major) should appear at index 7 (center) of nearbyKeySignatures', () => {
      const nearby = tllScore._scoreData.keySignatureInfo.nearbyKeySignatures;
      expect(nearby[7].keySignatureId).toBe('c-major');
      expect(nearby[7].midiPitchOffset).toBe(0);
    });

    it('nearbyKeySignatures offsets should span negative through positive around center', () => {
      const nearby = hgwScore._scoreData.keySignatureInfo.nearbyKeySignatures;
      expect(nearby[0].midiPitchOffset).toBeLessThan(0);
      expect(nearby[14].midiPitchOffset).toBeGreaterThan(0);
    });

    it('each nearbyKeySignature should have a unique keySignatureId', () => {
      const nearby = hgwScore._scoreData.keySignatureInfo.nearbyKeySignatures;
      const ids = nearby.map(k => k.keySignatureId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});


// ============================================================
// data-ch-expanded-chord-position on SVG shapes
// ============================================================
describe('data-ch-expanded-chord-position — SVG shapes', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterEach(() => {
    score._currentOptions = structuredClone(ChScore.prototype._defaultOptions);
    score._updateMei();
    score.drawScore();
  });

  it('should set data-ch-expanded-chord-position on note circles', () => {
    score.setOptions({ drawBackgroundShapes: ['ch-note-circle'] });
    const svg = score._container.querySelector('svg');
    const circles = svg.querySelectorAll('.ch-note-circle[data-ch-expanded-chord-position]');
    expect(circles.length).toBe(128);
    for (const circle of circles) {
      const val = circle.getAttribute('data-ch-expanded-chord-position');
      expect(val).toMatch(/^[\d\s]+$/);
    }
  });

  it('should set data-ch-expanded-chord-position on chord position labels', () => {
    score.setOptions({ drawForegroundShapes: ['ch-chord-position-label'] });
    const svg = score._container.querySelector('svg');
    const labels = svg.querySelectorAll('.ch-chord-position-label[data-ch-expanded-chord-position]');
    expect(labels.length).toBe(37);
  });

  it('should set data-ch-expanded-chord-position on chord position lines', () => {
    score.setOptions({ drawForegroundShapes: ['ch-chord-position-line'] });
    const svg = score._container.querySelector('svg');
    const lines = svg.querySelectorAll('.ch-chord-position-line[data-ch-expanded-chord-position]');
    expect(lines.length).toBe(37);
  });

  it('should set data-ch-expanded-chord-position on chord position rects', () => {
    score.setOptions({ drawBackgroundShapes: ['ch-chord-position-rect'] });
    const svg = score._container.querySelector('svg');
    const rects = svg.querySelectorAll('.ch-chord-position-rect[data-ch-expanded-chord-position]');
    expect(rects.length).toBe(37);
  });
});


// ============================================================
// chordPositions vs expandedChordPositions divergence with full-score expansion
// ============================================================
describe('chordPositions vs expandedChordPositions — with expansion', () => {
  it('TLL should have more expandedChordPositions than chordPositions', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml2 });
    ChScore.prototype.drawScore = origDrawScore;

    // TLL has repeats, so expanded > chord positions
    expect(score._scoreData.expandedChordPositions.length).toBe(100);
    expect(score._scoreData.chordPositions.length).toBe(61);
    expect(score._scoreData.expandedChordPositions.length).toBeGreaterThan(
      score._scoreData.chordPositions.length
    );
  });

  it('TLL audibleExpandedChordPositions should be fewer than total expanded', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml2 });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.audibleExpandedChordPositions.length).toBe(94);
    expect(score._scoreData.audibleExpandedChordPositions.length).toBeLessThan(
      score._scoreData.expandedChordPositions.length
    );
  });
});
