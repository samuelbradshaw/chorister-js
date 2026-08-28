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
 * - For Health and Strength: a labelled pickup engraved inside a first ending, and the
 *   only fixture with no lyrics file, so the only one whose stanzas are derived from the
 *   engraved syllables and then reshaped by _mergePickupStanzas
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';
import {
  sampleMusicXmlHGW, sampleLyricsHGW, hgwPartsTemplate, hgwFermatas,
  sampleMusicXmlIIW, sampleLyricsIIW, iiwParts, iiwSections, iiwFermatas,
  sampleMusicXmlTLL, sampleLyricsTLL, tllPartsTemplate, tllFermatas,
  sampleMusicXmlTwoPart, sampleMusicXmlFHS,
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
  {
    // No lyricsText: this one is derived from the engraved syllables, which is the path
    // _mergePickupStanzas runs on, and the only fixture here whose stanzas the merge
    // reshapes. Expansion must agree with the reshaped sections, not just the words.
    name: 'For Health and Strength (labelled pickup inside a first ending)',
    inputData: { scoreContent: sampleMusicXmlFHS },
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
// Two-part scores: each part's own words, on its own pass
// ============================================================

/**
 * A 'Two-Part' score (partsTemplate 'P+P') is two independent melody lines on separate
 * staves, each carrying its own complete verse, sung together — see
 * corpus/lyric-extraction-notes.md, "Two-part songs". The fixture is synthetic, built to
 * the shape of "A Child’s Prayer" (1989 CSB), the corpus song this was written for. Both
 * staves are tagged ch-melody, so every chord position offers two verses at once and the
 * rendition picks between them: rendition 1 sings Part 1's words, rendition 2 Part 2's,
 * and from there on they sing together.
 *
 * The whole-song equality the fixtures above assert deliberately does NOT hold here:
 * extraction emits one verse per part (plus a trailing tag where the score has one), while
 * expansion renders every engraved rendition. So this block asserts what does hold — each
 * expanded section carries its own part's words and no other's.
 *
 * Known gap, deliberately not asserted: a verse section's expanded text repeats its own
 * body, because the stanza's chordPositionRange is one solid interval spanning both repeat
 * endings while the MEI holds a clone per rendition — the same class of bug the notes
 * describe under "What snapshotting the whole of _scoreData turned up".
 */
describe('Expansion keeps each part to its own words — two-part score', { timeout: 30000 }, () => {
  let score, expected, actual;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlTwoPart,
      partsTemplate: 'Two-Part',
    });
    expected = sungLyricsBySection(score);
    score.setOptions({ expandScore: 'full-score' });
    actual = expandedLyricsBySection(score);
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should detect the score as two-part', () => {
    expect(score._scoreData.hasTwoPartMelody).toBe(true);
  });

  it('should extract one verse per part, each with that part own words', () => {
    const verses = Array.from(expected.values());
    expect(verses).toHaveLength(2);
    expect(verses[0]).toContain('wesingasongofpraisetoday');
    expect(verses[1]).toContain('youhearourcallandknoweachname');
  });

  it('should render each expanded section with only its own part words', () => {
    expect(actual.size).toBe(expected.size);
    for (const [sectionId, text] of actual) {
      // Every section the walk stamped is one it also extracted lyrics for
      expect(expected.has(sectionId)).toBe(true);
      // The rendered text is built from that section's own verse and nothing else, so it
      // starts where the extracted verse starts (repetition of its own body aside — see
      // the known gap above)
      expect(text.startsWith(expected.get(sectionId).slice(0, 30))).toBe(true);
    }
  });

  it('should not leak the other part words into a section', () => {
    const [verse1, verse2] = Array.from(expected.values());
    expect(actual.get('section-0')).not.toContain(verse2.slice(0, 30));
    expect(actual.get('section-1')).not.toContain(verse1.slice(0, 30));
  });

  // The part that isn't singing this rendition is rested out, not just stripped of its
  // words — otherwise both parts' notes are engraved on every pass and only the lyrics
  // alternate. A rendition where a part sings nothing at all becomes measure rests.
  it('should rest out the part that is not singing in each rendition', () => {
    const renditions = Array.from(score._scoreData.meiParsed.querySelectorAll(
      'section:not([type="introduction"]) > section'))
      .map(section => {
        const count = selector => {
          const perStaff = {};
          for (const element of section.querySelectorAll(selector)) {
            const staffNumber = element.closest('staff')?.getAttribute('n');
            perStaff[staffNumber] = (perStaff[staffNumber] ?? 0) + 1;
          }
          return perStaff;
        };
        return { notes: count('note'), measureRests: count('mRest') };
      })
      // The verse renditions are the substantial ones — the fixture's body carries 12 notes
      // per part, while an ending clone carries at most the pickup's 3 plus a tail word
      .filter(rendition => (rendition.notes['1'] ?? 0) + (rendition.notes['2'] ?? 0) > 8);

    expect(renditions).toHaveLength(3);
    // Pass 1 — Part 1 sings, Part 2 rests
    expect(renditions[0].notes['2']).toBeUndefined();
    expect(renditions[0].measureRests['2']).toBeGreaterThan(0);
    // Pass 2 — the mirror image
    expect(renditions[1].notes['1']).toBeUndefined();
    expect(renditions[1].measureRests['1']).toBeGreaterThan(0);
    // Pass 3 — both parts sound together, so neither is rested out
    expect(renditions[2].notes['1']).toBeGreaterThan(0);
    expect(renditions[2].notes['2']).toBeGreaterThan(0);
    expect(renditions[2].measureRests['1']).toBeUndefined();
    expect(renditions[2].measureRests['2']).toBeUndefined();
  });

  // "(3.)" is printed on Part 1's line inside the repeat ending (as "A Child’s Prayer"
  // does): a pickup *into* verse 3, so it is sung at the end of rendition 2 and nowhere else
  it('should place a labelled pickup in the rendition that leads into the verse it names', () => {
    const renditionsShowingPickup = Array.from(score._scoreData.meiParsed
      .querySelectorAll('verse label'))
      .filter(label => label.textContent.includes('3'))
      .map(label => label.closest('section[ch-rendition]')?.getAttribute('ch-rendition'));
    expect(renditionsShowingPickup.length).toBeGreaterThan(0);
    for (const rendition of renditionsShowingPickup) expect(rendition).toBe('2');
  });

  // The "(3.)" pickup is engraved as a triplet, so silencing it note by note leaves three
  // triplet rests where a single quarter rest says the same thing
  it('should collapse a beam or tuplet left holding only rests into one rest', () => {
    for (const container of score._scoreData.meiParsed.querySelectorAll('beam, tuplet')) {
      const events = Array.from(container.querySelectorAll('note, chord, rest, mRest, space'));
      if (events.length === 0) continue;
      expect(events.every(event => event.matches('rest'))).toBe(false);
    }
  });

  // MEI elements built with createElement rather than createElementNS land outside the
  // document's namespace and serialize as <rest xmlns="">
  it('should create rests in the MEI namespace', () => {
    const meiNamespace = score._scoreData.meiParsed.documentElement.namespaceURI;
    const rests = score._scoreData.meiParsed.querySelectorAll('rest, mRest');
    expect(rests.length).toBeGreaterThan(0);
    for (const rest of rests) expect(rest.namespaceURI).toBe(meiNamespace);
  });

  // A verse left on the lyric line number it was engraved with renders as a second line of
  // words under the staff, so a verse's tail sits below the words it belongs beside
  it('should put every surviving melody verse on the first lyric line', () => {
    const verses = score._scoreData.meiParsed.querySelectorAll(
      ':is(note[ch-melody], chord:has([ch-melody])) verse:not([ch-secondary])');
    expect(verses.length).toBeGreaterThan(0);
    for (const verse of verses) expect(verse.getAttribute('n')).toBe('1');
  });
});

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
