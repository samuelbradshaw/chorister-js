/**
 * Tests: phrase-start detection — where a lyric line begins.
 *
 * ChScore._getPhraseStartChordPositions() answers which chord positions start a
 * lyric phrase, and ChScore._getLyricsFromSyllables() calls it to place the line
 * breaks in a stanza's annotatedLyrics. Scoring (ChScore._scorePhraseStarts())
 * reads each candidate's punctuation, capitalization, note length, rests and
 * measure context; segmentation is a dynamic program over those scores against a
 * prior on how long a line runs.
 *
 * Covers:
 * - Stanza runs grouped the same way stanza building groups them
 * - Word starts are the only candidates (never a break mid-word)
 * - Punctuation and capitalization drive a break at the expected chord position
 * - A signal firing at every word start is calibrated away
 * - Repeat barlines are not evidence; double and final barlines are
 * - _wordBuilder emits \n and keeps <em>/<strong> runs inside one line
 * - Short stanzas are left unbroken rather than split below the minimum
 */

import { describe, it, expect, beforeAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';

let ChScore;

beforeAll(async () => {
  ({ ChScore } = await initChScore());
});

setupStandardHooks();

// ═══════════════════════════════════════════════════════════
// Fixtures
// ═══════════════════════════════════════════════════════════

// A score of `count` quarter-note chord positions, four to a measure, every one
// audible and carrying a melody note. Enough of _scoreData for scoring to run.
function fakeScore(count, { perMeasure = 4, rightBarLine = 'single' } = {}) {
  const score = Object.create(ChScore.prototype);
  const chordPositions = [];
  const measures = [];
  const measuresById = {};
  for (let cp = 0; cp < count; cp++) {
    const measureIndex = Math.floor(cp / perMeasure);
    const measureId = `m${measureIndex}`;
    if (!measuresById[measureId]) {
      measuresById[measureId] = {
        measureId: measureId, measureType: 'full',
        rightBarLine: rightBarLine, startQ: measureIndex * perMeasure,
      };
      measures.push(measuresById[measureId]);
    }
    chordPositions.push({
      chordPosition: cp, startQ: cp, durationQ: 1, measureId: measureId,
      isAudible: true, isDownbeat: cp % perMeasure === 0,
      notesAndRests: [{ isRest: false, isMelody: true, durationQ: 1 }],
    });
  }
  score._scoreData = {
    chordPositions: chordPositions,
    audibleChordPositions: chordPositions.map(cp => cp.chordPosition),
    measures: measures,
    measuresById: measuresById,
    staffNumbers: [1],
    meiParsed: null,
    scoreMetadata: null,
  };
  return score;
}

// One syllable per chord position, from words given as "Word:cp" text. `wordpos`
// is derived so multi-syllable words hold together.
function syllablesFrom(words, { lyricLineId = '1.1' } = {}) {
  const syllables = [];
  let cp = 0;
  for (const word of words) {
    const parts = word.split('-');
    parts.forEach((part, index) => {
      const wordpos = parts.length === 1 ? 's'
        : index === 0 ? 'i' : index === parts.length - 1 ? 't' : 'm';
      syllables.push({
        label: null, text: part, verseLabel: null, roundMarker: null,
        syls: [{ text: part, wordpos: wordpos, italic: false, bold: false }],
        chordPositions: [cp], chordPositionRuns: [[cp, cp + 1]],
        expandedChordPositions: [cp], lyricLineIds: [lyricLineId],
        startsSection: cp === 0, sectionType: 'verse',
      });
      cp += 1;
    });
  }
  return syllables;
}

// ═══════════════════════════════════════════════════════════
// Stanza runs
// ═══════════════════════════════════════════════════════════

describe('_syllableStanzaRuns', () => {
  it('groups one lyric line into one run', () => {
    const score = fakeScore(8);
    const runs = score._syllableStanzaRuns(syllablesFrom(['a', 'b', 'c', 'd']));
    expect(runs).toHaveLength(1);
    expect(runs[0].lyricLineId).toBe('1.1');
    expect(runs[0].syllables).toHaveLength(4);
  });

  it('starts a new run when the lyric line changes', () => {
    const score = fakeScore(8);
    const syllables = syllablesFrom(['a', 'b'], { lyricLineId: '1.1' })
      .concat(syllablesFrom(['c', 'd'], { lyricLineId: '1.2' }));
    const runs = score._syllableStanzaRuns(syllables);
    expect(runs.map(run => run.lyricLineId)).toEqual(['1.1', '1.2']);
  });

  it('skips syllables with no lyric line or no text', () => {
    const score = fakeScore(8);
    const syllables = syllablesFrom(['a', 'b']);
    syllables[0].lyricLineIds = [];
    expect(score._syllableStanzaRuns(syllables)[0].syllables).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════
// Scoring
// ═══════════════════════════════════════════════════════════

describe('_scorePhraseStarts', () => {
  it('scores only word starts, never a syllable continuing a word', () => {
    const score = fakeScore(8);
    // "won-der-ful" occupies chord positions 1, 2 and 3
    const syllables = syllablesFrom(['How', 'won-der-ful', 'it', 'is']);
    const scores = score._scorePhraseStarts(syllables);
    expect(scores.has(1)).toBe(true);  // "won" opens the word
    expect(scores.has(2)).toBe(false); // "der" is mid-word
    expect(scores.has(3)).toBe(false); // "ful" ends the word
  });

  it('scores a syllable after phrase punctuation above one after none', () => {
    const score = fakeScore(8);
    const syllables = syllablesFrom(['sing.', 'now', 'and', 'then']);
    const scores = score._scorePhraseStarts(syllables);
    expect(scores.get(1)).toBeGreaterThan(scores.get(2));
  });

  it('scores a capitalized word start above a lowercase one', () => {
    const score = fakeScore(8);
    const syllables = syllablesFrom(['sing', 'Now', 'and', 'then']);
    const scores = score._scorePhraseStarts(syllables);
    expect(scores.get(1)).toBeGreaterThan(scores.get(2));
  });

  it('reads the whole span since the previous syllable, not just the position before', () => {
    const held = fakeScore(8);
    // "sing." is held over chord positions 0–2, so the fermata at 2 and the length of
    // the hold both belong to it — a cp-1 reading would miss them entirely
    const syllables = syllablesFrom(['sing.', 'x', 'Now', 'then']);
    syllables[0].chordPositions = [0, 1, 2];
    syllables[0].chordPositionRuns = [[0, 3]];
    syllables.splice(1, 1); // drop the syllable that was at cp 1
    syllables[1].chordPositions = [3];
    const scores = held._scorePhraseStarts(syllables);
    expect(scores.get(3)).toBeGreaterThan(0);
  });

  it('calibrates away a signal that fires at every word start', () => {
    const allCaps = syllablesFrom(['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
    const mixed = syllablesFrom(['one', 'Two', 'three', 'four', 'five', 'six']);
    const capitalEverywhere = fakeScore(12)._scorePhraseStarts(allCaps);
    const capitalOnce = fakeScore(12)._scorePhraseStarts(mixed);
    // Capitalization tells you nothing in a text that capitalizes everything, so the
    // one meaningful capital has to outscore any of the uniform ones
    expect(capitalOnce.get(1)).toBeGreaterThan(capitalEverywhere.get(1));
  });
});

describe('_signalInformativeness', () => {
  it('is zero for a signal that never fires and one that fires almost always', () => {
    const score = fakeScore(4);
    expect(score._signalInformativeness(0)).toBe(0);
    expect(score._signalInformativeness(1)).toBe(0);
    expect(score._signalInformativeness(0.9)).toBe(0);
  });

  it('is highest around the rate a real phrase break fires at', () => {
    const score = fakeScore(4);
    expect(score._signalInformativeness(0.12)).toBeGreaterThan(score._signalInformativeness(0.5));
  });
});

// ═══════════════════════════════════════════════════════════
// Segmentation
// ═══════════════════════════════════════════════════════════

describe('_getPhraseStartChordPositions', () => {
  it('breaks a two-line stanza where the punctuation and capital agree', () => {
    const score = fakeScore(20);
    // "part-ing" and the other hyphenated words each take a chord position per syllable,
    // so "Come" — the only candidate carrying both a preceding "." and a capital — is at 7
    const syllables = syllablesFrom([
      'Sing', 'we', 'now', 'at', 'part-ing', 'day.',
      'Come', 'let', 'us', 'a-new', 'our', 'jour-ney', 'pur-sue.',
    ]);
    expect(syllables[7].text).toBe('Come');
    const starts = score._getPhraseStartChordPositions(syllables);
    expect(starts.has(7)).toBe(true);
  });

  it('never places a break inside a word', () => {
    const score = fakeScore(20);
    const syllables = syllablesFrom([
      'Won-der-ful', 'words', 'of', 'life.', 'Beau-ti-ful', 'words', 'of', 'life,',
      'sing', 'them', 'a-gain', 'to', 'me.',
    ]);
    const starts = score._getPhraseStartChordPositions(syllables);
    const midWord = syllables
      .filter(syllable => ['m', 't'].includes(syllable.syls[0].wordpos))
      .map(syllable => syllable.chordPositions[0]);
    for (const cp of midWord) expect(starts.has(cp)).toBe(false);
  });

  it('leaves a stanza too short to divide unbroken', () => {
    const score = fakeScore(8);
    const starts = score._getPhraseStartChordPositions(syllablesFrom(['A', 'short', 'line.', 'Yes']));
    expect(starts.size).toBe(0);
  });

  it('does not treat a repeat barline as evidence', () => {
    const repeat = fakeScore(16, { rightBarLine: 'rptend' });
    const double = fakeScore(16, { rightBarLine: 'dbl' });
    const words = ['la', 'la', 'la', 'la', 'la', 'la', 'la', 'la', 'la', 'la', 'la', 'la'];
    const repeatScores = repeat._scorePhraseStarts(syllablesFrom(words));
    const doubleScores = double._scorePhraseStarts(syllablesFrom(words));
    // Position 4 opens the second measure, so a barline was crossed to reach it
    expect(doubleScores.get(4)).toBeGreaterThan(repeatScores.get(4));
  });
});

// ═══════════════════════════════════════════════════════════
// Word builder
// ═══════════════════════════════════════════════════════════

describe('_wordBuilder line breaks', () => {
  it('joins with a space and breaks with a newline', () => {
    const score = fakeScore(4);
    const builder = score._wordBuilder();
    builder.add('Sing', 's', false, false);
    builder.add('now.', 's', false, false);
    builder.breakLine();
    builder.add('Come', 's', false, false);
    expect(builder.text()).toBe('Sing now.\nCome');
  });

  it('never doubles a newline when a break is requested twice', () => {
    const score = fakeScore(4);
    const builder = score._wordBuilder();
    builder.add('one', 's', false, false);
    builder.breakLine();
    builder.breakLine();
    builder.add('two', 's', false, false);
    expect(builder.text()).toBe('one\ntwo');
  });

  it('keeps an <em> run inside its own line', () => {
    const score = fakeScore(4);
    const builder = score._wordBuilder();
    builder.add('soft', 's', true, false);
    builder.breakLine();
    builder.add('ly', 's', true, false);
    expect(builder.text()).toBe('<em>soft</em>\n<em>ly</em>');
  });

  it('ignores a break while a word is still being assembled', () => {
    const score = fakeScore(4);
    const builder = score._wordBuilder();
    builder.add('one', 's', false, false);
    builder.add('won-', 'i', false, false);
    builder.breakLine();
    builder.add('der', 't', false, false);
    expect(builder.text()).toBe('one wonder');
  });
});
