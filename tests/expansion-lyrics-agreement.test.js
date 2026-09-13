/**
 * Tests: score expansion and lyric extraction agree on what is sung.
 *
 * `expandScore: 'full-score'` and lyric extraction are the same problem wearing two
 * hats. Both walk the song in sung order — through repeats, endings, jumps and pickups —
 * and both must answer, at every chord position on every pass, which <verse> element is
 * sounding. Expansion answers it to decide which verses to keep in the rendered score;
 * extraction answers it to decide which syllables to read into the lyrics. They share
 * `_lyricElementSoundingAt`, and these tests assert the two results still line up.
 *
 * Nothing else can check it: the corpus script never renders, so a fix landing in only one
 * of the two paths shows up nowhere.
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
 * - Two-Part, with its own words handed back: the together pass _splitTwoPartFinalPass
 *   invents a section for, which nothing else here renders
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
// lyricsAnnotated carries markup when lyrics were aligned to a supplied lyrics file —
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
    // Sections with words. A wordless one carries markers alone, which the expanded
    // score has nothing to render.
    if (!section.lyricsText) continue;
    if ((section.chordPositionRanges ?? []).length === 0) continue;
    bySection.set(section.sectionId, foldToLetters(section.lyricsAnnotated));
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
 * staves, each carrying its own complete verse, sung together. The fixture is synthetic,
 * built to the shape of "A Child’s Prayer" (1989 CSB). Both
 * staves are tagged ch-melody, so every chord position offers two verses at once and the
 * iteration picks between them: iteration 1 sings Part 1's words, iteration 2 Part 2's,
 * and from there on they sing together.
 *
 * The whole-song equality the fixtures above assert deliberately does NOT hold here:
 * extraction emits one verse per part (plus a trailing tag where the score has one), while
 * expansion renders every engraved iteration. So this block asserts what does hold — each
 * expanded section carries its own part's words and no other's.
 *
 * Known gap, deliberately not asserted: a verse section's expanded text repeats its own
 * body, because the stanza's chordPositionRange is one solid interval spanning both repeat
 * endings while the MEI holds a clone per iteration — the same class of bug the notes
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
    expect(score._scoreData.features.hasTwoPartMelody).toBe(true);
  });

  it('should extract one verse per part, each with that part own words', () => {
    const verses = Array.from(expected.values());
    expect(verses).toHaveLength(2);
    expect(verses[0]).toContain('wesingasongofpraisetoday');
    expect(verses[1]).toContain('youhearourcallandknoweachname');
  });

  it('should render each expanded section with only its own part words', () => {
    // The together pass is the one place the two answers part company on purpose: it is real
    // music, so the expansion renders it, and it sings nothing the two verses before it
    // haven't, so extraction gives it no stanza of its own (see _splitTwoPartFinalPass and
    // _getLyricChordPositionRanges' twoPartFinalPass). Every other section must be in both.
    const togetherPass = score._scoreData.sections.filter(section =>
      (section.chordPositionRanges?.[0]?.lyricLineIds?.length ?? 0) > 1);
    expect(togetherPass).toHaveLength(1);
    expect(actual.size).toBe(expected.size + togetherPass.length);

    for (const [sectionId, text] of actual) {
      if (sectionId === togetherPass[0].sectionId) continue;
      // Every other section the walk stamped is one it also extracted lyrics for
      expect(expected.has(sectionId)).toBe(true);
      // The rendered text is built from that section's own verse and nothing else, so it
      // starts where the extracted verse starts (repetition of its own body aside — see
      // the known gap above)
      expect(text.startsWith(expected.get(sectionId).slice(0, 30))).toBe(true);
    }
  });

  it('should render the together pass with both parts words', () => {
    // It is the two verses sung at once, so both sets of words are engraved on it -- which is
    // exactly why it adds no stanza of its own. They interleave rather than following one
    // another: the parts sing syllable against syllable, so the folded text alternates
    // ("wesingasong" + "youhearourcall" + "ofpraisetoday" + ...).
    const together = score._scoreData.sections.find(section =>
      (section.chordPositionRanges?.[0]?.lyricLineIds?.length ?? 0) > 1);
    const text = actual.get(together.sectionId);
    expect(text).toBeDefined();
    expect(text).toContain('wesingasong');
    expect(text).toContain('youhearourcall');
  });

  it('should not leak the other part words into a section', () => {
    const [verse1, verse2] = Array.from(expected.values());
    expect(actual.get('verse-1')).not.toContain(verse2.slice(0, 30));
    expect(actual.get('verse-2')).not.toContain(verse1.slice(0, 30));
  });

  // The part that isn't singing this iteration is rested out, not just stripped of its
  // words — otherwise both parts' notes are engraved on every pass and only the lyrics
  // alternate. A iteration where a part sings nothing at all becomes measure rests.
  it('should rest out the part that is not singing in each iteration', () => {
    const iterations = Array.from(score._scoreData.meiParsed.querySelectorAll(
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
      // The verse iterations are the substantial ones — the fixture's body carries 12 notes
      // per part, while an ending clone carries at most the pickup's 3 plus a tail word
      .filter(iteration => (iteration.notes['1'] ?? 0) + (iteration.notes['2'] ?? 0) > 8);

    expect(iterations).toHaveLength(3);
    // Pass 1 — Part 1 sings, Part 2 rests
    expect(iterations[0].notes['2']).toBeUndefined();
    expect(iterations[0].measureRests['2']).toBeGreaterThan(0);
    // Pass 2 — the mirror image
    expect(iterations[1].notes['1']).toBeUndefined();
    expect(iterations[1].measureRests['1']).toBeGreaterThan(0);
    // Pass 3 — both parts sound together, so neither is rested out
    expect(iterations[2].notes['1']).toBeGreaterThan(0);
    expect(iterations[2].notes['2']).toBeGreaterThan(0);
    expect(iterations[2].measureRests['1']).toBeUndefined();
    expect(iterations[2].measureRests['2']).toBeUndefined();
  });

  // "(3.)" is printed on Part 1's line inside the repeat ending (as "A Child’s Prayer"
  // does): a pickup *into* verse 3, so it is sung at the end of iteration 2 and nowhere else
  it('should place a labelled pickup in the iteration that leads into the verse it names', () => {
    const iterationsShowingPickup = Array.from(score._scoreData.meiParsed
      .querySelectorAll('verse label'))
      .filter(label => label.textContent.includes('3'))
      .map(label => label.closest('section[ch-iteration]')?.getAttribute('ch-iteration'));
    expect(iterationsShowingPickup.length).toBeGreaterThan(0);
    for (const iteration of iterationsShowingPickup) expect(iteration).toBe('2');
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

// ═══════════════════════════════════════════════════════════
// The two-part together pass
// ═══════════════════════════════════════════════════════════
//
// _splitTwoPartFinalPass gives the pass where both parts sing together a section of its own,
// invented rather than read off the engraving. Nothing else exercises one through a redraw,
// which is where it bites: _updateMei walks one MEI section element per pass the expansion
// plays, and a section the expansion has no pass for runs that walk off the end.
describe('Two-part together pass — invented section survives a redraw', { timeout: 30000 }, () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function () {};
    const plain = new ChScore('#score-container');
    await plain.load('musicxml', {
      scoreContent: sampleMusicXmlTwoPart,
      partsTemplate: 'Two-Part',
    });
    const ownWords = plain._scoreData.lyricsText;

    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    await score.load('musicxml', {
      scoreContent: sampleMusicXmlTwoPart,
      partsTemplate: 'Two-Part',
      lyricsText: ownWords,
    });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should give the together pass a verse naming both lyric lines', () => {
    const sections = score._scoreData.sections;
    const together = sections.at(-1);
    expect(together.type).toBe('verse');
    expect(together.chordPositionRanges[0].lyricLineIds).toEqual(['1.1', '2.2']);
    // The two before it are one part each
    for (const section of sections.slice(0, -1)) {
      expect(section.chordPositionRanges[0].lyricLineIds).toHaveLength(1);
    }
  });

  it('should keep the together pass out of the lyrics', () => {
    // It sings nothing the two verses before it haven't
    expect(score._scoreData.lyricsText.split('\n\n')).toHaveLength(2);
  });

  it('should name the together pass in both forms of the sections template', () => {
    for (const form of ['chord-position', 'measure-beat']) {
      expect(score._convertSectionsToTemplate(score._scoreData.sections, form))
        .toMatch(/:1\.1,2\.2/);
    }
  });

  it('should redraw the full score without throwing', () => {
    // The regression this describe exists for: more sections than the expansion has passes
    expect(() => score.setOptions({ expandScore: 'full-score' })).not.toThrow();
  });

  it('should redraw without throwing when the template is handed back', async () => {
    // The shape that actually threw: a caller storing the sections template and supplying it
    // again. Read back, the together verse claims a pass of its own over the whole song, and
    // this score's expansion has none to give it.
    document.body.innerHTML = '<div id="score-container"></div>';
    const rebuilt = new ChScore('#score-container');
    await rebuilt.load('musicxml', {
      scoreContent: sampleMusicXmlTwoPart,
      partsTemplate: 'Two-Part',
      sectionsTemplate: 'V(:1.1); V(:2.2); V(:1.1,2.2)',
    });
    expect(rebuilt._scoreData.sections).toHaveLength(3);
    expect(() => rebuilt.setOptions({ expandScore: 'full-score' })).not.toThrow();
  });

  it('should still sing each part its own words after the redraw', () => {
    const sung = expandedLyricsBySection(score);
    const words = [...sung.values()].join(' ');
    expect(words).toContain('wesingasongofpraisetoday');
    expect(words).toContain('youhearourcallandknoweachname');
  });
});


// ═══════════════════════════════════════════════════════════
// The together pass, found from the sections alone
// ═══════════════════════════════════════════════════════════

/**
 * _splitTwoPartFinalPass reads the two parts coming together off the sections themselves, so
 * that a score parsed without words describes itself the way the same score parsed with them
 * does. These are the shape where the together pass ends somewhere of its own -- a third
 * ending, with words no other verse sings.
 */
describe('_splitTwoPartFinalPass — a third ending the engraving did not classify', () => {
  const twoPartScore = (sections) => {
    const score = Object.create(ChScore.prototype);
    score._scoreData = { features: { hasTwoPartMelody: true }, sections: sections };
    return score;
  };
  const section = (type, ranges) => ({ type: type, chordPositionRanges: ranges });
  const parts = () => [
    section('verse', [{ start: 16, end: 87, lyricLineIds: ['1.1'] }]),
    section('verse', [{ start: 16, end: 94, lyricLineIds: ['2.2'] }]),
  ];

  // The music the third ending is sung after belongs to it: the parts sang it in turn as
  // verses 1 and 2, and sing it together on the way into the ending.
  const together = [
    { start: 16, end: 87, lyricLineIds: ['1.1', '2.2'] },
    { start: 94, end: 114, lyricLineIds: ['1.1'] },
  ];

  it('should fold the shared music into a closing section with no type of its own', () => {
    // "Love Is Spoken Here" prints "(3rd ending)" over its closing words, which numbers
    // nothing, so on a score that labels its other verses the stanza is left unclassified --
    // and the together pass was built without it, while the same song read from supplied
    // words (whose text says [Verse 3]) built it with.
    const sections = parts().concat(section('unknown', [{ start: 94, end: 114, lyricLineIds: ['1.1'] }]));
    twoPartScore(sections)._splitTwoPartFinalPass([]);

    expect(sections).toHaveLength(3);
    expect(sections[2].chordPositionRanges).toEqual(together);
    // It is the verses before it sung at once, so it is one of them
    expect(sections[2].type).toBe('verse');
  });

  it('should do the same where the words did classify it', () => {
    const sections = parts().concat(section('verse', [{ start: 94, end: 114, lyricLineIds: ['1.1'] }]));
    twoPartScore(sections)._splitTwoPartFinalPass([]);

    expect(sections).toHaveLength(3);
    expect(sections[2].chordPositionRanges).toEqual(together);
  });

  it('should leave a closing section that starts inside the music the parts share', () => {
    // Only where the last section begins past all of it are the parts singing it together
    const sections = parts().concat(section('unknown', [{ start: 60, end: 114, lyricLineIds: ['1.1'] }]));
    twoPartScore(sections)._splitTwoPartFinalPass([]);

    expect(sections[2].chordPositionRanges).toEqual([{ start: 60, end: 114, lyricLineIds: ['1.1'] }]);
    expect(sections[2].type).toBe('unknown');
  });

  it('should leave a score whose parts are one lyric line alone', () => {
    const sections = [
      section('verse', [{ start: 16, end: 87, lyricLineIds: ['1.1'] }]),
      section('verse', [{ start: 16, end: 94, lyricLineIds: ['1.1'] }]),
      section('unknown', [{ start: 94, end: 114, lyricLineIds: ['1.1'] }]),
    ];
    twoPartScore(sections)._splitTwoPartFinalPass([]);

    expect(sections[2].chordPositionRanges).toEqual([{ start: 94, end: 114, lyricLineIds: ['1.1'] }]);
  });
});
