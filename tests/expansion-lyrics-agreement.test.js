/**
 * Tests: score expansion and lyric extraction agree on what is sung.
 *
 * `expandScore: 'full-score'` and lyric extraction are the same problem wearing two
 * hats. Both walk the song in sung order — through repeats, endings, jumps and pickups —
 * and both must answer, at every chord position on every pass, which <verse> element is
 * sounding. Expansion answers it to decide which verses to keep in the rendered score;
 * extraction answers it to decide which syllables to read into the lyrics. They share
 * `_verseSoundingAt`, and these tests assert the two results still line up.
 *
 * This invariant is worth owning here because nothing else can check it: the corpus
 * script never renders, so `expandScore: 'full-score'` is entirely unmeasured by it, and
 * a fix landing in only one of the two paths shows up nowhere.
 *
 * Covers:
 * - Whole-song sung text agreement, folded to letters
 * - Per-section agreement via verse@ch-section-id (catches two sections swapping labels,
 *   which a whole-song comparison cannot see)
 * - This Little Light: repeats and first/second endings, i.e. more than one pass
 * - How Great the Wisdom / It Is Well: no-repeat controls, external lyrics file
 *
 * Note: no fixture here reproduces a labelled pickup engraved inside a repeat (the
 * "Grandmother" / "The Things I Do" shape that motivated the shared method). Those are
 * verified against the corpus; these tests guard the invariant generally.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';
import {
  sampleMusicXmlHGW, sampleLyricsHGW, hgwPartsTemplate, hgwFermatas,
  sampleMusicXmlIIW, sampleLyricsIIW, iiwParts, iiwSections, iiwFermatas,
  sampleMusicXmlTLL, sampleLyricsTLL, tllPartsTemplate, tllFermatas,
} from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// Compare on letters alone: the two paths build their text differently (one joins
// syllables into words, the other reads <syl> elements straight off the score), so
// word boundaries and punctuation differ by construction. Sung order does not.
// annotatedLyrics carries markup when lyrics were aligned to a supplied lyrics file —
// tags come out first, or their attribute names fold in as letters.
function foldToLetters(text) {
  return (text ?? '').replace(/<[^>]*>/g, '').toLowerCase().replace(/[^\p{Letter}]/gu, '');
}

// The lyrics as extracted, restricted to sections that are actually engraved. Verses
// printed below the music reach the lyrics but have no chord positions, so they are
// engraved nowhere and can't appear in the expanded score (How Great the Wisdom has two).
function sungLyricsBySection(score) {
  const bySection = new Map();
  for (const section of score._scoreData.sections) {
    if (!section.annotatedLyrics) continue;
    if ((section.chordPositionRanges ?? []).length === 0) continue;
    bySection.set(section.sectionId, foldToLetters(section.annotatedLyrics));
  }
  return bySection;
}

// The sung text surviving in the expanded MEI, grouped by the section ID stamped on each
// verse. Secondary lyrics are excluded: expansion keeps them as a parallel n=2 line.
function expandedLyricsBySection(score) {
  const bySection = new Map();
  const verses = score._scoreData.meiParsed.querySelectorAll(
    ':is(note[ch-melody], chord:has([ch-melody])) verse:not([ch-secondary])');
  for (const verse of verses) {
    const sectionId = verse.getAttribute('ch-section-id');
    if (!sectionId) continue;
    const syllables = Array.from(verse.querySelectorAll('syl'))
      .map(syl => foldToLetters(syl.textContent)).join('');
    bySection.set(sectionId, (bySection.get(sectionId) ?? '') + syllables);
  }
  return bySection;
}

const songs = [
  {
    name: 'This Little Light of Mine (repeats + first/second endings)',
    inputData: {
      scoreContent: sampleMusicXmlTLL,
      lyricsText: sampleLyricsTLL,
      partsTemplate: tllPartsTemplate,
      fermatas: tllFermatas,
    },
  },
  {
    name: 'How Great the Wisdom and the Love (no repeats, verses below the music)',
    inputData: {
      scoreContent: sampleMusicXmlHGW,
      lyricsText: sampleLyricsHGW,
      partsTemplate: hgwPartsTemplate,
      fermatas: hgwFermatas,
    },
  },
  {
    name: 'It Is Well with My Soul (no repeats, explicit sections, secondary lyrics)',
    inputData: {
      scoreContent: sampleMusicXmlIIW,
      lyricsText: sampleLyricsIIW,
      parts: iiwParts,
      sections: iiwSections,
      fermatas: iiwFermatas,
    },
  },
];

for (const song of songs) {
  describe(`Expansion agrees with extraction — ${song.name}`, { timeout: 30000 }, () => {
    let expected, actual;

    beforeAll(async () => {
      document.body.innerHTML = '<div id="score-container"></div>';
      ChScore.prototype._drawScore = function() {};
      const score = new ChScore('#score-container');
      await score.load('musicxml', song.inputData);
      expected = sungLyricsBySection(score);
      score.setOptions({ expandScore: 'full-score' });
      actual = expandedLyricsBySection(score);
    });

    afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

    it('should sing the same text in the same order in both paths', () => {
      const expectedText = Array.from(expected.values()).join('');
      const actualText = Array.from(actual.values()).join('');
      expect(expectedText.length).toBeGreaterThan(0);
      expect(actualText).toBe(expectedText);
    });

    it('should stamp each expanded verse with the section ID whose lyrics it carries', () => {
      expect(actual.size).toBeGreaterThan(0);
      for (const [sectionId, text] of actual) {
        expect({ sectionId, text }).toEqual({ sectionId, text: expected.get(sectionId) });
      }
    });

    it('should render every sung section in the expanded score', () => {
      expect(Array.from(actual.keys())).toEqual(Array.from(expected.keys()));
    });
  });
}

// ============================================================
// Expanded chord position numbering
// ============================================================

/**
 * `ch-expanded-chord-position` is an index into `_scoreData.expandedChordPositions`.
 * The attribute is written while expanding the MEI; the array is built earlier, at parse
 * time. Both come from `_walkSungChordPositions`, so the numbering matches by
 * construction — this asserts it, because a drift here silently mis-maps every MIDI note
 * and section highlight from the first differing position onward, with nothing failing.
 */
describe('Expanded chord positions index the data model', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    // This Little Light is the fixture with real repeats, so its numbering spans
    // more than one pass over the same chord positions
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlTLL,
      lyricsText: sampleLyricsTLL,
      partsTemplate: tllPartsTemplate,
      fermatas: tllFermatas,
    });
    score.setOptions({ expandScore: 'full-score' });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should point every tagged note at a real expanded chord position', () => {
    const notes = score._scoreData.meiParsed.querySelectorAll('note[ch-expanded-chord-position]');
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      const ecp = Number.parseInt(note.getAttribute('ch-expanded-chord-position'));
      expect(score._scoreData.expandedChordPositions[ecp]).toBeDefined();
    }
  });

  it('should agree with the data model on which chord position each note is', () => {
    const notes = score._scoreData.meiParsed.querySelectorAll(
      'note[ch-expanded-chord-position][ch-chord-position]');
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      const ecp = Number.parseInt(note.getAttribute('ch-expanded-chord-position'));
      const chordPosition = Number.parseInt(note.getAttribute('ch-chord-position'));
      const entry = score._scoreData.expandedChordPositions[ecp];
      expect({ ecp, chordPosition: entry.chordPositionInfo.chordPosition })
        .toEqual({ ecp, chordPosition });
    }
  });

  it('should agree with the data model on which section each note belongs to', () => {
    const verses = score._scoreData.meiParsed.querySelectorAll(
      'verse[ch-section-id][ch-secondary]:not([ch-secondary]), verse[ch-section-id]');
    expect(verses.length).toBeGreaterThan(0);
    for (const verse of verses) {
      const note = verse.closest('[ch-expanded-chord-position]');
      if (!note || verse.hasAttribute('ch-secondary')) continue;
      const ecp = Number.parseInt(note.getAttribute('ch-expanded-chord-position'));
      expect(score._scoreData.expandedChordPositions[ecp].sectionId)
        .toBe(verse.getAttribute('ch-section-id'));
    }
  });
});
