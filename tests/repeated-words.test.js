/**
 * Tests: _splitRunsAtRepeatedWords and _mergeRepeatedChorusRuns -- a chorus found by its words
 * coming round, and joined into one stanza when it is sung twice in a row.
 *
 * Runs are built from passages of { text, cp } syllables, each passage one run on line 1.1.
 * Phrase starts are given as chord positions, and _isWithinVerse answers from an empty melody
 * index (no verse carries on around anything) unless a test says otherwise.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';

let ChScore;

beforeAll(async () => {
  ({ ChScore } = await initChScore());
});

setupStandardHooks();

describe('_splitRunsAtRepeatedWords()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    score._melodyLyricElementIndex = () => ({ byChordPosition: new Map() });
  });

  const syllable = (text, cp) => ({ text, chordPositions: [cp], sectionType: null });
  const runOf = (syllables, extra = {}) => ({
    lyricLineId: '1.1', type: null, lastChordPosition: syllables.at(-1).chordPositions[0],
    syllables, ...extra,
  });
  // Words sung over consecutive chord positions from `from`
  const passage = (words, from) => words.split(' ').map((text, index) => syllable(text, from + index));
  const phraseStartsAt = (chordPositions) => ({ byLine: new Map([['1.1', new Set(chordPositions)]]) });
  const texts = (runs) => runs.map(run => [run.type, run.syllables.map(s => s.text).join(' ')]);

  const chorus = 'Geth sem a ne Je sus loves me';

  it('cuts out a chorus that comes round between verses, and types it', () => {
    // Verse 1, chorus, verse 2, chorus -- the chorus sung over the same notes both times
    const verse1 = passage('A way in a man ger', 0);
    const verse2 = passage('The cat tle are low ing', 20);
    const runs = [
      runOf([...verse1, ...passage(chorus, 10)]),
      runOf([...verse2, ...passage(chorus, 10)]),
    ];
    const split = score._splitRunsAtRepeatedWords(runs, phraseStartsAt([0, 10, 20]));
    expect(texts(split)).toEqual([
      [null, 'A way in a man ger'], ['chorus', chorus],
      [null, 'The cat tle are low ing'], ['chorus', chorus],
    ]);
  });

  it('trims words that agree by chance before the chorus back to a phrase start', () => {
    // "could go." and "long a-go." end the two verses on the same syllable
    const runs = [
      runOf([...passage('He could go', 0), ...passage(chorus, 10)]),
      runOf([...passage('long a go', 20), ...passage(chorus, 10)]),
    ];
    const split = score._splitRunsAtRepeatedWords(runs, phraseStartsAt([0, 10, 20]));
    expect(split.filter(run => run.type === 'chorus').map(run => run.syllables[0].text))
      .toEqual(['Geth', 'Geth']);
  });

  it('leaves a passage reworded over the notes both copies share', () => {
    // One chorus sung twice, changing its words partway through the same music -- at a phrase
    // start, so only where the change falls tells it from a chorus coming round
    const runs = [
      runOf([...passage('Verse words here', 0), ...passage(`${chorus} gave this`, 10)]),
      runOf(passage(`${chorus} gives this`, 10)),
    ];
    const split = score._splitRunsAtRepeatedWords(runs, phraseStartsAt([0, 10, 18]));
    expect(split).toBe(runs);
  });

  it('leaves copies that part company in the middle of a phrase', () => {
    const runs = [
      runOf([...passage('Verse one', 0), ...passage(`${chorus} to lead me home`, 10)]),
      runOf([...passage('Verse two', 30), ...passage(`${chorus} to lead`, 10), ...passage('us home', 40)]),
    ];
    const split = score._splitRunsAtRepeatedWords(runs, phraseStartsAt([0, 10, 30]));
    expect(split).toBe(runs);
  });

  it('leaves a song that is one passage sung again and again', () => {
    // "For Health and Strength": nothing but the passage, so no verse for it to alternate with
    const runs = [runOf(passage(chorus, 0)), runOf(passage(chorus, 0))];
    expect(score._splitRunsAtRepeatedWords(runs, phraseStartsAt([0]))).toBe(runs);
  });

  it('leaves a passage no longer than a line sung alone', () => {
    const runs = [
      runOf([...passage('Verse one', 0), ...passage('Geth sem a ne Je sus', 10)]),
      runOf([...passage('Verse two', 30), ...passage('Geth sem a ne Je sus', 10)]),
    ];
    expect(score._splitRunsAtRepeatedWords(runs, phraseStartsAt([0, 10, 30]))).toBe(runs);
  });

  it('leaves the verse\'s own refrain, which the verse sings its way through', () => {
    score._isWithinVerse = () => true;
    const runs = [
      runOf([...passage('Verse one', 0), ...passage(chorus, 10)]),
      runOf([...passage('Verse two', 30), ...passage(chorus, 10)]),
    ];
    try {
      expect(score._splitRunsAtRepeatedWords(runs, phraseStartsAt([0, 10, 30]))).toBe(runs);
    } finally {
      delete score._isWithinVerse;
    }
  });

  it('leaves stanzas whose sections are already known', () => {
    const runs = [
      runOf([...passage('Verse one', 0), ...passage(chorus, 10)].map(s => ({ ...s, sectionType: 'verse' }))),
      runOf([...passage('Verse two', 30), ...passage(chorus, 10)].map(s => ({ ...s, sectionType: 'verse' }))),
    ];
    expect(score._splitRunsAtRepeatedWords(runs, phraseStartsAt([0, 10, 30]))).toBe(runs);
  });
});

describe('_mergeRepeatedChorusRuns()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  const run = (lyricLineId, words, from, extra = {}) => ({
    lyricLineId, type: 'chorus', syllables: words.split(' ').map((text, index) => ({
      text, chordPositions: [from + index],
    })), ...extra,
  });

  it('joins a chorus sung twice to the same words', () => {
    const merged = score._mergeRepeatedChorusRuns([run('1.1', 'Scat ter sun shine', 0), run('1.1', 'Scat ter sun shine', 0)]);
    expect(merged).toHaveLength(1);
  });

  it('joins a chorus sung twice in a row over the same music, reworded', () => {
    // "Gethsemane" closes on its chorus twice, the second time on the line below
    const merged = score._mergeRepeatedChorusRuns([
      run('1.1', 'So He gave this gift', 10), run('1.2', 'So He gives this gift', 10),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].syllables).toHaveLength(10);
  });

  it('keeps two choruses on different music apart', () => {
    const merged = score._mergeRepeatedChorusRuns([run('1.1', 'One chorus', 0), run('1.1', 'Another chorus', 20)]);
    expect(merged).toHaveLength(2);
  });

  it('keeps verses repeated over the same music apart', () => {
    const merged = score._mergeRepeatedChorusRuns([
      run('1.1', 'Verse one', 0, { type: 'verse' }), run('1.2', 'Verse two', 0, { type: 'verse' }),
    ]);
    expect(merged).toHaveLength(2);
  });
});
