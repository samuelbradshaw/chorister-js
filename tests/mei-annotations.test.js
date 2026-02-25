/**
 * Tests: MEI annotation attributes (ch-chord-position, ch-part-id, ch-lyric-line-id,
 * ch-section-id, ch-secondary, ch-chorus, ch-intro-bracket, ch-superscript)
 * and _parseAndAnnotateMei error handling / layer normalization.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks, resetScoreState } from './helpers.js';
import {
  sampleMusicXmlHGW as sampleMusicXml, sampleMusicXmlTLL as sampleMusicXml2,
} from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// ============================================================
// Shared fixture: sampleMusicXml + SA+TB, drawScore mocked
// Groups: ch-chord-position, ch-part-id (SA+TB), ch-secondary (SA+TB)
// ============================================================
describe('MEI annotations — SA+TB shared load', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      partsTemplate: 'SA+TB',
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  // ── ch-chord-position ──
  describe('ch-chord-position — MEI verification', () => {
    it('should set ch-chord-position on every note element as a single integer', () => {
      const notes = score._scoreData.meiParsed.querySelectorAll('note');
      expect(notes.length).toBeGreaterThan(0);
      for (const note of notes) {
        expect(note.hasAttribute('ch-chord-position')).toBe(true);
        const val = note.getAttribute('ch-chord-position');
        expect(val).toMatch(/^\d+$/);
      }
    });

    it('should set ch-chord-position on every rest element as a single integer', () => {
      const rests = score._scoreData.meiParsed.querySelectorAll('rest');
      for (const rest of rests) {
        expect(rest.hasAttribute('ch-chord-position')).toBe(true);
        const val = rest.getAttribute('ch-chord-position');
        expect(val).toMatch(/^\d+$/);
      }
    });

    it('should set ch-chord-position on chord parents matching child note value', () => {
      const chords = score._scoreData.meiParsed.querySelectorAll('chord[ch-chord-position]');
      for (const chord of chords) {
        const chordCp = chord.getAttribute('ch-chord-position');
        const childNote = chord.querySelector('note');
        if (childNote) {
          expect(childNote.getAttribute('ch-chord-position')).toBe(chordCp);
        }
      }
    });

    it('should set ch-chord-position on section elements as space-separated integers', () => {
      const sections = score._scoreData.meiParsed.querySelectorAll('section[ch-chord-position]');
      expect(sections.length).toBe(1);
      for (const section of sections) {
        const val = section.getAttribute('ch-chord-position').trim();
        expect(val.length).toBeGreaterThan(0);
        const parts = val.split(/\s+/);
        for (const part of parts) {
          expect(part).toMatch(/^\d+$/);
        }
      }
    });

    it('should have chord position values consistent with chordPositions array length', () => {
      const notes = score._scoreData.meiParsed.querySelectorAll('note[ch-chord-position]');
      for (const note of notes) {
        const cp = parseInt(note.getAttribute('ch-chord-position'));
        expect(cp).toBeGreaterThanOrEqual(0);
        expect(cp).toBeLessThan(score._scoreData.chordPositions.length);
      }
    });

    it('should set ch-chord-position on dir elements', () => {
      const dirs = score._scoreData.meiParsed.querySelectorAll('dir[ch-chord-position]');
      for (const dir of dirs) {
        const val = dir.getAttribute('ch-chord-position');
        expect(val).toMatch(/^\d+$/);
      }
    });

    it('should preserve ch-chord-position on melody notes after showMelodyOnly', () => {
      score.setOptions({ showMelodyOnly: true });
      const notes = score._scoreData.meiParsed.querySelectorAll('note');
      expect(notes.length).toBe(score._scoreData.chordPositions.length);
      for (const note of notes) {
        expect(note.hasAttribute('ch-chord-position')).toBe(true);
        expect(note.getAttribute('ch-chord-position')).toMatch(/^\d+$/);
      }
    });

    it('should restore all ch-chord-position values after toggling showMelodyOnly off', () => {
      const noteCountBefore = score._scoreData.meiParsed.querySelectorAll('note[ch-chord-position]').length;
      expect(noteCountBefore).toBeGreaterThan(0);
      score.setOptions({ showMelodyOnly: true });
      const noteCountMelody = score._scoreData.meiParsed.querySelectorAll('note[ch-chord-position]').length;
      expect(noteCountMelody).toBe(score._scoreData.chordPositions.length);

      score.setOptions({ showMelodyOnly: false });
      const noteCountRestored = score._scoreData.meiParsed.querySelectorAll('note[ch-chord-position]').length;
      expect(noteCountRestored).toBe(noteCountBefore);
    });
  });

  // ── ch-part-id (SA+TB) ──
  describe('ch-part-id — with partsTemplate SA+TB', () => {
    it('should set ch-part-id on notes', () => {
      const notesWithPartId = score._scoreData.meiParsed.querySelectorAll('note[ch-part-id]');
      expect(notesWithPartId.length).toBeGreaterThan(0);
    });

    it('should have hasPartInfo true', () => {
      expect(score._scoreData.hasPartInfo).toBe(true);
    });

    it('should contain valid part ID strings matching known part names', () => {
      const knownPartIds = score._scoreData.parts.map(p => p.partId);
      const notesWithPartId = score._scoreData.meiParsed.querySelectorAll('note[ch-part-id]');
      for (const note of notesWithPartId) {
        const partIds = note.getAttribute('ch-part-id').split(' ');
        for (const partId of partIds) {
          expect(knownPartIds).toContain(partId);
        }
      }
    });

    it('should set ch-part-id only on note elements, not on rests', () => {
      const restsWithPartId = score._scoreData.meiParsed.querySelectorAll('rest[ch-part-id]');
      expect(restsWithPartId.length).toBe(0);
    });

    it('should preserve ch-part-id after setOptions calls', () => {
      const countBefore = score._scoreData.meiParsed.querySelectorAll('note[ch-part-id]').length;
      score.setOptions({ showMeasureNumbers: true });
      const countAfter = score._scoreData.meiParsed.querySelectorAll('note[ch-part-id]').length;
      expect(countAfter).toBe(countBefore);
    });

    it('should assign distinct part IDs to notes on different staves/layers', () => {
      const notesWithPartId = score._scoreData.meiParsed.querySelectorAll('note[ch-part-id]');
      const allPartIds = new Set();
      for (const note of notesWithPartId) {
        for (const id of note.getAttribute('ch-part-id').split(' ')) {
          if (id) allPartIds.add(id);
        }
      }
      expect(allPartIds.size).toBe(4);
    });
  });

  // ── ch-secondary (SA+TB) ──
  describe('ch-secondary — with partsTemplate SA+TB', () => {
    it('should not set ch-secondary on verse elements attached to melody notes', () => {
      const melodyNotes = score._scoreData.meiParsed.querySelectorAll('[ch-melody]');
      for (const melodyNote of melodyNotes) {
        const parent = melodyNote.closest('[ch-chord-position]');
        const verses = parent.querySelectorAll('verse');
        for (const verse of verses) {
          expect(verse.hasAttribute('ch-secondary')).toBe(false);
        }
      }
    });

    it('should only mark verses on non-melody notes as secondary', () => {
      const secondaryVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]');
      for (const verse of secondaryVerses) {
        const parent = verse.closest('[ch-chord-position]');
        expect(parent.hasAttribute('ch-melody')).toBe(false);
        expect(parent.querySelector('[ch-melody]')).toBeNull();
      }
    });

    it('should have ch-secondary value be an empty string (boolean attribute) when present', () => {
      const secondaryVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]');
      for (const verse of secondaryVerses) {
        expect(verse.getAttribute('ch-secondary')).toBe('');
      }
    });

    it('should have no ch-secondary after showMelodyOnly removes non-melody notes', () => {
      score.setOptions({ showMelodyOnly: true });
      const secondaryVersesAfter = score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]');
      expect(secondaryVersesAfter.length).toBe(0);
    });

    it('should restore ch-secondary count when showMelodyOnly is toggled off', () => {
      const countBefore = score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]').length;

      score.setOptions({ showMelodyOnly: true });
      expect(score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]').length).toBe(0);

      score.setOptions({ showMelodyOnly: false });
      const countRestored = score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]').length;
      expect(countRestored).toBe(countBefore);
    });
  });
});

// ============================================================
// Shared fixture: sampleMusicXml, drawScore mocked
// Groups: ch-lyric-line-id, ch-section-id, ch-intro-bracket
// ============================================================
describe('MEI annotations — plain sampleMusicXml shared load', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  // ── ch-lyric-line-id ──
  describe('ch-lyric-line-id — MEI verification', () => {
    it('should set ch-lyric-line-id on every verse element', () => {
      const verses = score._scoreData.meiParsed.querySelectorAll('verse');
      expect(verses.length).toBeGreaterThan(0);
      for (const verse of verses) {
        expect(verse.hasAttribute('ch-lyric-line-id')).toBe(true);
      }
    });

    it('should use the format staffNumber.lineNumber', () => {
      const verses = score._scoreData.meiParsed.querySelectorAll('verse');
      for (const verse of verses) {
        const lyricLineId = verse.getAttribute('ch-lyric-line-id');
        expect(lyricLineId).toMatch(/^\d+\.\d+$/);
      }
    });

    it('should derive staff number from the parent staff element', () => {
      const verses = score._scoreData.meiParsed.querySelectorAll('verse');
      for (const verse of verses) {
        const lyricLineId = verse.getAttribute('ch-lyric-line-id');
        const staffNumber = lyricLineId.split('.')[0];
        const parentStaff = verse.closest('staff');
        expect(parentStaff).not.toBeNull();
        expect(parentStaff.getAttribute('n')).toBe(staffNumber);
      }
    });

    it('should derive line number from the verse n attribute', () => {
      const verses = score._scoreData.meiParsed.querySelectorAll('verse');
      for (const verse of verses) {
        const lyricLineId = verse.getAttribute('ch-lyric-line-id');
        const lineNumber = lyricLineId.split('.')[1];
        expect(verse.getAttribute('n')).toBe(lineNumber);
      }
    });

    it('should have multiple distinct lyric line IDs for a multi-verse hymn', () => {
      const verses = score._scoreData.meiParsed.querySelectorAll('verse');
      const lyricLineIds = new Set(Array.from(verses).map(v => v.getAttribute('ch-lyric-line-id')));
      expect(lyricLineIds.size).toBeGreaterThan(1);
    });

    it('should persist unchanged after setOptions calls', () => {
      const versesBefore = score._scoreData.meiParsed.querySelectorAll('verse');
      const idsBefore = Array.from(versesBefore).map(v => v.getAttribute('ch-lyric-line-id'));

      score.setOptions({ showMeasureNumbers: true });

      const versesAfter = score._scoreData.meiParsed.querySelectorAll('verse');
      const idsAfter = Array.from(versesAfter).map(v => v.getAttribute('ch-lyric-line-id'));
      expect(idsAfter).toEqual(idsBefore);
    });

    it('should also be present on verse elements in the second fixture', async () => {
      const score2 = new ChScore('#score-container');
      await score2.load('musicxml', { scoreContent: sampleMusicXml2 });
      const verses = score2._scoreData.meiParsed.querySelectorAll('verse');
      expect(verses.length).toBeGreaterThan(0);
      for (const verse of verses) {
        expect(verse.hasAttribute('ch-lyric-line-id')).toBe(true);
        expect(verse.getAttribute('ch-lyric-line-id')).toMatch(/^\d+\.\d+$/);
      }
    });
  });

  // ── ch-section-id ──
  describe('ch-section-id — MEI verification', () => {
    it('should set ch-section-id on verse elements', () => {
      const versesWithSectionId = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]');
      expect(versesWithSectionId.length).toBeGreaterThan(0);
    });

    it('should have hasLyricSectionIds true after loading', () => {
      expect(score._scoreData.hasLyricSectionIds).toBe(true);
    });

    it('should contain section IDs matching the loaded sections', () => {
      const knownSectionIds = score._scoreData.sections.map(s => s.sectionId);
      const versesWithSectionId = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]');
      for (const verse of versesWithSectionId) {
        const sectionIds = verse.getAttribute('ch-section-id').split(' ');
        for (const sectionId of sectionIds) {
          expect(knownSectionIds).toContain(sectionId);
        }
      }
    });

    it('should assign at least one section ID to each verse with ch-section-id', () => {
      const versesWithSectionId = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]');
      for (const verse of versesWithSectionId) {
        const sectionIds = verse.getAttribute('ch-section-id').split(' ');
        expect(sectionIds.length).toBeGreaterThanOrEqual(1);
        for (const sectionId of sectionIds) {
          expect(sectionId.length).toBeGreaterThan(0);
        }
      }
    });

    it('should assign single section IDs per verse in expandScore full-score mode', async () => {
      const score2 = new ChScore('#score-container');
      await score2.load('musicxml', { scoreContent: sampleMusicXml2 });
      score2.setOptions({ expandScore: 'full-score' });

      const versesWithSectionId = score2._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]');
      expect(versesWithSectionId.length).toBeGreaterThan(0);
      for (const verse of versesWithSectionId) {
        const sectionIds = verse.getAttribute('ch-section-id').split(' ');
        expect(sectionIds.length).toBe(1);
      }
    });
  });
});

// ============================================================
// ch-part-id (without partsTemplate)
// ============================================================
describe('ch-part-id — without partsTemplate or parts', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

  it('should still have hasPartInfo true (default melody part is generated)', () => {
    expect(score._scoreData.hasPartInfo).toBe(true);
  });

  it('should assign default part IDs (melody, accompaniment) to notes', () => {
    const notesWithPartId = score._scoreData.meiParsed.querySelectorAll('note[ch-part-id]');
    expect(notesWithPartId.length).toBeGreaterThan(0);
    const allPartIds = new Set();
    for (const note of notesWithPartId) {
      for (const id of note.getAttribute('ch-part-id').split(' ')) {
        if (id) allPartIds.add(id);
      }
    }
    expect(allPartIds.has('melody') || allPartIds.has('accompaniment')).toBe(true);
  });
});

// ============================================================
// ch-secondary (without partsTemplate)
// ============================================================
describe('ch-secondary — without partsTemplate', () => {
  it('should not set ch-secondary when no partsTemplate is provided', async () => {
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    const secondaryVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]');
    expect(secondaryVerses.length).toBe(0);
  });
});

// ============================================================
// ch-superscript
// ============================================================
describe('ch-superscript — MEI verification', () => {
  const chordSetsWithNumbers = [{
    chordSetId: 'test-chords-super',
    name: 'Test Chords Superscript',
    svgSymbolsUrl: null,
    chordInfoList: [],
    chordPositionRefs: {
      0: { prefix: null, text: 'Cm7', svgSymbolId: null },
      4: { prefix: null, text: 'G7', svgSymbolId: null },
      8: { prefix: null, text: 'F', svgSymbolId: null },
    },
  }];

  describe('with chord text containing digits', () => {
    let score;

    beforeAll(async () => {
      document.body.innerHTML = '<div id="score-container"></div>';
      ChScore.prototype.drawScore = function() {};
      score = new ChScore('#score-container');
      const freshChordSets = chordSetsWithNumbers.map(cs => ({
        ...cs,
        chordInfoList: [],
        chordPositionRefs: { ...cs.chordPositionRefs },
      }));
      await score.load('musicxml', {
        scoreContent: sampleMusicXml,
        chordSets: freshChordSets,
      });
    });

    afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });
    afterEach(() => { resetScoreState(score); });

    it('should create rend elements with ch-superscript when showChordSet is enabled', () => {
      score.setOptions({ showChordSet: 'test-chords-super' });
      const rendSuperscript = score._scoreData.meiParsed.querySelectorAll('rend[ch-superscript]');
      expect(rendSuperscript.length).toBe(2);
    });

    it('should have ch-superscript value be an empty string', () => {
      score.setOptions({ showChordSet: 'test-chords-super' });
      const rendSuperscript = score._scoreData.meiParsed.querySelectorAll('rend[ch-superscript]');
      for (const rend of rendSuperscript) {
        expect(rend.getAttribute('ch-superscript')).toBe('');
      }
    });

    it('should wrap only digit content in ch-superscript rend elements', () => {
      score.setOptions({ showChordSet: 'test-chords-super' });
      const rendSuperscript = score._scoreData.meiParsed.querySelectorAll('rend[ch-superscript]');
      for (const rend of rendSuperscript) {
        expect(rend.textContent).toMatch(/^\d+$/);
      }
    });

    it('should have no ch-superscript when showChordSet is false', () => {
      const rendSuperscript = score._scoreData.meiParsed.querySelectorAll('rend[ch-superscript]');
      expect(rendSuperscript.length).toBe(0);
    });

    it('should remove ch-superscript when showChordSet is toggled off', () => {
      score.setOptions({ showChordSet: 'test-chords-super' });
      expect(score._scoreData.meiParsed.querySelectorAll('rend[ch-superscript]').length).toBeGreaterThan(0);

      score.setOptions({ showChordSet: false });
      expect(score._scoreData.meiParsed.querySelectorAll('rend[ch-superscript]').length).toBe(0);
    });

    it('should place ch-superscript rend inside harm elements', () => {
      score.setOptions({ showChordSet: 'test-chords-super' });
      const rendSuperscript = score._scoreData.meiParsed.querySelectorAll('rend[ch-superscript]');
      for (const rend of rendSuperscript) {
        expect(rend.closest('harm')).not.toBeNull();
      }
    });
  });

  it('should not create ch-superscript for chord text without digits', async () => {
    const chordSetsNoDigits = [{
      chordSetId: 'no-digit-chords',
      name: 'No Digit Chords',
      svgSymbolsUrl: null,
      chordInfoList: [],
      chordPositionRefs: {
        0: { prefix: null, text: 'Ab', svgSymbolId: null },
        4: { prefix: null, text: 'Eb', svgSymbolId: null },
      },
    }];
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      chordSets: chordSetsNoDigits,
    });
    score.setOptions({ showChordSet: 'no-digit-chords' });
    const rendSuperscript = score._scoreData.meiParsed.querySelectorAll('rend[ch-superscript]');
    expect(rendSuperscript.length).toBe(0);
  });
});


// ============================================================
// _parseAndAnnotateMei — error handling
// ============================================================
describe('_parseAndAnnotateMei() — error handling', () => {
  it('should handle empty timemap gracefully', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await score.load('musicxml', { scoreContent: sampleMusicXml });

    const timemapErrors = consoleSpy.mock.calls.filter(
      call => call[0]?.includes?.('empty or invalid timemap')
    );
    expect(timemapErrors.length).toBe(0);

    consoleSpy.mockRestore();
    ChScore.prototype.drawScore = origDrawScore;
  });
});


// ============================================================
// ch-melody — MEI-only boolean attribute
// ============================================================
describe('ch-melody — MEI annotation', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      partsTemplate: 'SA+TB',
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  it('should set ch-melody on exactly one note per chord position (37 melody notes)', () => {
    const melodyNotes = score._scoreData.meiParsed.querySelectorAll('note[ch-melody]');
    expect(melodyNotes.length).toBe(score._scoreData.chordPositions.length);
  });

  it('should set ch-melody as a boolean attribute (empty string value)', () => {
    const melodyNotes = score._scoreData.meiParsed.querySelectorAll('note[ch-melody]');
    for (const note of melodyNotes) {
      expect(note.getAttribute('ch-melody')).toBe('');
    }
  });

  it('should have melody notes only on staff 1, layer 1', () => {
    const melodyNotes = score._scoreData.meiParsed.querySelectorAll('note[ch-melody]');
    for (const note of melodyNotes) {
      const staff = note.closest('staff');
      expect(staff.getAttribute('n')).toBe('1');
      const layer = note.closest('layer');
      expect(layer.getAttribute('n')).toBe('1');
    }
  });
});


// ============================================================
// ch-expanded-chord-position — MEI annotation
// ============================================================
describe('ch-expanded-chord-position — MEI annotation', () => {
  it('should set ch-expanded-chord-position on notes in expanded intro mode', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    score.setOptions({ expandScore: 'intro' });

    const notesWithEcp = score._scoreData.meiParsed.querySelectorAll('[ch-expanded-chord-position]');
    expect(notesWithEcp.length).toBeGreaterThan(0);
    for (const note of notesWithEcp) {
      const val = note.getAttribute('ch-expanded-chord-position');
      expect(val).toMatch(/^[\d\s]+$/);
    }
    ChScore.prototype.drawScore = origDrawScore;
  });

  it('should set ch-expanded-chord-position on notes in full-score expansion (TLL)', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml2 });
    score.setOptions({ expandScore: 'full-score' });

    const notesWithEcp = score._scoreData.meiParsed.querySelectorAll('[ch-expanded-chord-position]');
    expect(notesWithEcp.length).toBeGreaterThan(0);
    for (const note of notesWithEcp) {
      const val = note.getAttribute('ch-expanded-chord-position');
      expect(val).toMatch(/^[\d\s]+$/);
    }
    ChScore.prototype.drawScore = origDrawScore;
  });
});


// ============================================================
// Annotation count consistency
// ============================================================
describe('Annotation count consistency', () => {
  it('ch-chord-position note count should match notesAndRestsById note count', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    const score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      partsTemplate: 'SA+TB',
    });
    ChScore.prototype.drawScore = origDrawScore;

    const meiNotes = score._scoreData.meiParsed.querySelectorAll('note[ch-chord-position]');
    const dataNotes = Object.values(score._scoreData.notesAndRestsById).filter(nr => !nr.isRest);
    expect(meiNotes.length).toBe(dataNotes.length);
  });

  it('ch-lyric-line-id verse count should match across MEI and scoreData', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    const score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

    const meiVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-lyric-line-id]');
    const lyricLineIds = new Set(Array.from(meiVerses).map(v => v.getAttribute('ch-lyric-line-id')));
    expect(lyricLineIds.size).toBeGreaterThan(1);
  });
});


// ============================================================
// Layer normalization
// ============================================================
describe('_parseAndAnnotateMei() — layer normalization', () => {
  it('should handle scores with layers numbered starting at values other than 1', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

    const layers = score._scoreData.meiParsed.querySelectorAll('layer');
    for (const layer of layers) {
      const n = parseInt(layer.getAttribute('n'));
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(4);
    }
  });
});
