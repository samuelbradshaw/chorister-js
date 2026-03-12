/**
 * Tests: ChScore.prototype._alignSyllablesToLyrics() — unit and integration tests.
 *
 * This function aligns syllable objects (from MEI score data) to versified
 * lyrics text, producing annotated stanza data with <span> markers.
 *
 * Covers:
 * - Edge cases (null/empty inputs)
 * - Stanza header extraction ([Verse 1], [Chorus], etc.)
 * - Basic syllable alignment with plain English text
 * - Punctuation / accent stripping during normalization
 * - Whitespace collapsing
 * - Multi-stanza alignment across verse/chorus
 * - Fuzzy matching for near-matches
 * - HTML tag handling (<em>, <strong>) — tags skipped during normalization
 * - Ruby/furigana handling (<ruby><rt>) — reading text used for matching
 * - Chord position ranges and expanded chord positions in stanza output
 * - Integration: full load of "How Great the Wisdom" with lyrics
 */

import { describe, it, expect, beforeAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';
import {
  sampleMusicXmlHGW as sampleMusicXml,
  sampleLyricsHGW as sampleLyrics,
} from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// ── Helpers ──────────────────────────────────────────────────

/**
 * Build a minimal syllable object for testing.
 */
function syl(text, cp, ecp, lyricLineIds = ['1.1'], label = null) {
  const cpArr = Array.isArray(cp) ? cp : [cp];
  const ecpArr = Array.isArray(ecp) ? ecp : [ecp];
  return { label, text, chordPositions: cpArr, expandedChordPositions: ecpArr, lyricLineIds };
}

const STAFF_NUMBERS = [1, 2];

// ════════════════════════════════════════════════════════════════
// Edge cases
// ════════════════════════════════════════════════════════════════
describe('alignSyllablesToLyrics — edge cases', () => {
  it('should return empty array for null expandedLyrics', () => {
    const result = ChScore.prototype._alignSyllablesToLyrics(null, [syl('a', 0, 0)], STAFF_NUMBERS);
    expect(result).toEqual([]);
  });

  it('should return empty array for empty expandedLyrics string', () => {
    const result = ChScore.prototype._alignSyllablesToLyrics('', [syl('a', 0, 0)], STAFF_NUMBERS);
    expect(result).toEqual([]);
  });

  it('should return empty array for null syllables', () => {
    const result = ChScore.prototype._alignSyllablesToLyrics('[Verse 1]\nHello', null, STAFF_NUMBERS);
    expect(result).toEqual([]);
  });

  it('should return empty array for empty syllables array', () => {
    const result = ChScore.prototype._alignSyllablesToLyrics('[Verse 1]\nHello', [], STAFF_NUMBERS);
    expect(result).toEqual([]);
  });
});


// ════════════════════════════════════════════════════════════════
// Stanza header extraction
// ════════════════════════════════════════════════════════════════
describe('alignSyllablesToLyrics — stanza header extraction', () => {
  it('should extract a single [Verse 1] header', () => {
    const lyrics = '[Verse 1]\nAmazing grace';
    const syllables = [
      syl('', [], [], []),  // empty intro syllable
      syl('A', 0, 0),
      syl('ma', 1, 1),
      syl('zing', 2, 2),
      syl('grace', 3, 3),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Verse 1');
    expect(result[0].type).toBe('verse');
    expect(result[0].marker).toBe('1');
  });

  it('should extract multiple stanza headers', () => {
    const lyrics = '[Verse 1]\nHello world\n\n[Chorus]\nSing along';
    const syllables = [
      syl('', [], [], []),
      syl('Hel', 0, 0),
      syl('lo', 1, 1),
      syl('world', 2, 2),
      syl('Sing', 3, 3),
      syl('a', 4, 4),
      syl('long', 5, 5),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('Verse 1');
    expect(result[0].type).toBe('verse');
    expect(result[0].marker).toBe('1');
    expect(result[1].name).toBe('Chorus');
    expect(result[1].type).toBe('chorus');
    expect(result[1].marker).toBe(null);
  });

  it('should handle [Verse 2] header with correct marker', () => {
    const lyrics = '[Verse 2]\nSecond verse';
    const syllables = [
      syl('', [], [], []),
      syl('Se', 0, 0),
      syl('cond', 1, 1),
      syl('verse', 2, 2),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].marker).toBe('2');
  });
});


// ════════════════════════════════════════════════════════════════
// Basic syllable alignment (English text)
// ════════════════════════════════════════════════════════════════
describe('alignSyllablesToLyrics — basic alignment', () => {
  it('should insert span markers at correct positions', () => {
    const lyrics = '[Verse 1]\nA simple test';
    const syllables = [
      syl('', [], [], []),
      syl('A', 0, 0),
      syl('sim', 1, 1),
      syl('ple', 2, 2),
      syl('test', 3, 3),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result.length).toBe(1);
    // Each syllable should produce a span in annotatedLyrics
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="0"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="1"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="2"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="3"');
  });

  it('should populate chordPositionRanges for single stanza', () => {
    const lyrics = '[Verse 1]\nHello';
    const syllables = [
      syl('', [], [], []),
      syl('Hel', 0, 0),
      syl('lo', 1, 1),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].chordPositionRanges.length).toBeGreaterThan(0);
    // The ranges should cover chord positions 0 and 1
    const allCPs = result[0].chordPositionRanges.flatMap(r =>
      Array.from({ length: r.end - r.start }, (_, i) => r.start + i)
    );
    expect(allCPs).toContain(0);
    expect(allCPs).toContain(1);
  });

  it('should populate expandedChordPositions as [first, last+1]', () => {
    const lyrics = '[Verse 1]\nOne two three';
    const syllables = [
      syl('', [], [], []),
      syl('One', 0, 10),
      syl('two', 1, 11),
      syl('three', 2, 12),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].expandedChordPositions).toEqual([10, 13]);
  });

  it('should handle multi-chord syllables', () => {
    const lyrics = '[Verse 1]\nHold';
    const syllables = [
      syl('', [], [], []),
      syl('Hold', [0, 1, 2], [10, 11, 12]),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="0 1 2"');
    expect(result[0].annotatedLyrics).toContain('data-ch-expanded-chord-position="10 11 12"');
  });
});


// ════════════════════════════════════════════════════════════════
// Normalization (punctuation, accents, whitespace)
// ════════════════════════════════════════════════════════════════
describe('alignSyllablesToLyrics — normalization', () => {
  it('should match syllables despite punctuation in lyrics', () => {
    const lyrics = "[Verse 1]\nHello, world!";
    const syllables = [
      syl('', [], [], []),
      syl('Hel', 0, 0),
      syl('lo', 1, 1),
      syl('world', 2, 2),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="2"');
  });

  it('should match syllables despite accented characters in lyrics', () => {
    const lyrics = "[Verse 1]\nAdornéd life";
    const syllables = [
      syl('', [], [], []),
      syl('A', 0, 0),
      syl('dorn', 1, 1),
      syl('ed', 2, 2),
      syl('life', 3, 3),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="2"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="3"');
  });

  it('should handle digits in lyrics (e.g. Psalm 23)', () => {
    const lyrics = "[Verse 1]\nPsalm 23 text";
    const syllables = [
      syl('', [], [], []),
      syl('Psalm', 0, 0),
      syl('text', 1, 1),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="0"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="1"');
  });

  it('should collapse multiple spaces in lyrics', () => {
    const lyrics = "[Verse 1]\nHello    world";
    const syllables = [
      syl('', [], [], []),
      syl('Hel', 0, 0),
      syl('lo', 1, 1),
      syl('world', 2, 2),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="2"');
  });

  it('should be case-insensitive', () => {
    const lyrics = "[Verse 1]\nAMAZING GRACE";
    const syllables = [
      syl('', [], [], []),
      syl('a', 0, 0),
      syl('ma', 1, 1),
      syl('zing', 2, 2),
      syl('grace', 3, 3),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="3"');
  });
});


// ════════════════════════════════════════════════════════════════
// Multi-stanza alignment
// ════════════════════════════════════════════════════════════════
describe('alignSyllablesToLyrics — multi-stanza', () => {
  it('should assign syllables to correct stanzas based on \\n\\n breaks', () => {
    const lyrics = '[Verse 1]\nFirst verse text\n\n[Chorus]\nChorus text';
    const syllables = [
      syl('', [], [], []),
      syl('First', 0, 0),
      syl('verse', 1, 1),
      syl('text', 2, 2),
      syl('Cho', 3, 3),
      syl('rus', 4, 4),
      syl('text', 5, 5),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result.length).toBe(2);
    // Verse should have chord positions 0-2
    const verseCPs = result[0].chordPositionRanges.flatMap(r =>
      Array.from({ length: r.end - r.start }, (_, i) => r.start + i)
    );
    expect(verseCPs).toEqual(expect.arrayContaining([0, 1, 2]));
    // Chorus should have chord positions 3-5
    const chorusCPs = result[1].chordPositionRanges.flatMap(r =>
      Array.from({ length: r.end - r.start }, (_, i) => r.start + i)
    );
    expect(chorusCPs).toEqual(expect.arrayContaining([3, 4, 5]));
  });

  it('should handle three stanzas (Verse/Chorus/Verse)', () => {
    const lyrics = '[Verse 1]\nFirst\n\n[Chorus]\nMiddle\n\n[Verse 2]\nLast';
    const syllables = [
      syl('', [], [], []),
      syl('First', 0, 0),
      syl('Mid', 1, 1),
      syl('dle', 2, 2),
      syl('Last', 3, 3),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result.length).toBe(3);
    expect(result[0].name).toBe('Verse 1');
    expect(result[1].name).toBe('Chorus');
    expect(result[2].name).toBe('Verse 2');
  });
});


// ════════════════════════════════════════════════════════════════
// Fuzzy matching
// ════════════════════════════════════════════════════════════════
describe('alignSyllablesToLyrics — fuzzy matching', () => {
  it('should fuzzy-match similar but not identical syllables', () => {
    // "ev'ry" in lyrics should fuzzy-match "evry" syllable (apostrophe stripped)
    const lyrics = "[Verse 1]\nHe marked ev'ry point";
    const syllables = [
      syl('', [], [], []),
      syl('He', 0, 0),
      syl('marked', 1, 1),
      syl("ev", 2, 2),
      syl("ry", 3, 3),
      syl('point', 4, 4),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    // All five syllables should appear in the annotated output
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="4"');
  });
});


// ════════════════════════════════════════════════════════════════
// HTML tag handling (<em>, <strong>, etc.)
// ════════════════════════════════════════════════════════════════
describe('alignSyllablesToLyrics — HTML tag handling', () => {
  it('should skip <em> tags and still match syllables', () => {
    const lyrics = '[Verse 1]\nThis is <em>important</em> text';
    const syllables = [
      syl('', [], [], []),
      syl('This', 0, 0),
      syl('is', 1, 1),
      syl('im', 2, 2),
      syl('por', 3, 3),
      syl('tant', 4, 4),
      syl('text', 5, 5),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="2"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="5"');
    // The original <em> tags should still be present in annotatedLyrics
    expect(result[0].annotatedLyrics).toContain('<em>');
    expect(result[0].annotatedLyrics).toContain('</em>');
  });

  it('should skip <strong> tags and still match syllables', () => {
    const lyrics = '[Verse 1]\nBe <strong>bold</strong> today';
    const syllables = [
      syl('', [], [], []),
      syl('Be', 0, 0),
      syl('bold', 1, 1),
      syl('to', 2, 2),
      syl('day', 3, 3),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="1"');
    expect(result[0].annotatedLyrics).toContain('<strong>');
  });

  it('should handle nested HTML tags', () => {
    const lyrics = '[Verse 1]\nA <em><strong>great</strong></em> day';
    const syllables = [
      syl('', [], [], []),
      syl('A', 0, 0),
      syl('great', 1, 1),
      syl('day', 2, 2),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="1"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="2"');
  });

  it('should handle <span> tags with attributes', () => {
    const lyrics = '[Verse 1]\nSome <span class="highlight">colored</span> word';
    const syllables = [
      syl('', [], [], []),
      syl('Some', 0, 0),
      syl('col', 1, 1),
      syl('ored', 2, 2),
      syl('word', 3, 3),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="1"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="3"');
  });
});


// ════════════════════════════════════════════════════════════════
// Ruby/furigana handling
// ════════════════════════════════════════════════════════════════
describe('alignSyllablesToLyrics — ruby/furigana', () => {
  it('should use <rt> reading text for matching', () => {
    // 主 (kanji) with reading しゅ, 来 with reading く
    const lyrics = '[Verse 1]\n<ruby>主<rp>(</rp><rt>しゅ</rt><rp>)</rp></ruby>が<ruby>来<rp>(</rp><rt>く</rt><rp>)</rp></ruby>る';
    const syllables = [
      syl('', [], [], []),
      syl('しゅ', 0, 0),
      syl('が', 1, 1),
      syl('く', 2, 2),
      syl('る', 3, 3),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result.length).toBe(1);
    // Should have matched all 4 syllables
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="0"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="1"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="2"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="3"');
  });

  it('should insert spans before their corresponding ruby blocks', () => {
    // Verify correct span placement: each span should precede its text element
    const lyrics = '[Verse 1]\n<ruby>主<rp>(</rp><rt>しゅ</rt><rp>)</rp></ruby>が<ruby>来<rp>(</rp><rt>こ</rt><rp>)</rp></ruby>られる';
    const syllables = [
      syl('', [], [], []),
      syl('しゅ', 0, 0),
      syl('が', 1, 1),
      syl('こ', 2, 2),
      syl('ら', 3, 3),
      syl('れ', 4, 4),
      syl('る', 5, 5),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    const al = result[0].annotatedLyrics;

    // CP0 (しゅ) span should be before <ruby>主...
    const cp0Idx = al.indexOf('data-ch-chord-position="0"');
    const ruby1Idx = al.indexOf('<ruby>主');
    expect(cp0Idx).toBeLessThan(ruby1Idx);

    // CP1 (が) span should be before が
    const cp1Idx = al.indexOf('data-ch-chord-position="1"');
    const gaIdx = al.indexOf('が', cp1Idx);
    expect(cp1Idx).toBeLessThan(gaIdx);

    // CP2 (こ) span should be before <ruby>来..., NOT after it
    const cp2Idx = al.indexOf('data-ch-chord-position="2"');
    const ruby2Idx = al.indexOf('<ruby>来');
    expect(cp2Idx).toBeLessThan(ruby2Idx);

    // CP3 (ら) span should be before ら
    const cp3Idx = al.indexOf('data-ch-chord-position="3"');
    const raIdx = al.indexOf('ら', cp3Idx);
    expect(cp3Idx).toBeLessThan(raIdx);
  });

  it('should preserve ruby HTML in annotatedLyrics', () => {
    const lyrics = '[Verse 1]\n<ruby>光<rp>(</rp><rt>ひかり</rt><rp>)</rp></ruby>';
    const syllables = [
      syl('', [], [], []),
      syl('ひ', 0, 0),
      syl('か', 1, 1),
      syl('り', 2, 2),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('<ruby>');
    expect(result[0].annotatedLyrics).toContain('<rt>ひかり</rt>');
    expect(result[0].annotatedLyrics).toContain('</ruby>');
  });

  it('should handle multiple ruby blocks in a line', () => {
    const lyrics = '[Verse 1]\n<ruby>主<rp>(</rp><rt>しゅ</rt><rp>)</rp></ruby>が<ruby>来<rp>(</rp><rt>こ</rt><rp>)</rp></ruby>られる';
    const syllables = [
      syl('', [], [], []),
      syl('しゅ', 0, 0),
      syl('が', 1, 1),
      syl('こ', 2, 2),
      syl('ら', 3, 3),
      syl('れ', 4, 4),
      syl('る', 5, 5),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="0"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="2"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="5"');
  });

  it('should handle ruby blocks with multi-character readings', () => {
    // 争 with reading あらそ (3 chars)
    const lyrics = '[Verse 1]\n<ruby>争<rp>(</rp><rt>あらそ</rt><rp>)</rp></ruby>いはなく';
    const syllables = [
      syl('', [], [], []),
      syl('あ', 0, 0),
      syl('ら', 1, 1),
      syl('そ', 2, 2),
      syl('い', 3, 3),
      syl('は', 4, 4),
      syl('な', 5, 5),
      syl('く', 6, 6),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    // All reading chars + plain chars should match
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="0"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="6"');
  });

  it('should handle mixed ruby and plain text with stanza breaks', () => {
    const lyrics = '[Verse 1]\n<ruby>主<rp>(</rp><rt>しゅ</rt><rp>)</rp></ruby>がまた\n\n[Chorus]\nさあ声';
    const syllables = [
      syl('', [], [], []),
      syl('しゅ', 0, 0),
      syl('が', 1, 1),
      syl('ま', 2, 2),
      syl('た', 3, 3),
      syl('さ', 4, 4),
      syl('あ', 5, 5),
      syl('声', 6, 6),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result.length).toBe(2);
    expect(result[0].name).toBe('Verse 1');
    expect(result[1].name).toBe('Chorus');
  });

  it('should handle ruby block with empty <rt> (no reading)', () => {
    // Some kanji have empty readings in the data
    const lyrics = '[Verse 1]\n<ruby><rp>(</rp><rt></rt><rp>)</rp></ruby>となり';
    const syllables = [
      syl('', [], [], []),
      syl('と', 0, 0),
      syl('な', 1, 1),
      syl('り', 2, 2),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    // Empty <rt> should be skipped, plain text should still match
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="0"');
    expect(result[0].annotatedLyrics).toContain('data-ch-chord-position="2"');
  });
});


// ════════════════════════════════════════════════════════════════
// Chord position range consolidation
// ════════════════════════════════════════════════════════════════
describe('alignSyllablesToLyrics — chord position ranges', () => {
  it('should consolidate consecutive chord positions into ranges', () => {
    const lyrics = '[Verse 1]\nOne two three four';
    const syllables = [
      syl('', [], [], []),
      syl('One', 0, 0),
      syl('two', 1, 1),
      syl('three', 2, 2),
      syl('four', 3, 3),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    // With consecutive CPs 0,1,2,3 and same lyricLineIds/staffNumbers, should consolidate
    expect(result[0].chordPositionRanges.length).toBe(1);
    expect(result[0].chordPositionRanges[0].start).toBe(0);
    expect(result[0].chordPositionRanges[0].end).toBe(4);
  });

  it('should not consolidate non-consecutive chord positions', () => {
    const lyrics = '[Verse 1]\nOne skip three';
    const syllables = [
      syl('', [], [], []),
      syl('One', 0, 0),
      syl('skip', 5, 5),  // gap between 0 and 5
      syl('three', 6, 6),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].chordPositionRanges.length).toBe(2);
  });

  it('should include staffNumbers in chord position ranges', () => {
    const lyrics = '[Verse 1]\nHello';
    const syllables = [
      syl('', [], [], []),
      syl('Hel', 0, 0),
      syl('lo', 1, 1),
    ];
    const staffNums = [2, 3];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, staffNums);
    expect(result[0].chordPositionRanges[0].staffNumbers).toEqual([2, 3]);
  });

  it('should include lyricLineIds in chord position ranges', () => {
    const lyrics = '[Verse 1]\nHello';
    const syllables = [
      syl('', [], [], []),
      syl('Hel', 0, 0, ['2.1']),
      syl('lo', 1, 1, ['2.1']),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].chordPositionRanges[0].lyricLineIds).toContain('2.1');
  });
});


// ════════════════════════════════════════════════════════════════
// Span marker format
// ════════════════════════════════════════════════════════════════
describe('alignSyllablesToLyrics — span marker attributes', () => {
  it('should include lyric-line-id attribute in span markers', () => {
    const lyrics = '[Verse 1]\nHello world';
    const syllables = [
      syl('', [], [], []),
      syl('Hel', 0, 0, ['1.1']),
      syl('lo', 1, 1, ['1.1']),
      syl('world', 2, 2, ['1.1']),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-lyric-line-id="1.1"');
  });

  it('should include expanded-chord-position attribute in span markers', () => {
    const lyrics = '[Verse 1]\nHello';
    const syllables = [
      syl('', [], [], []),
      syl('Hel', 0, 42),
      syl('lo', 1, 43),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].annotatedLyrics).toContain('data-ch-expanded-chord-position="42"');
    expect(result[0].annotatedLyrics).toContain('data-ch-expanded-chord-position="43"');
  });
});


// ════════════════════════════════════════════════════════════════
// Integration: full load with real song data
// ════════════════════════════════════════════════════════════════
describe('alignSyllablesToLyrics — integration with How Great the Wisdom', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      lyricsText: sampleLyrics,
    });
    ChScore.prototype._drawScore = origDrawScore;
  });

  it('should produce sections with annotatedLyrics', () => {
    expect(score._scoreData.sections).toBeDefined();
    const lyricSections = score._scoreData.sections.filter(s => s.annotatedLyrics);
    expect(lyricSections.length).toBeGreaterThan(0);
  });

  it('should produce annotatedLyrics containing span markers for aligned sections', () => {
    // HGW has 6 text verses but only 4 MEI verse lines, so some sections
    // will have annotatedLyrics text but no span markers. Check the aligned ones.
    const alignedSections = score._scoreData.sections.filter(
      s => s.annotatedLyrics && s.chordPositionRanges && s.chordPositionRanges.length > 0
    );
    expect(alignedSections.length).toBeGreaterThan(0);
    for (const section of alignedSections) {
      expect(section.annotatedLyrics).toContain('data-ch-chord-position=');
    }
  });

  it('should produce verse sections matching the lyrics file structure', () => {
    const verseSections = score._scoreData.sections.filter(s => s.type === 'verse');
    // How Great the Wisdom has multiple verses
    expect(verseSections.length).toBeGreaterThanOrEqual(4);
  });

  it('should have non-empty chordPositionRanges in aligned sections', () => {
    // Only check sections that were actually aligned with syllable data
    const alignedSections = score._scoreData.sections.filter(
      s => s.chordPositionRanges && s.chordPositionRanges.length > 0
    );
    expect(alignedSections.length).toBeGreaterThan(0);
    for (const section of alignedSections) {
      expect(section.chordPositionRanges[0]).toHaveProperty('start');
      expect(section.chordPositionRanges[0]).toHaveProperty('end');
    }
  });

  it('should have expandedChordPositions in unit-level output', () => {
    // Test the direct output of alignSyllablesToLyrics (not post-_normalizeSections)
    const lyrics = '[Verse 1]\nHow great the wisdom';
    const syllables = [
      syl('', [], [], []),
      syl('How', 0, 10),
      syl('great', 1, 11),
      syl('the', 2, 12),
      syl('wis', 3, 13),
      syl('dom', 4, 14),
    ];
    const result = ChScore.prototype._alignSyllablesToLyrics(lyrics, syllables, STAFF_NUMBERS);
    expect(result[0].expandedChordPositions).toEqual([10, 15]);
  });

  it('should preserve original lyrics text within annotatedLyrics', () => {
    const lyricSections = score._scoreData.sections.filter(s => s.annotatedLyrics);
    // The first verse should contain text from the lyrics file
    const firstVerse = lyricSections.find(s => s.type === 'verse');
    if (firstVerse) {
      // Strip spans and check for original words
      const stripped = firstVerse.annotatedLyrics.replace(/<span[^>]*><\/span>/g, '');
      expect(stripped.toLowerCase()).toContain('how');
      expect(stripped.toLowerCase()).toContain('great');
    }
  });
});
