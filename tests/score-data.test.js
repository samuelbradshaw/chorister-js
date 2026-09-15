/**
 * Tests: scoreData properties — measures, notesAndRestsById, keySignatureInfo,
 * scalar properties, chordPositions, expandedChordPositions, midiNoteSequence,
 * getKeySignatureInfo public method.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';
import { sampleMusicXmlHGW as sampleMusicXml } from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// ============================================================
// Shared fixture — uses HGW as the primary score
// (Song-specific counts are tested in the demo song files;
//  this file tests generic structural invariants.)
// ============================================================
describe('scoreData — structural invariants', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};

    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  // ── measures ──
  describe('scoreData.measures', () => {
    it('should have one sub-measure per <measure>, and fewer measures than that', () => {
      const subMeasureIds = Object.keys(score._scoreData.subMeasuresById);
      expect(subMeasureIds.length).toBe(
        score._scoreData.meiParsed.querySelectorAll('measure').length);
      // This fixture writes one measure in two sub-measures
      expect(score._scoreData.measures.length).toBeLessThan(subMeasureIds.length);
      // And every sub-measure belongs to exactly one measure
      expect(score._scoreData.measures.flatMap(measure => measure.subMeasureIds))
        .toEqual(subMeasureIds);
    });

    it('each measure should have all expected properties', () => {
      const expectedKeys = [
        'durationQ', 'endQ', 'firstChordPosition', 'measureNumber', 'measureType',
        'rightBarLine', 'startQ', 'timeSignature', 'subMeasureIds',
      ];
      for (const m of score._scoreData.measures) {
        for (const key of expectedKeys) expect(m).toHaveProperty(key);
      }
    });

    it('each sub-measure should point back at the measure it belongs to', () => {
      for (const subMeasure of Object.values(score._scoreData.subMeasuresById)) {
        expect(score._scoreData.subMeasuresById[subMeasure.subMeasureId]).toBe(subMeasure);
        const measure = score._scoreData.measures[subMeasure.measureIndex];
        expect(measure.subMeasureIds[subMeasure.subMeasureIndex]).toBe(subMeasure.subMeasureId);
        // A measure spans the sub-measures it is written in
        expect(subMeasure.startQ).toBeGreaterThanOrEqual(measure.startQ);
        expect(subMeasure.endQ).toBeLessThanOrEqual(measure.endQ);
      }
    });

    it('measure startQ/endQ should form contiguous sequence', () => {
      const measures = score._scoreData.measures;
      for (let i = 1; i < measures.length; i++) {
        expect(measures[i].startQ).toBe(measures[i - 1].endQ);
      }
    });

    it('should write the normalized measure numbers onto measure@n', () => {
      // @n carries the measure's own number. A measure written in more than one sub-measure
      // repeats it, since the number belongs to the measure rather than to the element.
      // Every <measure> carries the number of the measure it is written in, so a measure
      // written in two sub-measures puts its number on both
      const numbers = Object.values(score._scoreData.subMeasuresById).map(subMeasure =>
        score._scoreData.measures[subMeasure.measureIndex].measureNumber);
      expect(Object.values(score._scoreData.subMeasuresById).some(sub => sub.subMeasureIndex > 0)).toBe(true);
      expect(new Set(numbers).size).toBeLessThan(numbers.length);
      for (const document of [score._scoreData.meiParsed, score._scoreData.meiParsedComplete]) {
        expect(Array.from(document.querySelectorAll('measure'))
          .map(measure => measure.getAttribute('n'))).toEqual(numbers);
      }
      // And on the serialized copy later documents are rebuilt from
      expect(Array.from(new DOMParser()
        .parseFromString(score._scoreData.meiStringComplete, 'text/xml')
        .querySelectorAll('measure')).map(measure => measure.getAttribute('n'))).toEqual(numbers);
    });

    it('should keep measure@n on the numbers when the MEI is rebuilt', () => {
      // @n carries the measure's own number. A measure written in more than one sub-measure
      // repeats it, since the number belongs to the measure rather than to the element.
      const numbers = Object.values(score._scoreData.subMeasuresById).map(subMeasure =>
        score._scoreData.measures[subMeasure.measureIndex].measureNumber);
      score._updateMei();
      expect(Array.from(score._scoreData.meiParsed.querySelectorAll('measure'))
        .map(measure => measure.getAttribute('n'))).toEqual(numbers);
    });

    it('should number an expanded score by the same rule', () => {
      const numbersIn = (document) => Array.from(document.querySelectorAll('measure'))
        .map(measure => measure.getAttribute('n'));
      const unexpanded = numbersIn(score._scoreData.meiParsed);
      score.setOptions({ expandScore: 'intro' });
      const expanded = numbersIn(score._scoreData.meiParsed);
      try {
        // The introduction is measures of the song played ahead of it, so the document has
        // more measures than the score does -- numbered by the same rule, not 1..N
        expect(expanded.length).toBeGreaterThan(unexpanded.length);
        expect(expanded[0]).toBe('0'); // The pickup stays the pickup
        // @n is never lettered: the number belongs to the measure, not to the element
        expect(expanded.every(number => /^\d+$/.test(number))).toBe(true);
        // 0 for the pickup, then 1, 2, 3 ... with nothing skipped, and a measure written in
        // more than one sub-measure repeating its number rather than taking another
        const opened = [...new Set(expanded)].map(Number);
        expect(opened).toEqual(opened.map((_, index) => index));
        expanded.forEach((number, index) => {
          if (index > 0) {
            expect(Number(number) - Number(expanded[index - 1])).toBeLessThanOrEqual(1);
          }
        });
        expect(expanded.length).toBeGreaterThan(opened.length); // Some measure does repeat
      } finally {
        score.setOptions({ expandScore: false });
      }
      // And numbering the song on its own is unchanged by having been expanded
      expect(numbersIn(score._scoreData.meiParsed)).toEqual(unexpanded);
    });

    it('exactly one measure should be first and one last', () => {
      // Position says which is which; the records carry no flag for it
      const measures = score._scoreData.measures;
      expect(measures[0].startQ).toBe(0);
      expect(measures.at(-1).endQ).toBe(Math.max(...measures.map(m => m.endQ)));
    });
  });

  // ── notesAndRestsById ──
  describe('scoreData.notesAndRestsById', () => {
    it('each entry should have all expected properties', () => {
      const expectedKeys = [
        'chordPosition', 'durationQ', 'elementId', 'endQ',
        'expandedChordPositions', 'isAudible', 'isCue',
        'isMelody', 'isRest', 'isTiedNote', 'layerNumber',
        'meiElement', 'partIds', 'pitch', 'staffNumber', 'startQ', 'tiedNoteId',
      ];
      const entries = Object.values(score._scoreData.notesAndRestsById);
      for (const nr of entries.slice(0, 10)) {
        for (const key of expectedKeys) {
          expect(nr).toHaveProperty(key);
        }
      }
    });

    it('every elementId key should match the entry elementId', () => {
      for (const [key, entry] of Object.entries(score._scoreData.notesAndRestsById)) {
        expect(entry.elementId).toBe(key);
      }
    });

    it('all notes should reference valid chord positions', () => {
      const maxCp = score._scoreData.chordPositions.length - 1;
      for (const entry of Object.values(score._scoreData.notesAndRestsById)) {
        expect(entry.chordPosition).toBeGreaterThanOrEqual(0);
        expect(entry.chordPosition).toBeLessThanOrEqual(maxCp);
      }
    });

    it('staffNumber should be valid for all entries', () => {
      const validStaves = new Set(score._scoreData.staffNumbers);
      for (const entry of Object.values(score._scoreData.notesAndRestsById)) {
        expect(validStaves.has(entry.staffNumber)).toBe(true);
      }
    });
  });

  // ── keySignatureInfo ──
  describe('scoreData.keySignatureInfo', () => {
    it('nearbyKeySignatures should have 15 entries', () => {
      expect(score._scoreData.keySignatureInfo.nearbyKeySignatures.length).toBe(15);
    });

    it('nearbyKeySignatures should be sorted by midiPitchOffset', () => {
      const nearby = score._scoreData.keySignatureInfo.nearbyKeySignatures;
      for (let i = 1; i < nearby.length; i++) {
        expect(nearby[i].midiPitchOffset).toBeGreaterThanOrEqual(nearby[i - 1].midiPitchOffset);
      }
    });

    it('self key should appear at offset 0 in nearbyKeySignatures', () => {
      const nearby = score._scoreData.keySignatureInfo.nearbyKeySignatures;
      const self = nearby.find(k => k.midiPitchOffset === 0);
      expect(self).toBeDefined();
      expect(self.keySignatureId).toBe(score._scoreData.keySignatureInfo.keySignatureId);
    });

    it('each nearbyKeySignature should have required properties', () => {
      const expectedKeys = [
        'keySignatureId', 'midiPitchOffset', 'mxlFifths', 'meiSig',
        'meiPnameAccid', 'midiPitch', 'tonality', 'name',
      ];
      for (const k of score._scoreData.keySignatureInfo.nearbyKeySignatures) {
        for (const key of expectedKeys) {
          expect(k).toHaveProperty(key);
        }
      }
    });
  });

  // ── scalar properties ──
  describe('scoreData scalar properties', () => {
    it('numChordPositions should match chordPositions.length', () => {
      expect(score._scoreData.numChordPositions).toBe(score._scoreData.chordPositions.length);
    });
  });

  // ── chordPositions ──
  describe('scoreData.chordPositions internal structure', () => {
    it('each CP should have all expected properties', () => {
      const expectedKeys = [
        'chordPosition', 'durationQ', 'endQ', 'expandedChordPositions',
        'isAudible', 'isDownbeat', 'isSingleLine', 'measureIndex',
        'melodyNote', 'midiDuration', 'midiEndTime', 'midiNotesByPitch',
        'midiQpm', 'midiStartTime', 'notesAndRests', 'startQ',
      ];
      for (const cp of score._scoreData.chordPositions) {
        for (const key of expectedKeys) {
          expect(cp).toHaveProperty(key);
        }
      }
    });

    it('chordPosition index should match array index', () => {
      for (let i = 0; i < score._scoreData.chordPositions.length; i++) {
        expect(score._scoreData.chordPositions[i].chordPosition).toBe(i);
      }
    });

    it('every CP measureIndex should name a measure', () => {
      for (const cp of score._scoreData.chordPositions) {
        expect(score._scoreData.measures[cp.measureIndex]).toBeDefined();
      }
    });

    it('startQ/endQ should form non-overlapping sequence', () => {
      const cps = score._scoreData.chordPositions;
      for (let i = 1; i < cps.length; i++) {
        expect(cps[i].startQ).toBeGreaterThanOrEqual(cps[i - 1].startQ);
      }
    });
  });

  // ── midiNoteSequence ──
  describe('scoreData.midiNoteSequence', () => {
    it('midiNoteSequence should have notes (mock Magenta)', () => {
      expect(score._scoreData.midiNoteSequence.notes.length).toBeGreaterThan(0);
    });

    it('tempos should have one entry at time=0 with qpm=120', () => {
      expect(score._scoreData.midiNoteSequence.tempos).toEqual([{ time: 0, qpm: 120 }]);
    });

    it('midiNoteSequence should have expected top-level keys', () => {
      const keys = Object.keys(score._scoreData.midiNoteSequence).sort();
      expect(keys).toEqual(['notes', 'tempos', 'totalQuantizedSteps', 'totalTime']);
    });

    it('midiType should be verovio for default load', () => {
      expect(score._scoreData.midiType).toBe('verovio');
    });
  });

  // ── getKeySignatureInfo public ──
  describe('getKeySignatureInfo() — public method', () => {
    it('should return the same object as scoreData.keySignatureInfo', () => {
      expect(score.getKeySignatureInfo()).toBe(score._scoreData.keySignatureInfo);
    });
  });

  // ── nearbyKeySignatures centering ──
  describe('nearbyKeySignatures — centering and offsets', () => {
    it('self key should appear at index 7 (center) of nearbyKeySignatures', () => {
      const nearby = score._scoreData.keySignatureInfo.nearbyKeySignatures;
      expect(nearby[7].midiPitchOffset).toBe(0);
      expect(nearby[7].keySignatureId).toBe(score._scoreData.keySignatureInfo.keySignatureId);
    });

    it('nearbyKeySignatures offsets should span negative through positive around center', () => {
      const nearby = score._scoreData.keySignatureInfo.nearbyKeySignatures;
      expect(nearby[0].midiPitchOffset).toBeLessThan(0);
      expect(nearby[14].midiPitchOffset).toBeGreaterThan(0);
    });

    it('each nearbyKeySignature should have a unique keySignatureId', () => {
      const nearby = score._scoreData.keySignatureInfo.nearbyKeySignatures;
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
    score._drawScore();
  });

  it('should set data-ch-expanded-chord-position on note circles', () => {
    score.setOptions({ drawBackgroundShapes: ['ch-note-circle'] });
    const svg = score._container.querySelector('svg');
    const circles = svg.querySelectorAll('.ch-note-circle[data-ch-expanded-chord-position]');
    expect(circles.length).toBeGreaterThan(0);
    for (const circle of circles) {
      const val = circle.getAttribute('data-ch-expanded-chord-position');
      expect(val).toMatch(/^[\d\s]+$/);
    }
  });

  it('should set data-ch-expanded-chord-position on chord position labels', () => {
    score.setOptions({ drawForegroundShapes: ['ch-chord-position-label'] });
    const svg = score._container.querySelector('svg');
    const labels = svg.querySelectorAll('.ch-chord-position-label[data-ch-expanded-chord-position]');
    expect(labels.length).toBeGreaterThan(0);
  });

  it('should set data-ch-expanded-chord-position on chord position lines', () => {
    score.setOptions({ drawForegroundShapes: ['ch-chord-position-line'] });
    const svg = score._container.querySelector('svg');
    const lines = svg.querySelectorAll('.ch-chord-position-line[data-ch-expanded-chord-position]');
    expect(lines.length).toBeGreaterThan(0);
  });

  it('should set data-ch-expanded-chord-position on chord position rects', () => {
    score.setOptions({ drawBackgroundShapes: ['ch-chord-position-rect'] });
    const svg = score._container.querySelector('svg');
    const rects = svg.querySelectorAll('.ch-chord-position-rect[data-ch-expanded-chord-position]');
    expect(rects.length).toBeGreaterThan(0);
  });
});
