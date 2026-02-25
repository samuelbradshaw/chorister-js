/**
 * Tests: "This Little Light of Mine" — features unique to this score.
 *
 * Covers:
 * - MC partsTemplate (melody + accompaniment, auto-generated)
 * - Repeat barlines (forward + backward repeat) and first/second endings
 * - hasRepeatOrJump = true
 * - Expansion of repeated score (15 → 22 measures)
 * - No intro brackets (intro detected from non-lyric measures before repeat)
 * - 6 fermatas across the verse section
 * - 2 verses from lyrics file
 * - Single-line chord positions (only one lyric line at certain points)
 * - Non-audible chord positions (tied notes)
 * - C major, 4/4 time, no pickup measure
 * - hideSectionIds with auto-generated sections
 * - showMelodyOnly with MC layout
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import './setup.js';
import {
  initChScore, setupStandardHooks, resetScoreState,
} from './helpers.js';
import {
  sampleMusicXmlTLL as sampleMusicXml2, sampleLyricsTLL as sampleLyrics2,
  EXPECTED_TLL, tllFermatas, tllPartsTemplate,
} from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// ============================================================
// Shared fixture: TLL loaded with MC partsTemplate + lyrics + fermatas
// ============================================================
describe('This Little Light of Mine — shared fixture', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml2,
      lyricsText: sampleLyrics2,
      partsTemplate: tllPartsTemplate,
      fermatas: tllFermatas,
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

  // ── Basic score structure ──
  describe('Basic score structure', () => {
    it('should have 2 staves', () => {
      expect(score._scoreData.staffNumbers).toEqual([1, 2]);
    });

    it('should have 15 measures', () => {
      expect(score._scoreData.measures.length).toBe(15);
    });

    it('should be in C major', () => {
      const ksi = score._scoreData.keySignatureInfo;
      expect(ksi.keySignatureId).toBe('c-major');
      expect(ksi.mxlFifths).toBe('0');
    });

    it('should be in 4/4 time', () => {
      expect(score._scoreData.measures[0].timeSignature).toEqual([4, 4]);
    });

    it('should have lyrics', () => {
      expect(score._scoreData.hasLyrics).toBe(true);
    });

    it('should have part info', () => {
      expect(score._scoreData.hasPartInfo).toBe(true);
    });

    it('should have melody info', () => {
      expect(score._scoreData.hasMelodyInfo).toBe(true);
    });

    it('first measure should be a full measure (no pickup)', () => {
      const m = score._scoreData.measures[0];
      expect(m.measureType).toBe('full');
      expect(m.isFirstMeasure).toBe(true);
      expect(m.durationQ).toBe(4);
    });

    it('last measure should have end barline', () => {
      const lastMeasure = score._scoreData.measures[score._scoreData.measures.length - 1];
      expect(lastMeasure.isLastMeasure).toBe(true);
      expect(lastMeasure.rightBarLine).toBe('end');
    });

    it('should have 61 chord positions', () => {
      expect(score._scoreData.chordPositions.length).toBe(EXPECTED_TLL.total);
    });

    it('should have 109 notes/rests', () => {
      expect(Object.keys(score._scoreData.notesAndRestsById).length).toBe(109);
    });
  });

  // ── Repeat and endings ──
  describe('Repeat barlines and endings', () => {
    it('should have hasRepeatOrJump true', () => {
      expect(score._scoreData.hasRepeatOrJump).toBe(true);
    });

    it('should have an expansion element in the MEI', () => {
      expect(score._scoreData.hasExpansion).toBe(true);
    });

    it('should have ending elements in the original MEI', () => {
      // The meiStringComplete should contain endings before expansion
      const completeMei = new DOMParser().parseFromString(
        score._scoreData.meiStringComplete, 'text/xml'
      );
      const endings = completeMei.querySelectorAll('ending');
      expect(endings.length).toBe(2);
    });
  });

  // ── MC partsTemplate ──
  describe('MC partsTemplate — melody + accompaniment', () => {
    it('should have melody and accompaniment parts', () => {
      const partIds = score._scoreData.parts.map(p => p.partId);
      expect(partIds).toContain('melody');
      expect(partIds).toContain('accompaniment');
    });

    it('melody part should be vocal', () => {
      const melody = score._scoreData.partsById['melody'];
      expect(melody.isVocal).toBe(true);
    });

    it('accompaniment part should not be vocal', () => {
      const accompaniment = score._scoreData.partsById['accompaniment'];
      expect(accompaniment.isVocal).toBe(false);
    });

    it('melody should be the melody part', () => {
      const melody = score._scoreData.partsById['melody'];
      expect(melody.chordPositionRefs['0'].isMelody).toBe(true);
    });

    it('accompaniment should NOT be the melody part', () => {
      const accompaniment = score._scoreData.partsById['accompaniment'];
      expect(accompaniment.chordPositionRefs['0'].isMelody).toBe(false);
    });

    it('melody should be on staff 1', () => {
      const melody = score._scoreData.partsById['melody'];
      expect(melody.chordPositionRefs['0'].staffNumbers).toContain(1);
    });

    it('accompaniment should be on staff 2', () => {
      const accompaniment = score._scoreData.partsById['accompaniment'];
      expect(accompaniment.chordPositionRefs['0'].staffNumbers).toContain(2);
    });

    it('accompaniment placement should be full', () => {
      const accompaniment = score._scoreData.partsById['accompaniment'];
      expect(accompaniment.placement).toBe('full');
    });

    it('melody notes should have ch-melody attribute', () => {
      const melodyNotes = score._scoreData.meiParsed.querySelectorAll('note[ch-melody]');
      expect(melodyNotes.length).toBeGreaterThan(0);
    });

    it('ch-part-id should include melody and accompaniment', () => {
      const allPartIds = new Set();
      for (const note of score._scoreData.meiParsed.querySelectorAll('note[ch-part-id]')) {
        for (const id of note.getAttribute('ch-part-id').split(' ')) {
          if (id) allPartIds.add(id);
        }
      }
      expect(allPartIds).toContain('melody');
      expect(allPartIds).toContain('accompaniment');
    });
  });

  // ── Fermatas (6 total) ──
  describe('Fermatas — 6 across the verse section', () => {
    it('should store all 6 fermatas', () => {
      expect(score._scoreData.fermatas.length).toBe(6);
    });

    it('all fermatas should have durationFactor of 2', () => {
      for (const f of score._scoreData.fermatas) {
        expect(f.durationFactor).toBe(2);
      }
    });

    it('fermata chord positions should be evenly spaced', () => {
      const cps = score._scoreData.fermatas.map(f => f.chordPosition);
      // 14, 20, 26, 32, 38, 44 — spacing of 6
      for (let i = 1; i < cps.length; i++) {
        expect(cps[i] - cps[i - 1]).toBe(6);
      }
    });

    it('all fermata chord positions should be valid', () => {
      for (const f of score._scoreData.fermatas) {
        expect(f.chordPosition).toBeGreaterThanOrEqual(0);
        expect(f.chordPosition).toBeLessThan(score._scoreData.chordPositions.length);
      }
    });
  });

  // ── No intro brackets ──
  describe('No intro brackets', () => {
    it('should not have intro brackets', () => {
      expect(score._scoreData.hasIntroBrackets).toBe(false);
    });

    it('should have zero ch-intro-bracket dir elements', () => {
      const introBrackets = score._scoreData.meiParsed.querySelectorAll('dir[ch-intro-bracket]');
      expect(introBrackets.length).toBe(0);
    });
  });

  // ── Audible vs non-audible chord positions ──
  describe('Audible vs non-audible chord positions', () => {
    it('should have fewer audible chord positions than total (tied notes)', () => {
      expect(score._scoreData.audibleChordPositions.length).toBe(EXPECTED_TLL.audible);
      expect(EXPECTED_TLL.audible).toBeLessThan(EXPECTED_TLL.total);
    });

    it('non-audible chord positions should exist', () => {
      const nonAudible = score._scoreData.chordPositions.filter(cp => !cp.isAudible);
      expect(nonAudible.length).toBe(EXPECTED_TLL.total - EXPECTED_TLL.audible);
    });
  });

  // ── Single-line chord positions ──
  describe('Single-line chord positions', () => {
    it('should have some single-line chord positions', () => {
      const singleLine = score._scoreData.chordPositions.filter(cp => cp.isSingleLine);
      expect(singleLine.length).toBeGreaterThan(0);
    });

    it('single-line chord positions should not have multiple lyric lines', () => {
      for (const cp of score._scoreData.chordPositions) {
        if (cp.isSingleLine) {
          // At single-line positions, all verse elements should have n=1
          const notes = score._scoreData.meiParsed.querySelectorAll(
            `[ch-chord-position="${cp.chordPosition}"] verse`
          );
          for (const verse of notes) {
            expect(verse.getAttribute('n')).toBe('1');
          }
        }
      }
    });
  });

  // ── Chord position internal structure ──
  describe('Chord position internal structure', () => {
    it('CP[0] should have correct timing values', () => {
      const cp0 = score._scoreData.chordPositions[0];
      expect(cp0.startQ).toBe(0);
      expect(cp0.endQ).toBe(1);
      expect(cp0.isDownbeat).toBe(true);
    });

    it('CP[0] should have 2 notesAndRests', () => {
      const cp0 = score._scoreData.chordPositions[0];
      expect(cp0.notesAndRests.length).toBe(2);
    });

    it('CP[0] melody note should have pitch 67', () => {
      const cp0 = score._scoreData.chordPositions[0];
      expect(cp0.melodyNote).toBeDefined();
      expect(cp0.melodyNote.pitch).toBe(67);
    });

    it('last CP[60] should be a single-line position', () => {
      const lastCp = score._scoreData.chordPositions[60];
      expect(lastCp.isSingleLine).toBe(true);
      expect(lastCp.melodyNote).toBeNull();
      expect(lastCp.startQ).toBe(58);
      expect(lastCp.endQ).toBe(60);
    });

    it('last CP[60] should have 1 notesAndRests', () => {
      const lastCp = score._scoreData.chordPositions[60];
      expect(lastCp.notesAndRests.length).toBe(1);
    });
  });

  // ── Expanded chord positions ──
  describe('Expanded chord positions', () => {
    it('should have 100 expanded chord positions', () => {
      expect(score._scoreData.expandedChordPositions.length).toBe(EXPECTED_TLL.expanded);
    });

    it('should have 94 audible expanded chord positions', () => {
      expect(score._scoreData.audibleExpandedChordPositions.length).toBe(EXPECTED_TLL.audibleExpanded);
    });

    it('expanded should exceed chord positions (repeated score)', () => {
      // Compare actual runtime values, not static constants
      expect(score._scoreData.expandedChordPositions.length).toBeGreaterThan(
        score._scoreData.chordPositions.length
      );
    });

    it('each expanded chord position should reference a valid section', () => {
      for (const ecp of score._scoreData.expandedChordPositions) {
        expect(ecp.sectionId).toBeDefined();
        expect(score._scoreData.sectionsById[ecp.sectionId]).toBeDefined();
      }
    });
  });

  // ── Sections ──
  describe('Sections — from lyrics and expansion', () => {
    it('should have at least 2 sections (intro + verses)', () => {
      expect(score._scoreData.sections.length).toBeGreaterThanOrEqual(2);
    });

    it('should have exactly 2 verse sections', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      expect(verses.length).toBe(2);
    });

    it('should not have chorus sections (TLL is all verses)', () => {
      const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
      expect(choruses.length).toBe(0);
    });

    it('should have no verse elements with ch-chorus attribute', () => {
      const chorusVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-chorus]');
      expect(chorusVerses.length).toBe(0);
    });

    it('verse sections should have chordPositionRanges with start and end', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      expect(verses.length).toBeGreaterThan(0);
      for (const verse of verses) {
        expect(verse.chordPositionRanges).toBeDefined();
        expect(verse.chordPositionRanges.length).toBeGreaterThan(0);
        for (const range of verse.chordPositionRanges) {
          expect(range).toHaveProperty('start');
          expect(range).toHaveProperty('end');
          expect(typeof range.start).toBe('number');
          expect(typeof range.end).toBe('number');
        }
      }
    });
  });

  // ── ch-section-id ──
  describe('ch-section-id — section association', () => {
    it('should have ch-section-id on verse elements', () => {
      const versesWithSectionId = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]');
      expect(versesWithSectionId.length).toBeGreaterThan(0);
    });

    it('ch-section-id values should reference known sections', () => {
      const knownIds = new Set(score._scoreData.sections.map(s => s.sectionId));
      const versesWithSectionId = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]');
      for (const verse of versesWithSectionId) {
        // ch-section-id may contain space-separated section IDs
        const ids = verse.getAttribute('ch-section-id').split(/\s+/).filter(Boolean);
        for (const id of ids) {
          expect(knownIds.has(id), `ch-section-id "${id}" not in sections`).toBe(true);
        }
      }
    });

    it('should have hasLyricSectionIds true', () => {
      expect(score._scoreData.hasLyricSectionIds).toBe(true);
    });
  });

  // ── expandScore full-score (repeat expansion) ──
  describe('expandScore full-score — repeat expansion', () => {
    beforeAll(() => { score.setOptions({ expandScore: 'full-score' }); });
    afterAll(() => { resetScoreState(score); });

    it('should expand from 15 to exactly 22 measures', () => {
      const measures = score._scoreData.meiParsed.querySelectorAll('measure').length;
      expect(measures).toBe(22);
    });

    it('should create -rend suffixed section IDs', () => {
      const sections = score._scoreData.meiParsed.querySelectorAll('section');
      const rendSections = Array.from(sections).filter(
        s => (s.getAttribute('xml:id') || '').includes('-rend')
      );
      expect(rendSections.length).toBeGreaterThan(0);
    });

    it('should remove repeat barlines after expansion', () => {
      const rptStarts = score._scoreData.meiParsed.querySelectorAll('measure[left="rptstart"]');
      const rptEnds = score._scoreData.meiParsed.querySelectorAll('measure[right="rptend"]');
      expect(rptStarts.length).toBe(0);
      expect(rptEnds.length).toBe(0);
    });

    it('should restore original 15 measures when expandScore is set back to false', () => {
      score.setOptions({ expandScore: false });
      const measuresRestored = score._scoreData.meiParsed.querySelectorAll('measure').length;
      expect(measuresRestored).toBe(15);
      score.setOptions({ expandScore: 'full-score' });
    });

    it('should assign ch-expanded-chord-position on notes', () => {
      const notesWithEcp = score._scoreData.meiParsed.querySelectorAll('[ch-expanded-chord-position]');
      expect(notesWithEcp.length).toBeGreaterThan(0);
    });

    it('should unwrap ending elements into sections', () => {
      // After expansion, endings become sections — no ending elements should remain
      const endings = score._scoreData.meiParsed.querySelectorAll('ending');
      expect(endings.length).toBe(0);
    });
  });

  // ── expandScore intro (no intro brackets) ──
  describe('expandScore intro — score without intro brackets', () => {
    beforeAll(() => { score.setOptions({ expandScore: 'intro' }); });
    afterAll(() => { resetScoreState(score); });

    it('should not create an introduction section (no intro brackets to extract)', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      // TLL has no intro brackets, so expandScore 'intro' has no introduction to extract
      expect(introSection).toBeNull();
    });

    it('measure count should remain 15 with expandScore intro (no change for TLL)', () => {
      const measures = score._scoreData.meiParsed.querySelectorAll('measure').length;
      expect(measures).toBe(15);
    });
  });

  // ── hideSectionIds ──
  describe('hideSectionIds — section hiding', () => {
    afterEach(() => { resetScoreState(score); });

    it('should keep all 2 staves when no sections are hidden', () => {
      const staffDefs = score._scoreData.meiParsed.querySelectorAll('staffDef');
      expect(staffDefs.length).toBe(2);
    });

    it('should remove verses for hidden sections', () => {
      const versesBefore = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      const firstVerse = score._scoreData.sections.find(s => s.type === 'verse');
      expect(firstVerse).toBeDefined();
      score.setOptions({ hideSectionIds: [firstVerse.sectionId] });
      const versesAfter = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      expect(versesAfter).toBeLessThan(versesBefore);
    });

    it('should still have 2 staves after hiding a section (no staff removal needed)', () => {
      const firstVerse = score._scoreData.sections.find(s => s.type === 'verse');
      score.setOptions({ hideSectionIds: [firstVerse.sectionId] });
      const staffDefs = score._scoreData.meiParsed.querySelectorAll('staffDef');
      // TLL uses staff 1 and 2 for all sections, so no staff should be removed
      expect(staffDefs.length).toBe(2);
    });

    it('should restore all verses when hideSectionIds is cleared', () => {
      const versesBefore = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      const firstVerse = score._scoreData.sections.find(s => s.type === 'verse');
      expect(firstVerse).toBeDefined();
      score.setOptions({ hideSectionIds: [firstVerse.sectionId] });
      score.setOptions({ hideSectionIds: [] });
      const versesRestored = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      expect(versesRestored).toBe(versesBefore);
    });
  });

  // ── showMelodyOnly ──
  describe('showMelodyOnly — MC layout', () => {
    beforeAll(() => { score.setOptions({ showMelodyOnly: true }); });
    afterAll(() => { resetScoreState(score); });

    it('should reduce to 1 staff per measure', () => {
      const measures = score._scoreData.meiParsed.querySelectorAll('measure');
      for (const measure of measures) {
        expect(measure.querySelectorAll('staff').length).toBe(1);
      }
    });

    it('should only keep melody notes', () => {
      const notes = score._scoreData.meiParsed.querySelectorAll('note');
      for (const note of notes) {
        expect(note.hasAttribute('ch-melody')).toBe(true);
      }
    });

    it('melody should be on staff 1', () => {
      const staves = score._scoreData.meiParsed.querySelectorAll('staff');
      for (const staff of staves) {
        expect(staff.getAttribute('n')).toBe('1');
      }
    });

    it('should restore all staves when toggled off', () => {
      score.setOptions({ showMelodyOnly: false });
      const staffNumbers = new Set();
      for (const staff of score._scoreData.meiParsed.querySelectorAll('staff')) {
        staffNumbers.add(staff.getAttribute('n'));
      }
      expect(staffNumbers.size).toBe(2);
      score.setOptions({ showMelodyOnly: true });
    });

    it('should remove mRest elements when enabled', () => {
      const mRests = score._scoreData.meiParsed.querySelectorAll('mRest');
      expect(mRests.length).toBe(0);
    });

    it('should remove curvedir from remaining slurs when enabled', () => {
      const slurs = score._scoreData.meiParsed.querySelectorAll('slur');
      for (const slur of slurs) {
        expect(slur.hasAttribute('curvedir')).toBe(false);
      }
    });
  });

  // ── Lyric line IDs ──
  describe('Lyric line IDs', () => {
    it('should have verse elements with ch-lyric-line-id', () => {
      const verses = score._scoreData.meiParsed.querySelectorAll('verse[ch-lyric-line-id]');
      expect(verses.length).toBeGreaterThan(0);
    });

    it('should have 2 distinct lyric line IDs (2 verse lines)', () => {
      const lyricLineIds = new Set();
      for (const verse of score._scoreData.meiParsed.querySelectorAll('verse[ch-lyric-line-id]')) {
        lyricLineIds.add(verse.getAttribute('ch-lyric-line-id'));
      }
      expect(lyricLineIds.size).toBe(2);
    });
  });
});

// ============================================================
// TLL without partsTemplate or lyrics (plain MusicXML only)
// ============================================================
describe('This Little Light — plain load (no partsTemplate)', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml2,
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  it('should still have 2 staves', () => {
    expect(score._scoreData.staffNumbers).toEqual([1, 2]);
  });

  it('should have hasRepeatOrJump true', () => {
    expect(score._scoreData.hasRepeatOrJump).toBe(true);
  });

  it('should have hasExpansion true', () => {
    expect(score._scoreData.hasExpansion).toBe(true);
  });

  it('should not have intro brackets', () => {
    expect(score._scoreData.hasIntroBrackets).toBe(false);
  });

  it('should not have chorus sections', () => {
    const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
    expect(choruses.length).toBe(0);
  });
});

// ============================================================
// TLL with lyrics extraction
// ============================================================
describe('This Little Light — lyrics extraction from text file', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml2,
      lyricsText: sampleLyrics2,
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  it('should store the lyrics text', () => {
    expect(score._scoreData.lyricsText).toBe(sampleLyrics2);
  });

  it('should have 2 verse sections from lyrics', () => {
    const verses = score._scoreData.sections.filter(s => s.type === 'verse');
    expect(verses.length).toBe(2);
  });

  it('verse sections should have sequential markers', () => {
    const verses = score._scoreData.sections.filter(s => s.type === 'verse');
    for (let i = 0; i < verses.length; i++) {
      expect(Number(verses[i].marker)).toBe(i + 1);
    }
  });

  it('should not have chorus sections (only verses in lyrics file)', () => {
    const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
    expect(choruses.length).toBe(0);
  });

  it('verse sections should have annotatedLyrics', () => {
    const verses = score._scoreData.sections.filter(s => s.type === 'verse');
    for (const verse of verses) {
      expect(verse.annotatedLyrics).toBeDefined();
      expect(verse.annotatedLyrics).not.toBeNull();
    }
  });
});
