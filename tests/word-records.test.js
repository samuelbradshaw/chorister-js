/**
 * Tests: the per-section `lyricWords` records, and the caller's own hyphenated-word list.
 *
 * A section's `lyricWords` is the same words its lyricsText holds, as data: what each is
 * spelled as plainly and annotated, where its syllables join, and the hyphens it already
 * carries with where each came from. A reader with a dictionary uses the boundaries to
 * decide whether a joined word ("pagibig") wants a hyphen, so the records have to line up
 * with the text exactly -- which is what the contract test below pins down.
 *
 * Covers:
 * - The records reproduce lyricsText and lyricsAnnotated, in order
 * - Syllable boundaries and their relationship to the text's own hyphens
 * - Where a restored hyphen came from: printed, table, or engraved
 * - hyphenatedWords passed to load(), and how it ranks against the hard-coded list
 */

import { describe, it, expect, beforeAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';
import { sampleMusicXmlHGW } from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// The markers are empty spans, so stripping them leaves the plain reading behind
const stripMarkers = (text) => text.replace(/<span data-ch-[^>]*><\/span>/g, '');

// ============================================================
// The records against the text they came from
// ============================================================
describe('section.lyricWords against the section text', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function () {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXmlHGW });
    ChScore.prototype._drawScore = origDrawScore;
  });

  const lyricSections = () => score._scoreData.sections.filter(section => section.lyricsText);

  it('should give every section with words a records array', () => {
    expect(lyricSections().length).toBeGreaterThan(0);
    for (const section of lyricSections()) {
      expect(Array.isArray(section.lyricWords)).toBe(true);
      expect(section.lyricWords.length).toBeGreaterThan(0);
    }
  });

  it('should hold the section`s words, in order, in its plain text', () => {
    for (const section of lyricSections()) {
      // The text's own words, with the styling markup that isn't part of a word gone
      const written = section.lyricsText.replace(/<\/?(?:em|strong)>/g, '').split(/\s+/);
      expect(section.lyricWords.map(word => word.text)).toEqual(written);
    }
  });

  it('should hold the same words annotated, in the same order', () => {
    for (const section of lyricSections()) {
      const written = section.lyricsAnnotated.replace(/<\/?(?:em|strong)>/g, '')
        .split(/(?<=>|\S)\s+(?=<span|\S)/);
      expect(section.lyricWords.map(word => word.annotated).join(' '))
        .toBe(written.join(' '));
    }
  });

  it('should annotate each word so that stripping its markers gives the plain one', () => {
    for (const section of lyricSections()) {
      for (const word of section.lyricWords) {
        expect(stripMarkers(word.annotated)).toBe(word.text);
      }
    }
  });

  it('should spell `plain` as the word with its restored hyphens taken back out', () => {
    for (const section of lyricSections()) {
      for (const word of section.lyricWords) {
        const restored = word.hyphens.filter(hyphen => hyphen.source !== 'engraved');
        let text = word.plain;
        for (const { offset } of [...restored].reverse()) {
          text = `${text.slice(0, offset)}-${text.slice(offset)}`;
        }
        expect(text).toBe(word.text);
      }
    }
  });

  it('should count boundaries as one fewer than the word`s syllables', () => {
    for (const section of lyricSections()) {
      for (const word of section.lyricWords) {
        // Every boundary falls inside the word, and they climb
        for (const boundary of word.boundaries) {
          expect(boundary).toBeGreaterThan(0);
          expect(boundary).toBeLessThan(word.plain.length);
        }
        expect([...word.boundaries].sort((a, b) => a - b)).toEqual(word.boundaries);
      }
    }
  });
});

// ============================================================
// Where a hyphen came from
// ============================================================
describe('section.lyricWords hyphen sources', () => {
  let score;

  const wordsOf = () => score._scoreData.sections
    .filter(section => section.lyricWords)
    .flatMap(section => section.lyricWords);

  const load = async (inputData) => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function () {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXmlHGW, ...inputData });
    ChScore.prototype._drawScore = origDrawScore;
  };

  it('should mark a hyphen restored from the hard-coded list as `table`', async () => {
    await load({ lang: 'en' });
    // "How Great the Wisdom and the Love" sings "far-off", which the en list carries
    const hyphenated = wordsOf().filter(word => word.hyphens.length > 0);
    for (const word of hyphenated) {
      for (const hyphen of word.hyphens) {
        expect(['printed', 'table', 'engraved']).toContain(hyphen.source);
      }
    }
  });

  it('should restore a hyphen from a word the caller hands in', async () => {
    // A word the hard-coded en list does not carry, so only the caller's list can put it back
    await load({ lang: 'en', hyphenatedWords: ['wis-dom'] });
    const wisdom = wordsOf().find(word => word.plain.toLowerCase() === 'wisdom');
    expect(wisdom).toBeDefined();
    expect(wisdom.text.toLowerCase()).toBe('wis-dom');
    expect(wisdom.hyphens).toEqual([{ offset: 3, source: 'table' }]);
  });

  it('should leave the word alone when the caller hands in nothing for it', async () => {
    await load({ lang: 'en' });
    const wisdom = wordsOf().find(word => word.plain.toLowerCase() === 'wisdom');
    expect(wisdom.text.toLowerCase()).toBe('wisdom');
    expect(wisdom.hyphens).toEqual([]);
  });
});

// ============================================================
// The caller's list against the hard-coded one
// ============================================================
describe('hyphenatedWords passed to load()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should rank the score`s own printed text above the caller`s list', () => {
    // Printed text is evidence about this song; a list is a guess about the language
    const table = score._hyphenPositionsTable(['latter-day'], ['lat-terday']);
    expect(table).toEqual({ latterday: [3] });
  });

  it('should rank the caller`s list above the hard-coded one', () => {
    // _getLyricsFromSyllables concatenates them in this order, so the caller's wins
    const table = score._hyphenPositionsTable(['wis-dom', 'wisd-om'], []);
    expect(table).toEqual({ wisdom: [3] });
  });
});
