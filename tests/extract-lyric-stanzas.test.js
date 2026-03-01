/**
 * Tests: ChScore.prototype._extractLyricStanzas() — integration tests.
 *
 * This function reads MEI verse/syl elements from the parsed score data,
 * builds an array of extracted syllable objects (with chord positions,
 * expanded chord positions, labels, and lyric line IDs), then delegates
 * to ChScore._alignSyllablesToLyrics() to produce annotated stanza data.
 *
 * Covers:
 * - Syllable extraction from MEI (verse elements, syl text, label elements)
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
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlHGW,
      lyricsText: sampleLyricsHGW,
      partsTemplate: hgwPartsTemplate,
      fermatas: hgwFermatas,
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

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
        const verseElements = score._scoreData.meiParsed.querySelectorAll(
          `[ch-chord-position="${cp}"][ch-melody] verse, [ch-chord-position="${cp}"]:has([ch-melody]) verse`
        );
        if (verseElements.length > 0) {
          foundVerses = true;
          // HGW has 4 lyric lines
          expect(verseElements.length).toBeGreaterThanOrEqual(1);
          break;
        }
      }
      expect(foundVerses).toBe(true);
    });

    it('verse elements should contain syl children with syllable text', () => {
      const verseElements = score._scoreData.meiParsed.querySelectorAll(
        '[ch-melody] verse'
      );
      let hasSylContent = false;
      for (const ve of verseElements) {
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
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlIIW,
      lyricsText: sampleLyricsIIW,
      parts: iiwParts,
      sections: iiwSections,
      fermatas: iiwFermatas,
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

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
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlTLL,
      lyricsText: sampleLyricsTLL,
      partsTemplate: tllPartsTemplate,
      fermatas: tllFermatas,
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

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
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlHGW,
      lyricsText: null,
      partsTemplate: hgwPartsTemplate,
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

  it('should still produce sections even without lyrics text', () => {
    expect(score._scoreData.sections).toBeDefined();
    expect(score._scoreData.sections.length).toBeGreaterThan(0);
  });

  it('sections should not have annotatedLyrics when lyricsText is null', () => {
    for (const section of score._scoreData.sections) {
      // With no lyricsText, _extractLyricStanzas returns empty → no annotatedLyrics
      expect(section.annotatedLyrics == null || section.annotatedLyrics === undefined).toBe(true);
    }
  });
});


// ════════════════════════════════════════════════════════════════
// Empty lyrics text
// ════════════════════════════════════════════════════════════════
describe('_extractLyricStanzas — empty lyrics text', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlHGW,
      lyricsText: '',
      partsTemplate: hgwPartsTemplate,
    });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

  it('should still produce sections even with empty lyrics text', () => {
    expect(score._scoreData.sections).toBeDefined();
    expect(score._scoreData.sections.length).toBeGreaterThan(0);
  });

  it('sections should not have annotatedLyrics when lyricsText is empty', () => {
    for (const section of score._scoreData.sections) {
      expect(section.annotatedLyrics == null || section.annotatedLyrics === undefined).toBe(true);
    }
  });
});


// ════════════════════════════════════════════════════════════════
// Cross-song comparison: span count scales with syllable count
// ════════════════════════════════════════════════════════════════
describe('_extractLyricStanzas — span marker counts', { timeout: 30000 }, () => {
  let scoreHGW, scoreIIW, scoreTLL;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};

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

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

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
