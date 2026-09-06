/**
 * Tests: ChScore.prototype._extractLyricStanzas() — integration tests.
 *
 * This function gathers syllables from the score (ChScore._gatherSyllables()
 * reads MEI verse/syl elements into objects with chord positions, expanded
 * chord positions, labels, and lyric line IDs), then produces stanzas either
 * by aligning them to given lyrics (ChScore._alignSyllablesToLyrics()) or, with
 * no lyrics given, from the syllables alone (ChScore._getLyricsFromSyllables()).
 *
 * Covers:
 * - Syllable extraction from MEI (verse elements, syl text, label elements)
 * - Stanzas built from the score itself when no lyrics text is given
 * - Chord position → expanded chord position mapping with ecpStart offset
 * - Multi-lyric-line handling (single-line vs. multi-line chord positions)
 * - Empty chord positions appended to previous syllable
 * - Full pipeline: HGW (6 verses, 4 inline + 2 below, no chorus)
 * - Full pipeline: IIW (4 verses + 4 choruses, pre-built sections)
 * - Full pipeline: TLL (2 verses, melody + chords layout)
 * - annotatedLyrics content (span markers, original text preservation)
 * - chordPositionRanges and expandedChordPositions in output stanzas
 * - Stanza type and marker assignment from lyrics text headers
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';
import {
  sampleMusicXmlHGW, sampleLyricsHGW,
  sampleMusicXmlIIW, sampleLyricsIIW,
  sampleMusicXmlTLL, sampleLyricsTLL,
  sampleMusicXmlFHS, sampleMusicXmlHeldMelody, sampleMusicXmlOptionalLine,
  sampleMusicXmlClaimedLine,
  sampleMusicXmlIntroStaff,
  hgwPartsTemplate, tllPartsTemplate,
  hgwFermatas, iiwFermatas, tllFermatas,
  iiwParts, iiwSections,
} from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();


// ════════════════════════════════════════════════════════════════
// How Great the Wisdom and the Love
// — 4 inline MEI verse lines, 6 text verses, no chorus
// — Sections generated from lyrics text (not pre-built)
// ════════════════════════════════════════════════════════════════
describe('_extractLyricStanzas — How Great the Wisdom', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlHGW,
      lyricsText: sampleLyricsHGW,
      partsTemplate: hgwPartsTemplate,
      fermatas: hgwFermatas,
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  // ── Stanza count and types ──
  describe('Stanza structure', () => {
    it('should produce 6 verse sections from 6 text verses', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      expect(verses.length).toBe(6);
    });

    it('should not produce any chorus sections', () => {
      const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
      expect(choruses.length).toBe(0);
    });

    it('should have 4 inline verse sections (matching 4 MEI lyric lines)', () => {
      const inlineVerses = score._scoreData.sections.filter(
        s => s.type === 'verse' && s.placement === 'inline'
      );
      expect(inlineVerses.length).toBe(4);
    });

    it('should have 2 below-placed verse sections (verses 5 & 6 have no inline lyric line)', () => {
      const belowVerses = score._scoreData.sections.filter(
        s => s.type === 'verse' && s.placement === 'below'
      );
      expect(belowVerses.length).toBe(2);
    });

    it('should have sequential verse markers 1–6', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      for (let i = 0; i < verses.length; i++) {
        expect(Number(verses[i].marker)).toBe(i + 1);
      }
    });
  });

  // ── annotatedLyrics content ──
  describe('annotatedLyrics content', () => {
    it('all verse sections should have non-null annotatedLyrics', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      for (const verse of verses) {
        expect(verse.annotatedLyrics).toBeDefined();
        expect(verse.annotatedLyrics).not.toBeNull();
        expect(verse.annotatedLyrics.length).toBeGreaterThan(0);
      }
    });

    it('inline verse annotatedLyrics should contain span markers', () => {
      const inlineVerses = score._scoreData.sections.filter(
        s => s.type === 'verse' && s.placement === 'inline'
      );
      for (const verse of inlineVerses) {
        expect(verse.annotatedLyrics).toContain('data-ch-chord-position=');
        expect(verse.annotatedLyrics).toContain('data-ch-expanded-chord-position=');
        expect(verse.annotatedLyrics).toContain('data-ch-lyric-line-id=');
      }
    });

    it('below verse annotatedLyrics should be plain text without span markers', () => {
      // Below verses have no MEI lyric line to extract syllables from,
      // so no spans are inserted — they are plain text only.
      const belowVerses = score._scoreData.sections.filter(
        s => s.type === 'verse' && s.placement === 'below'
      );
      for (const verse of belowVerses) {
        expect(verse.annotatedLyrics).toBeDefined();
        expect(verse.annotatedLyrics).not.toContain('data-ch-chord-position=');
      }
    });

    it('verse 1 annotatedLyrics should preserve original text from lyrics file', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      const verse1 = verses[0];
      const stripped = verse1.annotatedLyrics.replace(/<span[^>]*><\/span>/g, '');
      expect(stripped).toContain('How great the wisdom and the love');
    });

    it('verse 6 (below) annotatedLyrics should preserve original text', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      const verse6 = verses[5];
      const stripped = verse6.annotatedLyrics.replace(/<span[^>]*><\/span>/g, '');
      expect(stripped).toContain('In memory of the broken flesh');
    });

    it('annotatedLyrics should not contain stanza headers like [Verse 1]', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      for (const verse of verses) {
        expect(verse.annotatedLyrics).not.toMatch(/\[Verse \d+\]/);
      }
    });
  });

  // ── chordPositionRanges ──
  describe('chordPositionRanges', () => {
    it('inline verses should have non-empty chordPositionRanges', () => {
      const inlineVerses = score._scoreData.sections.filter(
        s => s.type === 'verse' && s.placement === 'inline'
      );
      for (const verse of inlineVerses) {
        expect(verse.chordPositionRanges.length).toBeGreaterThan(0);
        for (const range of verse.chordPositionRanges) {
          expect(range).toHaveProperty('start');
          expect(range).toHaveProperty('end');
          expect(range.end).toBeGreaterThan(range.start);
        }
      }
    });

    it('chordPositionRanges should have staffNumbers', () => {
      const inlineVerses = score._scoreData.sections.filter(
        s => s.type === 'verse' && s.placement === 'inline'
      );
      for (const verse of inlineVerses) {
        for (const range of verse.chordPositionRanges) {
          expect(range.staffNumbers).toBeDefined();
          expect(Array.isArray(range.staffNumbers)).toBe(true);
          expect(range.staffNumbers.length).toBeGreaterThan(0);
        }
      }
    });

    it('chordPositionRanges should have lyricLineIds', () => {
      const inlineVerses = score._scoreData.sections.filter(
        s => s.type === 'verse' && s.placement === 'inline'
      );
      for (const verse of inlineVerses) {
        for (const range of verse.chordPositionRanges) {
          expect(range).toHaveProperty('lyricLineIds');
          expect(Array.isArray(range.lyricLineIds)).toBe(true);
        }
      }
    });

    it('all inline verses should share the same chord position range (same music, different text)', () => {
      const inlineVerses = score._scoreData.sections.filter(
        s => s.type === 'verse' && s.placement === 'inline'
      );
      // All verses cover the same chord positions (same melody repeated)
      const firstStart = inlineVerses[0].chordPositionRanges[0].start;
      const firstEnd = inlineVerses[0].chordPositionRanges.at(-1).end;
      for (const verse of inlineVerses) {
        expect(verse.chordPositionRanges[0].start).toBe(firstStart);
        expect(verse.chordPositionRanges.at(-1).end).toBe(firstEnd);
      }
    });
  });

  // ── Syllable extraction details ──
  describe('Syllable extraction from MEI', () => {
    it('some chord positions should have verse elements with lyrics in the MEI', () => {
      // Find any chord position that has verse elements (lyrics)
      let foundVerses = false;
      for (let cp = 0; cp < score._scoreData.chordPositions.length; cp++) {
        const lyricElements = score._scoreData.meiParsed.querySelectorAll(
          `[ch-chord-position="${cp}"][ch-melody] verse, [ch-chord-position="${cp}"]:has([ch-melody]) verse`
        );
        if (lyricElements.length > 0) {
          foundVerses = true;
          // HGW has 4 lyric lines
          expect(lyricElements.length).toBeGreaterThanOrEqual(1);
          break;
        }
      }
      expect(foundVerses).toBe(true);
    });

    it('verse elements should contain syl children with syllable text', () => {
      const lyricElements = score._scoreData.meiParsed.querySelectorAll(
        '[ch-melody] verse'
      );
      let hasSylContent = false;
      for (const ve of lyricElements) {
        const syls = ve.querySelectorAll('syl');
        for (const syl of syls) {
          if (syl.textContent.trim().length > 0) {
            hasSylContent = true;
            break;
          }
        }
        if (hasSylContent) break;
      }
      expect(hasSylContent).toBe(true);
    });

    it('should have 4 inline lyric lines in the MEI (verse n=1 through n=4)', () => {
      for (let n = 1; n <= 4; n++) {
        const verseLine = score._scoreData.meiParsed.querySelector(`verse[n="${n}"]`);
        expect(verseLine).not.toBeNull();
      }
    });
  });
});


// ════════════════════════════════════════════════════════════════
// It Is Well with My Soul
// — Pre-built sections (4 verses + 4 choruses + introduction)
// — Verse/chorus alternating structure
// — Multiple lyric lines and descant
// ════════════════════════════════════════════════════════════════
describe('_extractLyricStanzas — It Is Well', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlIIW,
      lyricsText: sampleLyricsIIW,
      parts: iiwParts,
      sections: iiwSections,
      fermatas: iiwFermatas,
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  // ── Stanza count and types ──
  describe('Stanza structure (pre-built sections)', () => {
    it('should have 9 sections (intro + 4 verse + 4 chorus)', () => {
      expect(score._scoreData.sections.length).toBe(9);
    });

    it('should have section types in the correct order', () => {
      const types = score._scoreData.sections.map(s => s.type);
      expect(types).toEqual([
        'introduction', 'verse', 'chorus', 'verse', 'chorus',
        'verse', 'chorus', 'verse', 'chorus',
      ]);
    });

    it('should have 4 verse sections', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      expect(verses.length).toBe(4);
    });

    it('should have 4 chorus sections', () => {
      const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
      expect(choruses.length).toBe(4);
    });

    it('verse sections should have sequential markers 1–4', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      for (let i = 0; i < verses.length; i++) {
        expect(verses[i].marker).toBe(String(i + 1));
      }
    });
  });

  // ── annotatedLyrics content ──
  describe('annotatedLyrics content', () => {
    it('verse sections should have annotatedLyrics with span markers', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      for (const verse of verses) {
        expect(verse.annotatedLyrics).toBeDefined();
        expect(verse.annotatedLyrics).not.toBeNull();
        expect(verse.annotatedLyrics).toContain('data-ch-chord-position=');
      }
    });

    it('chorus sections should have annotatedLyrics with span markers', () => {
      const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
      for (const chorus of choruses) {
        expect(chorus.annotatedLyrics).toBeDefined();
        expect(chorus.annotatedLyrics).not.toBeNull();
        expect(chorus.annotatedLyrics).toContain('data-ch-chord-position=');
      }
    });

    it('introduction section should NOT have annotatedLyrics', () => {
      const intro = score._scoreData.sections.find(s => s.type === 'introduction');
      expect(intro.annotatedLyrics == null).toBe(true);
    });

    it('verse 1 annotatedLyrics should contain the original verse 1 text', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      const stripped = verses[0].annotatedLyrics.replace(/<span[^>]*><\/span>/g, '');
      expect(stripped).toContain('When peace, like a river');
    });

    it('verse 4 annotatedLyrics should contain the original verse 4 text', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      const stripped = verses[3].annotatedLyrics.replace(/<span[^>]*><\/span>/g, '');
      expect(stripped).toContain('Lord, haste the day');
    });

    it('chorus annotatedLyrics should contain the chorus text', () => {
      const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
      const stripped = choruses[0].annotatedLyrics.replace(/<span[^>]*><\/span>/g, '');
      expect(stripped).toContain('It is well with my soul');
    });

    it('different verse sections should have distinct annotatedLyrics', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      const texts = verses.map(v => v.annotatedLyrics);
      // All verse texts should be unique (different verse content)
      const uniqueTexts = new Set(texts);
      expect(uniqueTexts.size).toBe(verses.length);
    });

    it('all chorus sections should contain the same lyrical content (ignoring span attributes)', () => {
      const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
      // Strip span markers entirely to compare the textual content
      const strippedTexts = choruses.map(c => c.annotatedLyrics.replace(/<span[^>]*><\/span>/g, ''));
      const uniqueStripped = new Set(strippedTexts);
      // All chorus texts should be identical once spans are removed
      expect(uniqueStripped.size).toBe(1);
    });
  });

  // ── chordPositionRanges with pre-built sections ──
  describe('chordPositionRanges (pre-built sections)', () => {
    it('introduction section should have chordPositionRanges from the sections config', () => {
      const intro = score._scoreData.sections.find(s => s.type === 'introduction');
      expect(intro.chordPositionRanges.length).toBe(2);
      expect(intro.chordPositionRanges[0].start).toBe(0);
      expect(intro.chordPositionRanges[0].end).toBe(13);
      expect(intro.chordPositionRanges[1].start).toBe(55);
      expect(intro.chordPositionRanges[1].end).toBe(64);
    });

    it('verse sections should have chordPositionRanges covering cp 0–42', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      for (const verse of verses) {
        expect(verse.chordPositionRanges[0].start).toBe(0);
        expect(verse.chordPositionRanges.at(-1).end).toBe(42);
      }
    });

    it('chorus sections should have chordPositionRanges covering cp 42–64', () => {
      const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
      for (const chorus of choruses) {
        expect(chorus.chordPositionRanges[0].start).toBe(42);
        expect(chorus.chordPositionRanges.at(-1).end).toBe(64);
      }
    });
  });

  // ── Span markers in annotatedLyrics ──
  describe('Span marker attributes', () => {
    it('span markers should have data-ch-chord-position attributes', () => {
      const verse1 = score._scoreData.sections.find(s => s.type === 'verse' && s.marker === '1');
      const spanPattern = /data-ch-chord-position="(\d+[\d ]*?)"/g;
      const matches = [...verse1.annotatedLyrics.matchAll(spanPattern)];
      expect(matches.length).toBeGreaterThan(0);
    });

    it('span markers should have data-ch-expanded-chord-position attributes', () => {
      const verse1 = score._scoreData.sections.find(s => s.type === 'verse' && s.marker === '1');
      const spanPattern = /data-ch-expanded-chord-position="(\d+[\d ]*?)"/g;
      const matches = [...verse1.annotatedLyrics.matchAll(spanPattern)];
      expect(matches.length).toBeGreaterThan(0);
    });

    it('span markers should have data-ch-lyric-line-id attributes', () => {
      const verse1 = score._scoreData.sections.find(s => s.type === 'verse' && s.marker === '1');
      expect(verse1.annotatedLyrics).toContain('data-ch-lyric-line-id=');
    });

    it('verse 1 lyric-line-ids should reference lyric line 2.1', () => {
      const verse1 = score._scoreData.sections.find(s => s.type === 'verse' && s.marker === '1');
      // IIW verse 1 uses lyric line 2.1 (soprano staff, line 1)
      expect(verse1.annotatedLyrics).toContain('data-ch-lyric-line-id="2.1"');
    });
  });

  // ── Multi-lyric-line handling ──
  describe('Multi-lyric-line MEI structure', () => {
    it('should have verse elements with n attributes for multi-line chord positions', () => {
      // IIW has multiple lyric lines (verse n=1 through n=4 on soprano staff)
      const verseLine1 = score._scoreData.meiParsed.querySelector('verse[n="1"]');
      const verseLine2 = score._scoreData.meiParsed.querySelector('verse[n="2"]');
      expect(verseLine1).not.toBeNull();
      expect(verseLine2).not.toBeNull();
    });

    it('some chord positions should have multiple verse elements (multi-line)', () => {
      // Find a chord position with more than one verse element
      let foundMultiple = false;
      const melodyNotes = score._scoreData.meiParsed.querySelectorAll('[ch-melody]');
      for (const note of melodyNotes) {
        const parent = note.closest('[ch-chord-position]') || note;
        const verses = parent.querySelectorAll('verse');
        if (verses.length > 1) {
          foundMultiple = true;
          break;
        }
      }
      expect(foundMultiple).toBe(true);
    });
  });
});


// ════════════════════════════════════════════════════════════════
// This Little Light of Mine
// — 2 verses, Melody+Chords layout, no chorus
// — Sections generated from lyrics text
// — Has rest chord positions (audible ≠ total)
// ════════════════════════════════════════════════════════════════
describe('_extractLyricStanzas — This Little Light', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlTLL,
      lyricsText: sampleLyricsTLL,
      partsTemplate: tllPartsTemplate,
      fermatas: tllFermatas,
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  // ── Stanza count ──
  describe('Stanza structure', () => {
    it('should produce 2 verse sections from 2 text verses', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      expect(verses.length).toBe(2);
    });

    it('should not have chorus sections', () => {
      const choruses = score._scoreData.sections.filter(s => s.type === 'chorus');
      expect(choruses.length).toBe(0);
    });

    it('should have verse markers 1 and 2', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      expect(verses[0].marker).toBe('1');
      expect(verses[1].marker).toBe('2');
    });

    it('all verse sections should be inline (2 MEI lyric lines, 2 text verses)', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      for (const verse of verses) {
        expect(verse.placement).toBe('inline');
      }
    });
  });

  // ── annotatedLyrics content ──
  describe('annotatedLyrics content', () => {
    it('verse sections should have non-null annotatedLyrics', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      for (const verse of verses) {
        expect(verse.annotatedLyrics).toBeDefined();
        expect(verse.annotatedLyrics).not.toBeNull();
      }
    });

    it('verse 1 should contain its characteristic text', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      const stripped = verses[0].annotatedLyrics.replace(/<span[^>]*><\/span>/g, '');
      expect(stripped).toContain('This little light of mine');
    });

    it('verse 2 should contain its characteristic text', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      const verse2 = verses[1];
      const stripped = verse2.annotatedLyrics.replace(/<span[^>]*><\/span>/g, '');
      // Lyrics file uses smart quote (U+2019)
      expect(stripped).toContain('Ev\u2019rywhere I go');
    });

    it('verse sections should have span markers in annotatedLyrics', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      for (const verse of verses) {
        expect(verse.annotatedLyrics).toContain('data-ch-chord-position=');
        expect(verse.annotatedLyrics).toContain('data-ch-expanded-chord-position=');
      }
    });

    it('different verses should have distinct annotatedLyrics', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      expect(verses[0].annotatedLyrics).not.toBe(verses[1].annotatedLyrics);
    });
  });

  // ── chordPositionRanges ──
  describe('chordPositionRanges', () => {
    it('verse sections should have chordPositionRanges', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      for (const verse of verses) {
        expect(verse.chordPositionRanges.length).toBeGreaterThan(0);
      }
    });

    it('chordPositionRanges should have valid start < end', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      for (const verse of verses) {
        for (const range of verse.chordPositionRanges) {
          expect(range.end).toBeGreaterThan(range.start);
        }
      }
    });

    it('both verses should start at the same chord position', () => {
      const verses = score._scoreData.sections.filter(s => s.type === 'verse');
      const v1Start = verses[0].chordPositionRanges[0].start;
      const v2Start = verses[1].chordPositionRanges[0].start;
      expect(v1Start).toBe(v2Start);
    });
  });
});


// ════════════════════════════════════════════════════════════════
// No lyrics text provided
// ════════════════════════════════════════════════════════════════
describe('_extractLyricStanzas — no lyrics text', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlHGW,
      lyricsText: null,
      partsTemplate: hgwPartsTemplate,
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should still produce sections even without lyrics text', () => {
    expect(score._scoreData.sections).toBeDefined();
    expect(score._scoreData.sections.length).toBeGreaterThan(0);
  });

  // With no lyricsText, _extractLyricStanzas reads the stanzas out of the score's own
  // syllables (_getLyricsFromSyllables) instead of aligning to given lyrics
  it('should build verse sections from the engraved lyric lines', () => {
    const verses = score._scoreData.sections.filter(section => section.type === 'verse');
    expect(verses.map(verse => verse.name)).toEqual(['Verse 1', 'Verse 2', 'Verse 3', 'Verse 4']);
  });

  it('verse sections should carry lyrics joined from the engraved syllables', () => {
    const verses = score._scoreData.sections.filter(section => section.type === 'verse');
    for (const verse of verses) expect(verse.annotatedLyrics).toBeTruthy();
    expect(verses[0].annotatedLyrics).toContain('How great the wisdom and the love');
    expect(verses[1].annotatedLyrics).toContain('His precious blood He freely spilt');
  });
});


// ════════════════════════════════════════════════════════════════
// A pickup engraved inside a first ending
// ════════════════════════════════════════════════════════════════
describe('_extractLyricStanzas — For Health and Strength', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXmlFHS });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  // Verse 2 opens on a pickup inside the first ending, so playback reaches its first
  // word at the end of verse 1's pass and the jump back into the repeat splits it off.
  // The "2." printed there names lyric line 2, which is the line the pickup already sits
  // on, so only the music says it leads into the verse rather than being one.
  it('should merge the pickup into verse 2 rather than leaving it a stanza of its own', () => {
    const stanzas = score._scoreData.sections.filter(section => section.annotatedLyrics);
    expect(stanzas.map(stanza => stanza.name)).toEqual(['Verse 1', 'Verse 2']);
    for (const stanza of stanzas) {
      expect(stanza.annotatedLyrics).toContain('For health and strength and daily food');
      expect(stanza.annotatedLyrics).toContain('we praise thy name, O Lord.');
    }
  });

  it('should sing the pickup before the verse it leads into', () => {
    const verse2 = score._scoreData.sections.find(section => section.name === 'Verse 2');
    const starts = verse2.chordPositionRanges.map(range => range.start);
    // The pickup is engraved near the end of the score but sung first, so verse 2's
    // ranges open past where the rest of it begins
    expect(starts.length).toBeGreaterThan(1);
    expect(starts[0]).toBeGreaterThan(starts[1]);
    // ...and it is verse 1's words that start the song, not verse 2's
    expect(verse2.expandedChordPositionStart).toBeGreaterThan(
      score._scoreData.sections.find(section => section.name === 'Verse 1').expandedChordPositionStart);
  });
});


// ════════════════════════════════════════════════════════════════
// Empty lyrics text
// ════════════════════════════════════════════════════════════════
describe('_extractLyricStanzas — empty lyrics text', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlHGW,
      lyricsText: '',
      partsTemplate: hgwPartsTemplate,
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should still produce sections even with empty lyrics text', () => {
    expect(score._scoreData.sections).toBeDefined();
    expect(score._scoreData.sections.length).toBeGreaterThan(0);
  });

  // An empty lyricsText takes the same path as none at all
  it('should build verse sections from the engraved lyric lines', () => {
    const verses = score._scoreData.sections.filter(section => section.type === 'verse');
    expect(verses.map(verse => verse.name)).toEqual(['Verse 1', 'Verse 2', 'Verse 3', 'Verse 4']);
    expect(verses[0].annotatedLyrics).toContain('How great the wisdom and the love');
  });
});


// ════════════════════════════════════════════════════════════════
// Cross-song comparison: span count scales with syllable count
// ════════════════════════════════════════════════════════════════
describe('_extractLyricStanzas — span marker counts', { timeout: 30000 }, () => {
  let scoreHGW, scoreIIW, scoreTLL;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};

    scoreHGW = new ChScore('#score-container');
    await scoreHGW.load('musicxml', {
      scoreContent: sampleMusicXmlHGW,
      lyricsText: sampleLyricsHGW,
      partsTemplate: hgwPartsTemplate,
      fermatas: hgwFermatas,
    });

    scoreIIW = new ChScore('#score-container');
    await scoreIIW.load('musicxml', {
      scoreContent: sampleMusicXmlIIW,
      lyricsText: sampleLyricsIIW,
      parts: iiwParts,
      sections: iiwSections,
      fermatas: iiwFermatas,
    });

    scoreTLL = new ChScore('#score-container');
    await scoreTLL.load('musicxml', {
      scoreContent: sampleMusicXmlTLL,
      lyricsText: sampleLyricsTLL,
      partsTemplate: tllPartsTemplate,
      fermatas: tllFermatas,
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  function countSpans(scoreData) {
    let total = 0;
    for (const section of scoreData.sections) {
      if (section.annotatedLyrics) {
        const matches = section.annotatedLyrics.match(/<span[^>]*data-ch-chord-position[^>]*><\/span>/g);
        total += matches ? matches.length : 0;
      }
    }
    return total;
  }

  it('each song should have at least one span marker per section with lyrics', () => {
    for (const sd of [scoreHGW._scoreData, scoreIIW._scoreData, scoreTLL._scoreData]) {
      const lyricSections = sd.sections.filter(s => s.annotatedLyrics?.includes('data-ch-chord-position'));
      expect(lyricSections.length).toBeGreaterThan(0);
    }
  });

  it('HGW should have more total spans than TLL (more verses)', () => {
    const hgwSpans = countSpans(scoreHGW._scoreData);
    const tllSpans = countSpans(scoreTLL._scoreData);
    expect(hgwSpans).toBeGreaterThan(tllSpans);
  });

  it('IIW should have more total spans than TLL (more sections)', () => {
    const iiwSpans = countSpans(scoreIIW._scoreData);
    const tllSpans = countSpans(scoreTLL._scoreData);
    expect(iiwSpans).toBeGreaterThan(tllSpans);
  });

  it('span chord positions should be valid numbers', () => {
    for (const sd of [scoreHGW._scoreData, scoreIIW._scoreData, scoreTLL._scoreData]) {
      for (const section of sd.sections) {
        if (section.annotatedLyrics) {
          const cpMatches = [...section.annotatedLyrics.matchAll(/data-ch-chord-position="([^"]+)"/g)];
          for (const match of cpMatches) {
            const values = match[1].split(' ').map(Number);
            for (const v of values) {
              expect(Number.isInteger(v)).toBe(true);
              expect(v).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    }
  });

  it('expanded chord positions should be valid numbers', () => {
    for (const sd of [scoreHGW._scoreData, scoreIIW._scoreData, scoreTLL._scoreData]) {
      for (const section of sd.sections) {
        if (section.annotatedLyrics) {
          const ecpMatches = [...section.annotatedLyrics.matchAll(/data-ch-expanded-chord-position="([^"]+)"/g)];
          for (const match of ecpMatches) {
            const values = match[1].split(' ').map(Number);
            for (const v of values) {
              expect(Number.isInteger(v)).toBe(true);
              expect(v).toBeGreaterThanOrEqual(0);
            }
          }
        }
      }
    }
  });
});


// ════════════════════════════════════════════════════════════════
// Syllable gathering, on its own
// ════════════════════════════════════════════════════════════════
describe('_gatherSyllables — How Great the Wisdom', { timeout: 30000 }, () => {
  let score, syllables;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlHGW,
      lyricsText: sampleLyricsHGW,
      partsTemplate: hgwPartsTemplate,
      fermatas: hgwFermatas,
    });
    syllables = score._gatherSyllables([{ start: 0, end: score._scoreData.numChordPositions }], 0);
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should start with the seed entry that collects chord positions before the first syllable', () => {
    expect(syllables[0].text).toBe('');
    expect(syllables[0].lyricLineIds).toEqual([]);
  });

  it('should gather sung syllables with their positions and lyric line', () => {
    const sung = syllables.filter(syllable => syllable.text);
    expect(sung.length).toBeGreaterThan(0);
    for (const syllable of sung) {
      expect(syllable.chordPositions.length).toBeGreaterThan(0);
      expect(syllable.expandedChordPositions.length).toBe(syllable.chordPositions.length);
      expect(syllable.lyricLineIds[0]).toMatch(/^\d+\.\d+$/);
    }
  });

  it('should keep the syllables as engraved, with @wordpos, alongside the flattened text', () => {
    const sung = syllables.filter(syllable => syllable.text);
    for (const syllable of sung) {
      expect(syllable.syls.length).toBeGreaterThan(0);
      for (const syl of syllable.syls) {
        expect(typeof syl.text).toBe('string');
        expect([null, 'i', 'm', 't', 's']).toContain(syl.wordpos);
      }
    }
  });

  it('should offset expanded chord positions by ecpStart', () => {
    const offset = score._gatherSyllables([{ start: 0, end: score._scoreData.numChordPositions }], 100);
    expect(offset[1].expandedChordPositions[0]).toBe(syllables[1].expandedChordPositions[0] + 100);
  });
});


// ============================================================
// Words engraved on the voice below a held melody
// ============================================================
describe('A held melody with the words on the voice below it', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXmlHeldMelody });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should finish the melody line with the word engraved beneath it, sung once', () => {
    // One stanza, so no number tells it apart from another (see _normalizeSections)
    expect(score._scoreData.lyricsText).toBe('[Verse]\nWhere all who may rest,');
  });

  it('should leave the repeat in the score for it to draw, on the voice that sings it', () => {
    // Only the first copy is read as the melody's; the echo stays where it is engraved
    const drawn = [...score._scoreData.meiParsed.querySelectorAll('verse syl')]
      .map(syl => syl.textContent.trim()).filter(Boolean);
    expect(drawn.slice(-3)).toEqual(['rest,', 'may', 'rest.']);
  });

  it('should read the word off the lower voice and keep the melody itself out of it', () => {
    const syllables = score._gatherSyllables(
      [{ start: 0, end: score._scoreData.numChordPositions }], 0);
    expect(syllables.filter(syllable => syllable.text).map(syllable => syllable.text))
      .toEqual(['Where', 'all', 'who', 'may', 'rest,']);
  });
});


// ============================================================
// A lyric line an instruction marks as an alternate text
// ============================================================
describe('A lyric line marked optional by an instruction', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXmlOptionalLine });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should leave the alternate line out of the lyrics', () => {
    // A verse, not a chorus: with the alternate line taken out the fixture carries one lyric
    // line throughout, and a score that labels no verses falls back to calling a stanza one
    expect(score._scoreData.lyricsText).toBe('[Verse]\nSing to me now, gently and true. Sing now.');
  });

  it('should read the alternate words out beside the footnote they belong to', () => {
    const footnotes = score._scoreData.scoreMetadata.textBlocks
      .filter(block => block.type === 'footnote').map(block => block.text);
    // One block, the alternate words on a line of their own under the footnote they belong to
    expect(footnotes).toEqual(['*Alternate text for a special day.\non this special']);
  });

  it('should take the line and its instruction out of the score', () => {
    // Read out beside the footnote, so nothing downstream has to know to skip them. The whole
    // line goes, the melisma stub over the last note included -- a verse holding only an empty
    // syllable sings nothing but still draws a lyric row, leaving a gap under the staff
    const lines = [...score._scoreData.meiParsed.querySelectorAll('verse')]
      .map(verse => verse.getAttribute('n'));
    expect(new Set(lines)).toEqual(new Set(['1']));
    const directions = [...score._scoreData.meiParsed.querySelectorAll('dir')]
      .map(dir => dir.textContent.trim());
    expect(directions).not.toContain('(*Optional)');
  });
});


// ============================================================
// A chorus reworded for one verse
// ============================================================
describe('A chorus whose middle stretch is claimed for one pass', { timeout: 30000 }, () => {
  let score;

  const load = async (sections) => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const loaded = new ChScore('#score-container');
    await loaded.load('musicxml', sections
      ? { scoreContent: sampleMusicXmlClaimedLine, sections: sections }
      : { scoreContent: sampleMusicXmlClaimedLine });
    return loaded;
  };

  beforeAll(async () => { score = await load(); });
  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should sing the chorus as printed on every pass but the one claimed', () => {
    expect(score._scoreData.lyricsText).toBe([
      '[Verse 1]', 'I will sing a song of joy now', '',
      '[Chorus]', 'Sing out loud and clear and strong and true all day long.', '',
      '[Verse 2]', 'We will sing a song of peace too', '',
      '[Chorus]', 'Sing out loud and clear soft low and true all day long.',
    ].join('\n'));
  });

  it('should name the claimed line on the range that reads it', () => {
    const ranges = (id) => score._scoreData.sections.find(s => s.sectionId === id)
      .chordPositionRanges.map(r => [r.start, r.end, r.lyricLineIds]);
    // The chorus as printed is one range; the pass that reworded it names the line
    // for the stretch it covers and goes back to the printed line either side
    expect(ranges('chorus-1')).toEqual([[8, 20, ['1.1']]]);
    expect(ranges('chorus-2')).toEqual([[8, 13, ['1.1']], [13, 15, ['1.2']], [15, 20, ['1.1']]]);
  });

  // The instruction is printed in the chorus, so it belongs to the second chorus rather
  // than to verse 2 -- "(4th verse)" in "Dear to the Heart of the Shepherd" is the same shape
  const withHidden = async (hideSectionIds) => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const loaded = new ChScore('#score-container');
    await loaded.load('musicxml', { scoreContent: sampleMusicXmlClaimedLine },
      { ...ChScore.prototype._defaultOptions, hideSectionIds: hideSectionIds });
    return [...loaded._scoreData.meiParsed.querySelectorAll('dir')].map(dir => dir.textContent.trim());
  };

  it('should name the instruction with the section it is printed in', () => {
    const dir = [...score._scoreData.meiParsed.querySelectorAll('dir[ch-section-id]')]
      .find(dir => dir.textContent.trim() === '(2nd verse)');
    expect(dir?.getAttribute('ch-section-id')).toBe('chorus-2');
  });

  it('should drop the instruction when the passage it is printed in is hidden', async () => {
    expect(await withHidden(['chorus-2'])).not.toContain('(2nd verse)');
  });

  it('should keep it when the verse of the same number is hidden but its own passage is not', async () => {
    expect(await withHidden(['verse-2'])).toContain('(2nd verse)');
  });

  it('should keep it when an unrelated section is hidden', async () => {
    expect(await withHidden(['verse-1'])).toContain('(2nd verse)');
  });

  it('should draw the claimed line on a row of its own when a verse is hidden', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const loaded = new ChScore('#score-container');
    await loaded.load('musicxml', { scoreContent: sampleMusicXmlClaimedLine },
      { ...ChScore.prototype._defaultOptions, hideSectionIds: ['verse-1'] });
    const rows = {};
    for (const verse of loaded._scoreData.meiParsed.querySelectorAll('verse')) {
      const chordPosition = verse.closest('[ch-chord-position]').getAttribute('ch-chord-position');
      const syllable = verse.querySelector('syl')?.textContent.trim();
      if (syllable) (rows[`${chordPosition}.${verse.getAttribute('n')}`] ??= []).push(syllable);
    }
    // The claimed line replaces the printed one but both are still drawn, so where they
    // overlap they must not collapse onto the same row and print on top of each other
    expect(Object.values(rows).filter(words => words.length > 1)).toEqual([]);
  });

  it('should draw the claimed line on row 1 when the line it replaces is hidden', async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    const loaded = new ChScore('#score-container');
    await loaded.load('musicxml', { scoreContent: sampleMusicXmlClaimedLine },
      { ...ChScore.prototype._defaultOptions, hideSectionIds: ['verse-1', 'chorus-1'] });
    // Nothing is drawn on the row above any more, so the claimed words belong on row 1 --
    // left on row 2 they would sit under an empty line
    const rows = new Set([...loaded._scoreData.meiParsed.querySelectorAll('verse')]
      .filter(verse => verse.querySelector('syl:not(:empty)'))
      .map(verse => verse.getAttribute('n')));
    expect(rows).toEqual(new Set(['1']));
  });

  it('should give the same lyrics when those sections are handed back in', async () => {
    const again = await load(score._scoreData.sections);
    expect(again._scoreData.lyricsText).toBe(score._scoreData.lyricsText);
  });
});

// ============================================================
// Where an introduction is played from
// ============================================================
describe('An introduction bracketed on two different staves', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXmlIntroStaff });
  });
  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should play each bracketed stretch from its own staff down', () => {
    const intro = score._scoreData.sections.find(section => section.type === 'introduction');
    // The first bracket is on the voice staff and the second on the piano's upper staff, so
    // the voice plays the first stretch and sits out the second
    expect(intro.chordPositionRanges.map(range => [range.start, range.end, range.staffNumbers]))
      .toEqual([[0, 8, [1, 2, 3]], [8, 16, [2, 3]]]);
  });

  it('should leave every staff singing in the verse itself', () => {
    const verse = score._scoreData.sections.find(section => section.type === 'verse');
    expect(verse.chordPositionRanges.map(range => range.staffNumbers)).toEqual([[1, 2, 3]]);
  });
});
