/**
 * Tests: "How Great the Wisdom and the Love" — features unique to this score.
 *
 * Covers:
 * - SATB partsTemplate (auto-generated parts: soprano, alto, tenor, bass)
 * - 3/4 time signature
 * - Pickup measure (partial-pickup / partial-pickdown)
 * - A♭ major key signature (4 flats)
 * - Intro brackets (single range, measures 13–16)
 * - 6 verses from lyrics text (4 inline + 2 below)
 * - Fermata at chord position 28
 * - expandScore with intro brackets in a non-repeated score
 * - hideSectionIds with auto-generated sections
 * - showMelodyOnly with SATB layout
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import './setup.js';
import {
  initChScore, setupStandardHooks, resetScoreState,
} from './helpers.js';
import {
  sampleMusicXmlHGW as sampleMusicXml, sampleLyricsHGW as sampleLyrics,
  EXPECTED_HGW, hgwFermatas, hgwPartsTemplate,
} from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// ============================================================
// Shared fixture: HGW loaded with SATB partsTemplate + lyrics + fermata
// ============================================================
describe('How Great the Wisdom and the Love — shared fixture', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
      partsTemplate: hgwPartsTemplate,
      fermatas: hgwFermatas,
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

  // ── Basic score structure ──
  describe('Basic score structure', () => {
    it('should have 2 staves (piano treble + bass)', () => {
      expect(score._scoreData.staffNumbers).toEqual([1, 2]);
    });

    it('should have 16 measures', () => {
      expect(score._scoreData.measures.length).toBe(16);
    });

    it('should be in A♭ major (4 flats)', () => {
      const ksi = score._scoreData.keySignatureInfo;
      expect(ksi.keySignatureId).toBe('a-flat-major');
      expect(ksi.mxlFifths).toBe('-4');
      expect(ksi.meiSig).toBe('4f');
    });

    it('should be in 3/4 time', () => {
      expect(score._scoreData.measures[0].timeSignature).toEqual([3, 4]);
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

    it('should have hasRepeatOrJump false (no repeats in the MusicXML)', () => {
      expect(score._scoreData.hasRepeatOrJump).toBe(false);
    });

    it('should have 37 chord positions', () => {
      expect(score._scoreData.chordPositions.length).toBe(EXPECTED_HGW.total);
    });

    it('should have 37 audible chord positions (all audible)', () => {
      expect(score._scoreData.audibleChordPositions.length).toBe(EXPECTED_HGW.audible);
    });

    it('should have 128 notes/rests', () => {
      expect(Object.keys(score._scoreData.notesAndRestsById).length).toBe(128);
    });

    it('last measure should have end barline', () => {
      const lastMeasure = score._scoreData.measures[score._scoreData.measures.length - 1];
      expect(lastMeasure.isLastMeasure).toBe(true);
      expect(lastMeasure.rightBarLine).toBe('end');
    });

    it('first note should have pitch 63 (E♭4) on staff 1 layer 1', () => {
      const firstNote = Object.values(score._scoreData.notesAndRestsById)[0];
      expect(firstNote.pitch).toBe(63);
      expect(firstNote.staffNumber).toBe(1);
      expect(firstNote.layerNumber).toBe(1);
      expect(firstNote.isRest).toBe(false);
      expect(firstNote.isAudible).toBe(true);
      expect(firstNote.startQ).toBe(0);
      expect(firstNote.endQ).toBe(1);
      expect(firstNote.durationQ).toBe(1);
      expect(firstNote.chordPosition).toBe(0);
    });

    it('first note should have 4 lyric syllables (one per inline verse)', () => {
      const firstNote = Object.values(score._scoreData.notesAndRestsById)[0];
      expect(firstNote.lyricSyllables).toEqual(['How', 'His', 'By', 'He']);
    });
  });

  // ── SATB partsTemplate ──
  describe('SATB partsTemplate — auto-generated parts', () => {
    it('should have 4 vocal parts (SATB)', () => {
      // SATB template generates soprano, alto, tenor, bass
      expect(score._scoreData.parts.length).toBe(4);
    });

    it('should have soprano, alto, tenor, bass part IDs', () => {
      const partIds = score._scoreData.parts.map(p => p.partId);
      expect(partIds).toContain('soprano');
      expect(partIds).toContain('alto');
      expect(partIds).toContain('tenor');
      expect(partIds).toContain('bass');
    });

    it('all SATB parts should be vocal', () => {
      for (const partId of ['soprano', 'alto', 'tenor', 'bass']) {
        const part = score._scoreData.partsById[partId];
        expect(part.isVocal).toBe(true);
      }
    });

    it('soprano and alto should share staff 1, tenor and bass should share staff 2', () => {
      const soprano = score._scoreData.partsById['soprano'];
      const alto = score._scoreData.partsById['alto'];
      const tenor = score._scoreData.partsById['tenor'];
      const bass = score._scoreData.partsById['bass'];
      expect(soprano.chordPositionRefs['0'].staffNumbers).toContain(1);
      expect(alto.chordPositionRefs['0'].staffNumbers).toContain(1);
      expect(tenor.chordPositionRefs['0'].staffNumbers).toContain(2);
      expect(bass.chordPositionRefs['0'].staffNumbers).toContain(2);
    });

    it('soprano should be the melody part', () => {
      const soprano = score._scoreData.partsById['soprano'];
      expect(soprano.chordPositionRefs['0'].isMelody).toBe(true);
    });

    it('alto, tenor, bass should NOT be the melody part', () => {
      for (const partId of ['alto', 'tenor', 'bass']) {
        const part = score._scoreData.partsById[partId];
        expect(part.chordPositionRefs['0'].isMelody).toBe(false);
      }
    });

    it('should have ch-part-id attributes on notes with all 4 part IDs', () => {
      const allPartIds = new Set();
      for (const note of score._scoreData.meiParsed.querySelectorAll('note[ch-part-id]')) {
        for (const id of note.getAttribute('ch-part-id').split(' ')) {
          if (id) allPartIds.add(id);
        }
      }
      expect(allPartIds).toContain('soprano');
      expect(allPartIds).toContain('alto');
      expect(allPartIds).toContain('tenor');
      expect(allPartIds).toContain('bass');
    });

    it('melody notes should be on staff 1 layer 1', () => {
      const melodyNotes = score._scoreData.meiParsed.querySelectorAll('note[ch-melody]');
      expect(melodyNotes.length).toBe(37);
      for (const note of melodyNotes) {
        const staff = note.closest('staff');
        expect(staff.getAttribute('n')).toBe('1');
        const layer = note.closest('layer');
        expect(layer.getAttribute('n')).toBe('1');
      }
    });
  });

  // ── Pickup measure (3/4 time) ──
  describe('Pickup measure — 3/4 time', () => {
    it('first measure should be a partial-pickup', () => {
      const m = score._scoreData.measures[0];
      expect(m.measureType).toBe('partial-pickup');
      expect(m.durationQ).toBe(1);
    });

    it('last measure should be a partial-pickdown', () => {
      const m = score._scoreData.measures[15];
      expect(m.measureType).toBe('partial-pickdown');
      expect(m.durationQ).toBe(2);
      expect(m.rightBarLine).toBe('end');
    });

    it('pickup + pickdown durations should equal one full measure (3 beats)', () => {
      const pickup = score._scoreData.measures[0].durationQ;
      const pickdown = score._scoreData.measures[15].durationQ;
      expect(pickup + pickdown).toBe(3);
    });

    it('most middle measures should be full measures in 3/4', () => {
      const fullMeasures = score._scoreData.measures.slice(1, 15).filter(
        m => m.measureType === 'full'
      );
      // Some measures may be partial-start/partial-end due to invisible barlines
      // splitting a logical measure into visual halves
      expect(fullMeasures.length).toBeGreaterThanOrEqual(12);
      for (const m of fullMeasures) {
        expect(m.durationQ).toBe(3);
      }
    });
  });

  // ── Sections — lyrics-generated ──
  describe('Sections — from lyrics text', () => {
    it('should have an introduction section', () => {
      const intro = score._scoreData.sections.find(s => s.type === 'introduction');
      expect(intro).toBeDefined();
    });

    it('should have 6 verse sections (4 inline + 2 below)', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      expect(verses.length).toBe(6);
    });

    it('inline verse sections should have sequential markers', () => {
      const inlineVerses = score._scoreData.sections.filter(
        s => s.type === 'verse' && s.placement === 'inline'
      );
      for (let i = 0; i < inlineVerses.length; i++) {
        expect(Number(inlineVerses[i].marker)).toBe(i + 1);
      }
    });

    it('should not have any chorus sections (HGW has only verses)', () => {
      const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
      expect(choruses.length).toBe(0);
    });

    it('lyrics text with 6 verses should produce extra below-placed sections', () => {
      // HGW has 4 inline lyric lines but 6 verses in the text file.
      // Verses 5 and 6 should be placed 'below' since they can't go inline.
      const belowSections = score._scoreData.sections.filter(s => s.placement === 'below');
      expect(belowSections.length).toBe(2);
    });

    it('all inline verse sections should have chordPositionRanges', () => {
      const inlineVerses = score._scoreData.sections.filter(
        s => s.type === 'verse' && s.placement === 'inline'
      );
      for (const verse of inlineVerses) {
        expect(verse.chordPositionRanges.length).toBeGreaterThan(0);
      }
    });

    it('chordPositionRanges should have start and end properties', () => {
      const inlineVerses = score._scoreData.sections.filter(
        s => s.type === 'verse' && s.placement === 'inline'
      );
      for (const verse of inlineVerses) {
        for (const range of verse.chordPositionRanges) {
          expect(range).toHaveProperty('start');
          expect(range).toHaveProperty('end');
          expect(typeof range.start).toBe('number');
          expect(typeof range.end).toBe('number');
        }
      }
    });
  });

  // ── Fermata ──
  describe('Fermata — at chord position 28', () => {
    it('should store the fermata', () => {
      expect(score._scoreData.fermatas).toEqual([
        { chordPosition: 28, durationFactor: 2.5 },
      ]);
    });

    it('fermata chord position should be valid', () => {
      const cp = score._scoreData.fermatas[0].chordPosition;
      expect(cp).toBeGreaterThanOrEqual(0);
      expect(cp).toBeLessThan(score._scoreData.chordPositions.length);
    });
  });

  // ── No chorus or secondary lyrics ──
  describe('No chorus or secondary attributes', () => {
    it('should NOT have ch-chorus attribute (HGW has no chorus sections)', () => {
      const chorusVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-chorus]');
      expect(chorusVerses.length).toBe(0);
    });

    it('should NOT have ch-secondary attribute (no chorus means no secondary lyrics)', () => {
      // ch-secondary is only set on lyrics within a chorus chord position range
      const secondaryVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]');
      expect(secondaryVerses.length).toBe(0);
    });
  });

  // ── Intro brackets (single range) ──
  describe('Intro brackets — single range', () => {
    it('should detect intro brackets', () => {
      expect(score._scoreData.hasIntroBrackets).toBe(true);
    });

    it('should have exactly 2 dir elements with ch-intro-bracket (1 start + 1 end)', () => {
      const introBrackets = score._scoreData.meiParsed.querySelectorAll('dir[ch-intro-bracket]');
      expect(introBrackets.length).toBe(2);
      const starts = Array.from(introBrackets).filter(el => el.getAttribute('ch-intro-bracket') === 'start');
      const ends = Array.from(introBrackets).filter(el => el.getAttribute('ch-intro-bracket') === 'end');
      expect(starts.length).toBe(1);
      expect(ends.length).toBe(1);
    });

    it('start bracket should be before end bracket in chord position order', () => {
      const introBrackets = Array.from(score._scoreData.meiParsed.querySelectorAll('dir[ch-intro-bracket]'));
      const start = introBrackets.find(el => el.getAttribute('ch-intro-bracket') === 'start');
      const end = introBrackets.find(el => el.getAttribute('ch-intro-bracket') === 'end');
      const startCp = parseInt(start.getAttribute('ch-chord-position'));
      const endCp = parseInt(end.getAttribute('ch-chord-position'));
      expect(startCp).toBeLessThan(endCp);
    });

    it('intro bracket should be near the end of the score (measures 13–16)', () => {
      const start = score._scoreData.meiParsed.querySelector('dir[ch-intro-bracket="start"]');
      const startCp = parseInt(start.getAttribute('ch-chord-position'));
      // Chord position 28 is roughly at measure 13 in a 37-CP score
      expect(startCp).toBeGreaterThanOrEqual(28);
    });
  });

  // ── Lyric line IDs ──
  describe('Lyric line IDs', () => {
    it('should have verse elements with ch-lyric-line-id', () => {
      const verses = score._scoreData.meiParsed.querySelectorAll('verse[ch-lyric-line-id]');
      expect(verses.length).toBeGreaterThan(0);
    });

    it('should have 4 distinct lyric line IDs (4 inline verse lines)', () => {
      const lyricLineIds = new Set();
      for (const verse of score._scoreData.meiParsed.querySelectorAll('verse[ch-lyric-line-id]')) {
        lyricLineIds.add(verse.getAttribute('ch-lyric-line-id'));
      }
      expect(lyricLineIds.size).toBe(4);
    });
  });

  // ── ch-section-id ──
  describe('ch-section-id — verse section association', () => {
    it('should have ch-section-id on verse elements', () => {
      const versesWithSectionId = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]');
      expect(versesWithSectionId.length).toBeGreaterThan(0);
    });

    it('should have hasLyricSectionIds true', () => {
      expect(score._scoreData.hasLyricSectionIds).toBe(true);
    });

    it('section IDs should reference known sections', () => {
      const knownSectionIds = new Set(score._scoreData.sections.map(s => s.sectionId));
      for (const verse of score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]')) {
        for (const sId of verse.getAttribute('ch-section-id').split(' ')) {
          expect(knownSectionIds.has(sId)).toBe(true);
        }
      }
    });
  });

  // ── expandScore intro ──
  describe('expandScore intro — single intro bracket range', () => {
    beforeAll(() => { score.setOptions({ expandScore: 'intro' }); });
    afterAll(() => { resetScoreState(score); });

    it('should create an introduction section element', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      expect(introSection).not.toBeNull();
    });

    it('introduction section should be placed after scoreDef', () => {
      const scoreDef = score._scoreData.meiParsed.querySelector('scoreDef');
      const nextSibling = scoreDef.nextElementSibling;
      expect(nextSibling.getAttribute('type')).toBe('introduction');
    });

    it('should have notes with -intro suffixed IDs in the introduction', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      const notes = introSection.querySelectorAll('note');
      expect(notes.length).toBeGreaterThan(0);
      const hasIntroSuffix = Array.from(notes).some(n => n.getAttribute('xml:id')?.includes('-intro'));
      expect(hasIntroSuffix).toBe(true);
    });

    it('introduction section should have exactly 26 notes', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      const notes = introSection.querySelectorAll('note');
      expect(notes.length).toBe(26);
    });

    it('should remove verse and dir elements from the introduction', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      expect(introSection.querySelectorAll('verse').length).toBe(0);
      expect(introSection.querySelectorAll('dir').length).toBe(0);
    });

    it('should have 4 measures inside the introduction section', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      const measures = introSection.querySelectorAll('measure');
      expect(measures.length).toBe(4);
    });

    it('should have ch-chord-position attribute on the introduction section element', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      expect(introSection.hasAttribute('ch-chord-position')).toBe(true);
      const cpValues = introSection.getAttribute('ch-chord-position').trim().split(' ');
      expect(cpValues.length).toBeGreaterThan(0);
    });

    it('should remove intro brackets from the main score after intro expansion', () => {
      const mainBrackets = score._scoreData.meiParsed.querySelectorAll(
        'section:not([type="introduction"]) [ch-intro-bracket]'
      );
      expect(mainBrackets.length).toBe(0);
    });

    it('should restore intro brackets when expandScore is set back to false', () => {
      score.setOptions({ expandScore: false });
      const introBrackets = score._scoreData.meiParsed.querySelectorAll('dir[ch-intro-bracket]');
      expect(introBrackets.length).toBe(2);
    });
  });

  // ── expandScore full-score ──
  describe('expandScore full-score — multi-verse expansion', () => {
    beforeAll(() => { score.setOptions({ expandScore: 'full-score' }); });
    afterAll(() => { resetScoreState(score); });

    it('should expand from 16 to more measures', () => {
      const measuresAfter = score._scoreData.meiParsed.querySelectorAll('measure').length;
      expect(measuresAfter).toBeGreaterThan(16);
    });

    it('should create -rend suffixed section IDs', () => {
      const sections = score._scoreData.meiParsed.querySelectorAll('section');
      const rendSections = Array.from(sections).filter(
        s => (s.getAttribute('xml:id') || '').includes('-rend')
      );
      expect(rendSections.length).toBeGreaterThan(0);
    });

    it('should have an introduction section in the expanded score', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      expect(introSection).not.toBeNull();
    });

    it('should restore original 16 measures when expandScore is set back to false', () => {
      score.setOptions({ expandScore: false });
      const measuresRestored = score._scoreData.meiParsed.querySelectorAll('measure').length;
      expect(measuresRestored).toBe(16);
      score.setOptions({ expandScore: 'full-score' });
    });

    it('should assign ch-expanded-chord-position on notes', () => {
      const notesWithEcp = score._scoreData.meiParsed.querySelectorAll('[ch-expanded-chord-position]');
      expect(notesWithEcp.length).toBeGreaterThan(0);
    });

    it('expanded score should have at least 5 sections (intro + 4 verses)', () => {
      // Each inline verse gets its own section with duplicated measures
      const sections = score._scoreData.meiParsed.querySelectorAll('section');
      // Introduction + 4 inline verses = at least 5 sections
      expect(sections.length).toBeGreaterThanOrEqual(5);
    });

    it('should remove intro brackets from the expanded full score', () => {
      const intraBrackets = score._scoreData.meiParsed.querySelectorAll(
        'section:not([type="introduction"]) [ch-intro-bracket]'
      );
      expect(intraBrackets.length).toBe(0);
    });
  });

  // ── hideSectionIds ──
  describe('hideSectionIds — verse hiding', () => {
    afterEach(() => { resetScoreState(score); });

    it('should keep all 2 staves when no sections are hidden', () => {
      const staffDefs = score._scoreData.meiParsed.querySelectorAll('staffDef');
      expect(staffDefs.length).toBe(2);
    });

    it('should remove verses for hidden sections', () => {
      const versesBefore = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      const firstSection = score._scoreData.sections.find(s => s.type === 'verse');
      score.setOptions({ hideSectionIds: [firstSection.sectionId] });
      const versesAfter = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      expect(versesAfter).toBeLessThan(versesBefore);
    });

    it('should still have 2 staves after hiding a section (no staff removal needed)', () => {
      const firstSection = score._scoreData.sections.find(s => s.type === 'verse');
      score.setOptions({ hideSectionIds: [firstSection.sectionId] });
      const staffDefs = score._scoreData.meiParsed.querySelectorAll('staffDef');
      // HGW uses staff 1 and 2 for all sections, so no staff should be removed
      expect(staffDefs.length).toBe(2);
    });

    it('should restore all verses when hideSectionIds is cleared', () => {
      const versesBefore = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      const firstSection = score._scoreData.sections.find(s => s.type === 'verse');
      score.setOptions({ hideSectionIds: [firstSection.sectionId] });
      score.setOptions({ hideSectionIds: [] });
      const versesRestored = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      expect(versesRestored).toBe(versesBefore);
    });
  });

  // ── showMelodyOnly ──
  describe('showMelodyOnly — SATB layout', () => {
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

    it('melody should be on staff 1 (soprano)', () => {
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

  // ── Chord position internal structure ──
  describe('Chord position internal structure', () => {
    it('CP[0] should have correct timing values (pickup beat)', () => {
      const cp = score._scoreData.chordPositions[0];
      expect(cp.chordPosition).toBe(0);
      expect(cp.startQ).toBe(0);
      expect(cp.endQ).toBe(1);
      expect(cp.durationQ).toBe(1);
      expect(cp.isAudible).toBe(true);
      expect(cp.isDownbeat).toBe(false);
    });

    it('CP[0] should have 4 notesAndRests (SATB)', () => {
      const cp = score._scoreData.chordPositions[0];
      expect(cp.notesAndRests.length).toBe(4);
    });

    it('CP[0] melodyNote should have pitch 63 with 4 lyric syllables', () => {
      const cp = score._scoreData.chordPositions[0];
      expect(cp.melodyNote).not.toBeNull();
      expect(cp.melodyNote.pitch).toBe(63);
      expect(cp.melodyNote.isMelody).toBe(true);
      expect(cp.melodyNote.lyricSyllables).toEqual(['How', 'His', 'By', 'He']);
    });

    it('CP[0] expandedChordPositions should map to 4 verses', () => {
      const cp = score._scoreData.chordPositions[0];
      expect(cp.expandedChordPositions).toEqual({
        'verse-1': [8], 'verse-2': [45], 'verse-3': [82], 'verse-4': [119],
      });
    });

    it('CP[18] (midpoint) should be a downbeat at startQ=19', () => {
      const cp = score._scoreData.chordPositions[18];
      expect(cp.chordPosition).toBe(18);
      expect(cp.startQ).toBe(19);
      expect(cp.endQ).toBe(21);
      expect(cp.durationQ).toBe(2);
      expect(cp.isDownbeat).toBe(true);
    });

    it('last CP should be at chordPosition 36', () => {
      const cp = score._scoreData.chordPositions[36];
      expect(cp.chordPosition).toBe(36);
      expect(cp.startQ).toBe(40);
      expect(cp.endQ).toBe(42);
      expect(cp.durationQ).toBe(2);
      expect(cp.isDownbeat).toBe(true);
      expect(cp.isAudible).toBe(true);
    });

    it('last CP expandedChordPositions should include introduction', () => {
      const cp = score._scoreData.chordPositions[36];
      expect(cp.expandedChordPositions).toEqual({
        'introduction': [7], 'verse-1': [44], 'verse-2': [81],
        'verse-3': [118], 'verse-4': [155],
      });
    });
  });

  // ── Expanded chord positions ──
  describe('Expanded chord positions', () => {
    it('should have 156 expanded chord positions', () => {
      expect(score._scoreData.expandedChordPositions.length).toBe(EXPECTED_HGW.expanded);
    });

    it('all expanded chord positions should be audible', () => {
      expect(score._scoreData.audibleExpandedChordPositions.length).toBe(EXPECTED_HGW.audibleExpanded);
    });

    it('each expanded chord position should reference a valid section', () => {
      for (const ecp of score._scoreData.expandedChordPositions) {
        expect(ecp.sectionId).toBeDefined();
        expect(score._scoreData.sectionsById[ecp.sectionId]).toBeDefined();
      }
    });
  });
});

// ============================================================
// HGW loaded without partsTemplate or lyrics (plain MusicXML only)
// ============================================================
describe('How Great — plain load (no partsTemplate)', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  it('should still have 2 staves without partsTemplate', () => {
    expect(score._scoreData.staffNumbers).toEqual([1, 2]);
  });

  it('should detect intro brackets from the MusicXML', () => {
    expect(score._scoreData.hasIntroBrackets).toBe(true);
  });

  it('should detect 4 inline verse numbers from embedded lyrics', () => {
    const inlineVerses = score._scoreData.sections.filter(
      s => s.type === 'verse' && s.placement === 'inline'
    );
    expect(inlineVerses.length).toBe(4);
  });

  it('should not have chorus sections (HGW is all verses)', () => {
    const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
    expect(choruses.length).toBe(0);
  });

  it('should auto-generate an introduction section from intro brackets', () => {
    const intro = score._scoreData.sections.find(s => s.type === 'introduction');
    expect(intro).toBeDefined();
  });
});

// ============================================================
// HGW with lyrics extraction
// ============================================================
describe('How Great — lyrics extraction from text file', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  it('should store the lyrics text', () => {
    expect(score._scoreData.lyricsText).toBe(sampleLyrics);
  });

  it('should have verse sections from lyrics (6 total)', () => {
    const verses = score._scoreData.sections.filter(s => s.type === 'verse');
    expect(verses.length).toBe(6);
  });

  it('should place extra verses below the score', () => {
    // 4 inline + 2 below = 6 verses in the lyrics file
    const belowVerses = score._scoreData.sections.filter(
      s => s.type === 'verse' && s.placement === 'below'
    );
    expect(belowVerses.length).toBe(2);
  });

  it('verse sections should have sequential markers', () => {
    const verses = score._scoreData.sections.filter(s => s.type === 'verse');
    for (let i = 0; i < verses.length; i++) {
      expect(Number(verses[i].marker)).toBe(i + 1);
    }
  });

  it('below sections should have annotatedLyrics', () => {
    const belowSections = score._scoreData.sections.filter(s => s.placement === 'below');
    for (const section of belowSections) {
      expect(section.annotatedLyrics).toBeDefined();
      expect(section.annotatedLyrics).not.toBeNull();
    }
  });
});
