/**
 * Tests: "It Is Well with My Soul" — features unique to this score.
 *
 * Covers:
 * - Descant (separate staff used only in verse 4 chorus)
 * - Staff hiding when all sections using a staff are hidden
 * - Chorus sections with ch-chorus attribute
 * - Secondary lyrics (ch-secondary) in the chorus
 * - Two separate intro bracket ranges
 * - Multiple chordPositionRanges in a single section (introduction)
 * - 3-staff score (descant + piano treble + piano bass)
 * - Parts with chordPositionRef changes mid-score
 * - Pickup measure that starts mid-beat
 * - Fermatas
 * - Lyrics from external text file (verse/chorus structure)
 */

import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import './setup.js';
import {
  initChScore, setupStandardHooks, resetScoreState,
} from './helpers.js';
import {
  sampleMusicXmlIIW as iiwMusicXml, sampleLyricsIIW as iiwLyrics,
  EXPECTED_IIW, iiwFermatas, iiwParts, iiwSections,
} from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// ============================================================
// Shared fixture: IIW loaded with parts, sections, lyrics, fermatas
// ============================================================
describe('It Is Well with My Soul — shared fixture', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: iiwMusicXml,
      lyricsText: iiwLyrics,
      parts: iiwParts,
      sections: iiwSections,
      fermatas: iiwFermatas,
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  // ── Basic score structure ──
  describe('Basic score structure', () => {
    it('should have 3 staves (descant + piano treble + piano bass)', () => {
      expect(score._scoreData.staffNumbers).toEqual([1, 2, 3]);
    });

    it('should have 24 measures', () => {
      expect(score._scoreData.measures.length).toBe(24);
    });

    it('should be in C major', () => {
      const ksi = score._scoreData.keySignatureInfo;
      expect(ksi.keySignatureId).toBe('c-major');
      expect(ksi.mxlFifths).toBe('0');
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

    it('should be in 4/4 time', () => {
      expect(score._scoreData.measures[0].timeSignature).toEqual([4, 4]);
    });

    it('should have 64 chord positions', () => {
      expect(score._scoreData.chordPositions.length).toBe(EXPECTED_IIW.total);
    });

    it('should have 64 audible chord positions (all audible)', () => {
      expect(score._scoreData.audibleChordPositions.length).toBe(EXPECTED_IIW.audible);
    });

    it('should have 247 notes/rests', () => {
      expect(Object.keys(score._scoreData.notesAndRestsById).length).toBe(247);
    });

    it('first note should have pitch 67 (G4) on staff 2 layer 1', () => {
      // First chord position = pickup beat; melody is soprano on staff 2
      const cp0 = score._scoreData.chordPositions[0];
      expect(cp0.melodyNote).toBeDefined();
      expect(cp0.melodyNote.pitch).toBe(67);
      expect(cp0.melodyNote.staffNumber).toBe(2);
      expect(cp0.melodyNote.layerNumber).toBe(1);
    });

    it('should store the fermata at chord position 41', () => {
      expect(score._scoreData.fermatas).toEqual(iiwFermatas);
    });

    it('should have hasRepeatOrJump false (no repeats in the MusicXML)', () => {
      expect(score._scoreData.hasRepeatOrJump).toBe(false);
    });
  });

  // ── Sections ──
  describe('Sections', () => {
    it('should have 9 sections (intro + 4 verses + 4 choruses)', () => {
      expect(score._scoreData.sections.length).toBe(9);
    });

    it('should have section types in the correct order', () => {
      const types = score._scoreData.sections.map(s => s.type);
      expect(types).toEqual([
        'introduction', 'verse', 'chorus', 'verse', 'chorus',
        'verse', 'chorus', 'verse', 'chorus',
      ]);
    });

    it('should have 4 chorus-type sections', () => {
      const chorusSections = score._scoreData.sections.filter(s => s.type === 'chorus');
      expect(chorusSections.length).toBe(4);
    });

    it('should include staff 1 (descant) only in chorus-4', () => {
      for (const section of score._scoreData.sections) {
        const allStaffNumbers = new Set();
        for (const range of section.chordPositionRanges) {
          for (const sn of range.staffNumbers) allStaffNumbers.add(sn);
        }
        if (section.sectionId === 'chorus-4') {
          expect(allStaffNumbers.has(1)).toBe(true);
        } else {
          expect(allStaffNumbers.has(1)).toBe(false);
        }
      }
    });

    it('introduction should have two separate chordPositionRanges', () => {
      const intro = score._scoreData.sections.find(s => s.type === 'introduction');
      expect(intro.chordPositionRanges.length).toBe(2);
      expect(intro.chordPositionRanges[0]).toEqual({ start: 0, end: 13, staffNumbers: [2, 3], lyricLineIds: [] });
      expect(intro.chordPositionRanges[1]).toEqual({ start: 55, end: 64, staffNumbers: [2, 3], lyricLineIds: [] });
    });
  });

  // ── ch-chorus attribute ──
  describe('ch-chorus — MEI annotation', () => {
    it('should set ch-chorus on verse elements in the chorus section', () => {
      const chorusVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-chorus]');
      expect(chorusVerses.length).toBeGreaterThan(0);
    });

    it('should not set ch-chorus on verse elements outside the chorus', () => {
      // Verse elements with ch-chorus should only be in the chorus chord position range (42–63)
      const chorusVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-chorus]');
      for (const verse of chorusVerses) {
        const noteOrChord = verse.closest('[ch-chord-position]');
        const cp = parseInt(noteOrChord.getAttribute('ch-chord-position'));
        expect(cp).toBeGreaterThanOrEqual(42);
      }
    });

    it('should have ch-chorus as a boolean attribute (empty string)', () => {
      const chorusVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-chorus]');
      for (const verse of chorusVerses) {
        expect(verse.getAttribute('ch-chorus')).toBe('');
      }
    });
  });

  // ── ch-secondary attribute (chorus secondary lyrics) ──
  describe('ch-secondary — chorus secondary lyrics', () => {
    it('should set ch-secondary on non-melody lyrics in the chorus', () => {
      const secondaryVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]');
      expect(secondaryVerses.length).toBeGreaterThan(0);
    });

    it('ch-secondary should only appear on notes that are not the melody', () => {
      const secondaryVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]');
      for (const verse of secondaryVerses) {
        const parent = verse.closest('[ch-chord-position]');
        expect(parent.hasAttribute('ch-melody')).toBe(false);
        expect(parent.querySelector('[ch-melody]')).toBeNull();
      }
    });

    it('should have both ch-secondary and ch-chorus on some verse elements', () => {
      const secondaryChorusVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary][ch-chorus]');
      expect(secondaryChorusVerses.length).toBeGreaterThan(0);
    });

    it('secondary chorus lyrics should be shifted to line 2 (improved appearance)', () => {
      // Check that verses with both ch-chorus and ch-secondary have n=2
      const secondaryChorusVerses = score._scoreData.meiParsed.querySelectorAll('verse[ch-secondary][ch-chorus]');
      for (const verse of secondaryChorusVerses) {
        expect(verse.getAttribute('n')).toBe('2');
      }
    });
  });

  // ── Intro brackets ──
  describe('Intro brackets — two ranges', () => {
    it('should detect intro brackets', () => {
      expect(score._scoreData.hasIntroBrackets).toBe(true);
    });

    it('should have exactly four dir elements with ch-intro-bracket (2 starts + 2 ends)', () => {
      const introBrackets = score._scoreData.meiParsed.querySelectorAll('dir[ch-intro-bracket]');
      expect(introBrackets.length).toBe(4);
      const starts = Array.from(introBrackets).filter(el => el.getAttribute('ch-intro-bracket') === 'start');
      const ends = Array.from(introBrackets).filter(el => el.getAttribute('ch-intro-bracket') === 'end');
      expect(starts.length).toBe(2);
      expect(ends.length).toBe(2);
    });

    it('should have start bracket chord position <= end bracket chord position for each range', () => {
      const introBrackets = Array.from(score._scoreData.meiParsed.querySelectorAll('dir[ch-intro-bracket]'));
      const starts = introBrackets.filter(el => el.getAttribute('ch-intro-bracket') === 'start');
      const ends = introBrackets.filter(el => el.getAttribute('ch-intro-bracket') === 'end');
      for (let i = 0; i < starts.length; i++) {
        const startCp = parseInt(starts[i].getAttribute('ch-chord-position'));
        const endCp = parseInt(ends[i].getAttribute('ch-chord-position'));
        expect(startCp).toBeLessThanOrEqual(endCp);
      }
    });

    it('should have valid ch-chord-position on all intro bracket dir elements', () => {
      const introBrackets = score._scoreData.meiParsed.querySelectorAll('dir[ch-intro-bracket]');
      for (const bracket of introBrackets) {
        const cp = parseInt(bracket.getAttribute('ch-chord-position'));
        expect(cp).toBeGreaterThanOrEqual(0);
        expect(cp).toBeLessThanOrEqual(score._scoreData.chordPositions.length);
      }
    });
  });

  // ── Descant (staff 1) ──
  describe('Descant — staff 1', () => {
    it('should have notes on staff 1 (descant staff)', () => {
      const staff1Notes = score._scoreData.meiParsed.querySelectorAll('staff[n="1"] note');
      expect(staff1Notes.length).toBeGreaterThan(0);
    });

    it('descant notes should have ch-part-id=descant', () => {
      const staff1Notes = score._scoreData.meiParsed.querySelectorAll('staff[n="1"] note[ch-part-id]');
      for (const note of staff1Notes) {
        expect(note.getAttribute('ch-part-id')).toContain('descant');
      }
    });

    it('descant notes should NOT have ch-melody', () => {
      const staff1Notes = score._scoreData.meiParsed.querySelectorAll('staff[n="1"] note');
      for (const note of staff1Notes) {
        expect(note.hasAttribute('ch-melody')).toBe(false);
      }
    });

    it('melody notes should be on staff 2 (soprano)', () => {
      const melodyNotes = score._scoreData.meiParsed.querySelectorAll('note[ch-melody]');
      expect(melodyNotes.length).toBeGreaterThan(0);
      for (const note of melodyNotes) {
        const staff = note.closest('staff');
        expect(staff.getAttribute('n')).toBe('2');
      }
    });
  });

  // ── ch-part-id — multiple part IDs ──
  describe('ch-part-id — part assignments', () => {
    it('should have 5 distinct part IDs', () => {
      const allPartIds = new Set();
      for (const note of score._scoreData.meiParsed.querySelectorAll('note[ch-part-id]')) {
        for (const id of note.getAttribute('ch-part-id').split(' ')) {
          if (id) allPartIds.add(id);
        }
      }
      expect(allPartIds.size).toBe(5);
      expect(allPartIds).toContain('descant');
      expect(allPartIds).toContain('soprano');
      expect(allPartIds).toContain('alto');
      expect(allPartIds).toContain('tenor');
      expect(allPartIds).toContain('bass');
    });
  });

  // ── Pickup measure ──
  describe('Pickup measure', () => {
    it('first measure should be a partial-pickup', () => {
      const m = score._scoreData.measures[0];
      expect(m.measureType).toBe('partial-pickup');
      expect(m.isFirstMeasure).toBe(true);
    });

    it('first measure should be in 4/4 time', () => {
      const m = score._scoreData.measures[0];
      expect(m.timeSignature).toEqual([4, 4]);
    });

    it('last measure should have end barline', () => {
      const lastMeasure = score._scoreData.measures[score._scoreData.measures.length - 1];
      expect(lastMeasure.isLastMeasure).toBe(true);
      expect(lastMeasure.rightBarLine).toBe('end');
    });
  });

  // ── Lyric line IDs ──
  describe('Lyric line IDs', () => {
    it('should have verse elements with ch-lyric-line-id', () => {
      const verses = score._scoreData.meiParsed.querySelectorAll('verse[ch-lyric-line-id]');
      expect(verses.length).toBeGreaterThan(0);
    });

    it('should have lyrics on staff 1 (descant) and staff 2 (piano treble)', () => {
      const lyricLineIds = new Set();
      for (const verse of score._scoreData.meiParsed.querySelectorAll('verse[ch-lyric-line-id]')) {
        lyricLineIds.add(verse.getAttribute('ch-lyric-line-id'));
      }
      // Staff 1 lyrics (descant): 1.1
      // Staff 2 lyrics (verse + chorus): 2.1, 2.2, 2.3, 2.4
      // Staff 3 lyrics (bass clef chorus): 3.1
      const hasStaff1 = Array.from(lyricLineIds).some(id => id.startsWith('1.'));
      const hasStaff2 = Array.from(lyricLineIds).some(id => id.startsWith('2.'));
      expect(hasStaff1).toBe(true);
      expect(hasStaff2).toBe(true);
    });
  });

  // ── ch-section-id ──
  describe('ch-section-id — verse/chorus section association', () => {
    it('should have ch-section-id on verse elements', () => {
      const versesWithSectionId = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]');
      expect(versesWithSectionId.length).toBeGreaterThan(0);
    });

    it('should contain section IDs matching the loaded sections', () => {
      const knownSectionIds = score._scoreData.sections.map(s => s.sectionId);
      for (const verse of score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]')) {
        for (const sectionId of verse.getAttribute('ch-section-id').split(' ')) {
          expect(knownSectionIds).toContain(sectionId);
        }
      }
    });

    it('should have hasLyricSectionIds true', () => {
      expect(score._scoreData.hasLyricSectionIds).toBe(true);
    });
  });

  // ── expandScore intro — two intro bracket ranges ──
  describe('expandScore intro — two intro bracket ranges', () => {
    beforeAll(() => { score.setOptions({ expandScore: 'intro' }); });
    afterAll(() => { resetScoreState(score); });

    it('should create an introduction section element', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      expect(introSection).not.toBeNull();
    });

    it('should have the introduction section placed after scoreDef', () => {
      const scoreDef = score._scoreData.meiParsed.querySelector('scoreDef');
      const nextSibling = scoreDef.nextElementSibling;
      expect(nextSibling.getAttribute('type')).toBe('introduction');
    });

    it('should have measures from both bracket ranges in the introduction', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      const measures = introSection.querySelectorAll('measure');
      // Two intro bracket ranges contribute measures: first range (cp 0–13) and second range (cp 55–64)
      expect(measures.length).toBeGreaterThan(1);
      // Introduction chord positions should span both ranges
      const cpAttr = introSection.getAttribute('ch-chord-position');
      const cpValues = cpAttr.trim().split(' ').map(Number);
      const hasFirstRange = cpValues.some(cp => cp <= 13);
      const hasSecondRange = cpValues.some(cp => cp >= 55);
      expect(hasFirstRange).toBe(true);
      expect(hasSecondRange).toBe(true);
    });

    it('should have ch-chord-position on the introduction section element', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      expect(introSection.hasAttribute('ch-chord-position')).toBe(true);
      const cpValues = introSection.getAttribute('ch-chord-position').trim().split(' ').map(Number);
      expect(cpValues.length).toBeGreaterThan(0);
    });

    it('should have notes with -intro suffixed IDs', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      const notes = introSection.querySelectorAll('note');
      expect(notes.length).toBeGreaterThan(0);
      const hasIntroSuffix = Array.from(notes).some(n => n.getAttribute('xml:id')?.includes('-intro'));
      expect(hasIntroSuffix).toBe(true);
    });

    it('should remove verse and dir elements from the introduction', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      expect(introSection.querySelectorAll('verse').length).toBe(0);
      expect(introSection.querySelectorAll('dir').length).toBe(0);
    });

    it('should remove intro brackets from the main score after expansion', () => {
      // Intro brackets are removed from the main score when extracting the intro
      const mainBrackets = score._scoreData.meiParsed.querySelectorAll('section:not([type="introduction"]) [ch-intro-bracket]');
      expect(mainBrackets.length).toBe(0);
    });

    it('should restore intro brackets when expandScore is set back to false', () => {
      score.setOptions({ expandScore: false });
      const introBrackets = score._scoreData.meiParsed.querySelectorAll('dir[ch-intro-bracket]');
      expect(introBrackets.length).toBe(4);
      score.setOptions({ expandScore: 'intro' }); // re-apply for subsequent tests
    });

    it('should only keep introduction staffNumbers (2, 3) in the intro section', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      const staves = introSection.querySelectorAll('staff');
      for (const staff of staves) {
        const n = staff.getAttribute('n');
        expect(['2', '3']).toContain(n);
      }
    });
  });

  // ── expandScore full-score ──
  describe('expandScore full-score', () => {
    beforeAll(() => { score.setOptions({ expandScore: 'full-score' }); });
    afterAll(() => { resetScoreState(score); });

    it('should expand measures for intro + 4 verses + 4 choruses', () => {
      const measures = score._scoreData.meiParsed.querySelectorAll('measure').length;
      expect(measures).toBeGreaterThan(24); // expanded from original 24
    });

    it('should create -rend suffixed section IDs', () => {
      const sections = score._scoreData.meiParsed.querySelectorAll('section');
      const rendSections = Array.from(sections).filter(s => {
        const id = s.getAttribute('xml:id') || '';
        return id.includes('-rend');
      });
      expect(rendSections.length).toBeGreaterThan(0);
    });

    it('should have introduction section with measures from both bracket ranges', () => {
      const introSection = score._scoreData.meiParsed.querySelector('section[type="introduction"]');
      expect(introSection).not.toBeNull();
      const introMeasures = introSection.querySelectorAll('measure');
      expect(introMeasures.length).toBeGreaterThan(1);
    });

    it('should restore original measure count when expandScore is set back to false', () => {
      score.setOptions({ expandScore: false });
      const measuresRestored = score._scoreData.meiParsed.querySelectorAll('measure').length;
      expect(measuresRestored).toBe(24);
      score.setOptions({ expandScore: 'full-score' });
    });

    it('should remove intro bracket elements after full expansion', () => {
      const introBrackets = score._scoreData.meiParsed.querySelectorAll('[ch-intro-bracket]');
      expect(introBrackets.length).toBe(0);
    });

    it('should assign ch-expanded-chord-position on notes', () => {
      const notesWithEcp = score._scoreData.meiParsed.querySelectorAll('[ch-expanded-chord-position]');
      expect(notesWithEcp.length).toBeGreaterThan(0);
    });
  });

  // ── hideSectionIds — staff hiding ──
  describe('hideSectionIds — staff hiding for descant', () => {
    afterEach(() => { resetScoreState(score); });

    it('should keep all 3 staves when no sections are hidden', () => {
      const staffDefs = score._scoreData.meiParsed.querySelectorAll('staffDef');
      expect(staffDefs.length).toBe(3);
    });

    it('should keep all 3 staves when only verse-1 is hidden (staff 1 still needed for chorus-4)', () => {
      score.setOptions({ hideSectionIds: ['verse-1'] });
      const staffDefs = score._scoreData.meiParsed.querySelectorAll('staffDef');
      expect(staffDefs.length).toBe(3);
    });

    it('should remove staff 1 when chorus-4 is hidden (descant staff unused)', () => {
      score.setOptions({ hideSectionIds: ['chorus-4'] });
      const staffDefs = score._scoreData.meiParsed.querySelectorAll('staffDef');
      expect(staffDefs.length).toBe(2);
      const staffNumbers = Array.from(staffDefs).map(sd => sd.getAttribute('n'));
      expect(staffNumbers).not.toContain('1');
      expect(staffNumbers).toContain('2');
      expect(staffNumbers).toContain('3');
    });

    it('should remove staff 1 when all sections using staff 1 are hidden', () => {
      // Only chorus-4 uses staff 1, so hiding it should remove the staff
      score.setOptions({ hideSectionIds: ['chorus-4'] });
      const staff1Elements = score._scoreData.meiParsed.querySelectorAll('staff[n="1"]');
      expect(staff1Elements.length).toBe(0);
    });

    it('should restore staff 1 when hideSectionIds is cleared', () => {
      score.setOptions({ hideSectionIds: ['chorus-4'] });
      expect(score._scoreData.meiParsed.querySelectorAll('staffDef[n="1"]').length).toBe(0);

      score.setOptions({ hideSectionIds: [] });
      expect(score._scoreData.meiParsed.querySelectorAll('staffDef[n="1"]').length).toBe(1);
    });

    it('should remove verses for hidden sections', () => {
      const versesBefore = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      score.setOptions({ hideSectionIds: ['verse-1'] });
      const versesAfter = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      expect(versesAfter).toBeLessThan(versesBefore);
    });

    it('should keep shared chorus lyrics when only one chorus is hidden', () => {
      // Chorus lyrics have ch-section-id="chorus-1 chorus-2 chorus-3 chorus-4" (shared).
      // Hiding only chorus-1 should NOT remove them because chorus-2/3/4 are still visible.
      const matchesChorus1 = (el) => el.getAttribute('ch-section-id').split(' ').includes('chorus-1');
      const chorusVersesBefore = Array.from(
        score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]')
      ).filter(matchesChorus1).length;
      expect(chorusVersesBefore).toBeGreaterThan(0);

      score.setOptions({ hideSectionIds: ['chorus-1'] });

      const chorusVersesAfter = Array.from(
        score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]')
      ).filter(matchesChorus1).length;
      // Shared lyrics remain because other choruses still need them
      expect(chorusVersesAfter).toBe(chorusVersesBefore);
    });

    it('should remove chorus lyrics when ALL chorus sections are hidden', () => {
      const matchesAnyChorus = (el) =>
        el.getAttribute('ch-section-id').split(' ').some(id => id.startsWith('chorus-'));
      const chorusVersesBefore = Array.from(
        score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]')
      ).filter(matchesAnyChorus).length;
      expect(chorusVersesBefore).toBeGreaterThan(0);

      score.setOptions({ hideSectionIds: ['chorus-1', 'chorus-2', 'chorus-3', 'chorus-4'] });

      const chorusVersesAfter = Array.from(
        score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]')
      ).filter(matchesAnyChorus).length;
      expect(chorusVersesAfter).toBe(0);
    });

    it('should hide multiple sections simultaneously', () => {
      const versesBefore = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      score.setOptions({ hideSectionIds: ['verse-1', 'verse-2', 'chorus-1', 'chorus-2'] });
      const versesAfter = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      expect(versesAfter).toBeGreaterThan(0);
      expect(versesAfter).toBeLessThan(versesBefore);
    });

    it('should restore all sections when hideSectionIds is cleared after hiding multiple', () => {
      const versesBefore = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      score.setOptions({ hideSectionIds: ['verse-1', 'verse-2', 'chorus-1', 'chorus-2'] });
      score.setOptions({ hideSectionIds: [] });
      const versesRestored = score._scoreData.meiParsed.querySelectorAll('verse[ch-section-id]').length;
      expect(versesRestored).toBe(versesBefore);
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

    it('CP[0] should have 5 notesAndRests (SATB + descant)', () => {
      const cp = score._scoreData.chordPositions[0];
      // Descant staff is present from CP 0 (before CP 42 where chordPositionRefs change)
      // but only active in chorus-4; at CP 0 the descant staff still contributes a note/rest
      expect(cp.notesAndRests.length).toBe(5);
    });

    it('CP[0] melodyNote should have pitch 67 (G4)', () => {
      const cp = score._scoreData.chordPositions[0];
      expect(cp.melodyNote).not.toBeNull();
      expect(cp.melodyNote.pitch).toBe(67);
      expect(cp.melodyNote.isMelody).toBe(true);
    });

    it('last CP should be at chordPosition 63', () => {
      const cp = score._scoreData.chordPositions[63];
      expect(cp.chordPosition).toBe(63);
      expect(cp.startQ).toBe(81);
      expect(cp.endQ).toBe(84);
      expect(cp.isDownbeat).toBe(true);
      expect(cp.isAudible).toBe(true);
    });
  });

  // ── Expanded chord positions ──
  describe('Expanded chord positions', () => {
    it('should have 278 expanded chord positions', () => {
      expect(score._scoreData.expandedChordPositions.length).toBe(EXPECTED_IIW.expanded);
    });

    it('all expanded chord positions should be audible', () => {
      expect(score._scoreData.audibleExpandedChordPositions.length).toBe(EXPECTED_IIW.audibleExpanded);
    });

    it('each expanded chord position should reference a valid section', () => {
      for (const ecp of score._scoreData.expandedChordPositions) {
        expect(ecp.sectionId).toBeDefined();
        expect(score._scoreData.sectionsById[ecp.sectionId]).toBeDefined();
      }
    });
  });

  // ── showMelodyOnly ──
  describe('showMelodyOnly — with descant staff', () => {
    beforeAll(() => { score.setOptions({ showMelodyOnly: true }); });
    afterAll(() => { resetScoreState(score); });

    it('should reduce to 1 staff per measure when showMelodyOnly is enabled', () => {
      const measures = score._scoreData.meiParsed.querySelectorAll('measure');
      for (const measure of measures) {
        expect(measure.querySelectorAll('staff').length).toBe(1);
      }
    });

    it('should only keep melody notes (ch-melody) when showMelodyOnly is enabled', () => {
      const notes = score._scoreData.meiParsed.querySelectorAll('note');
      for (const note of notes) {
        expect(note.hasAttribute('ch-melody')).toBe(true);
      }
    });

    it('should place melody on staff 2 (soprano) not staff 1 (descant)', () => {
      const staves = score._scoreData.meiParsed.querySelectorAll('staff');
      for (const staff of staves) {
        expect(staff.getAttribute('n')).toBe('2');
      }
    });

    it('should restore all staves when showMelodyOnly is toggled off', () => {
      score.setOptions({ showMelodyOnly: false });
      const staffNumbers = new Set();
      for (const staff of score._scoreData.meiParsed.querySelectorAll('staff')) {
        staffNumbers.add(staff.getAttribute('n'));
      }
      expect(staffNumbers.size).toBe(3);
    });
  });
});

// ============================================================
// IIW without custom parts/sections (default behavior)
// ============================================================
describe('It Is Well — default load (no parts/sections)', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: iiwMusicXml,
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });
  afterEach(() => { resetScoreState(score); });

  it('should still have 3 staves without custom parts', () => {
    expect(score._scoreData.staffNumbers).toEqual([1, 2, 3]);
  });

  it('should have intro brackets even without custom sections', () => {
    expect(score._scoreData.hasIntroBrackets).toBe(true);
  });

  it('should have 4 intro bracket dir elements without custom sections', () => {
    const introBrackets = score._scoreData.meiParsed.querySelectorAll('dir[ch-intro-bracket]');
    expect(introBrackets.length).toBe(4);
  });

  it('should auto-detect chorus sections from embedded MusicXML lyrics', () => {
    // The MusicXML contains embedded lyrics with repeating chorus text,
    // which triggers auto-detection of 4 chorus sections even without explicit config
    const chorusSections = score._scoreData.sections.filter(s => s.type === 'chorus');
    expect(chorusSections.length).toBe(4);
  });
});

// ============================================================
// IIW with lyrics extraction
// ============================================================
describe('It Is Well — lyrics extraction from text file', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: iiwMusicXml,
      lyricsText: iiwLyrics,
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should store the lyrics text', () => {
    expect(score._scoreData.lyricsText).toBe(iiwLyrics);
  });

  it('should extract sections from the lyrics text (verses and choruses)', () => {
    expect(score._scoreData.sections.length).toBeGreaterThan(0);
    const types = score._scoreData.sections.map(s => s.type);
    expect(types).toContain('verse');
    expect(types).toContain('chorus');
  });

  it('verse sections should have marker values matching the verse numbers', () => {
    const verseSections = score._scoreData.sections.filter(s => s.type === 'verse');
    for (let i = 0; i < verseSections.length; i++) {
      // Markers may be numeric (from auto-extraction) or strings (from explicit config)
      expect(Number(verseSections[i].marker)).toBe(i + 1);
    }
  });

  it('chorus sections should have null marker', () => {
    const chorusSections = score._scoreData.sections.filter(s => s.type === 'chorus');
    for (const chorus of chorusSections) {
      expect(chorus.marker).toBeNull();
    }
  });
});
