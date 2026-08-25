/**
 * Tests: the text folds — _foldText and the two policies built on it.
 *
 * _foldWord's fixtures are mirrored in the repo's tests/test_textfold.py, which
 * exercises the Python half of the same contract: harvesting produces the word
 * lists _hyphenPositionsTable indexes, so the two folds have to agree character
 * for character. A case added in one place belongs in the other.
 *
 * _foldForMatching folds harder, and deliberately: it compares text from two
 * different hands, where _foldWord has to keep the spelling it looks up.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import './setup.js';
import { initChScore } from './helpers.js';

let ChScore;
let score;

beforeAll(async () => {
  ({ ChScore } = await initChScore());
  document.body.innerHTML = '<div id="score-container"></div>';
  score = new ChScore('#score-container');
});

// [input, folded] -- mirrored in tests/test_textfold.py
const WORD_FIXTURES = [
  ['Latter-day', 'latterday'],
  ['Adam‐ondi‐Ahman', 'adamondiahman'],
  ['Ében-Ézer', 'ébenézer'],
  ['“ében-ézer!”', 'ébenézer'],
  ["ev'ry", 'ev’ry'],
  ['ev’ry', 'ev’ry'],
  ['naïve', 'naïve'],
  ['_latter-day_', 'latterday'],
  ['2nd', '2nd'],
  ['—', ''],
  ['', ''],
];

describe('_foldWord()', () => {
  it.each(WORD_FIXTURES)('should fold %j to %j', (word, expected) => {
    expect(score._foldWord(word)).toBe(expected);
  });

  it('should keep the accents that tell hyphen-table entries apart', () => {
    expect(score._foldWord('Ében-Ézer')).not.toBe('ebenezer');
  });

  it('should keep the apostrophe that tells a function word from an ordinary one', () => {
    // Stripping it would collapse these onto "well" and "ill", which end real lines
    expect(score._foldWord('we’ll')).not.toBe('well');
    expect(score._foldWord('I’ll')).not.toBe('ill');
  });

  it('should survive a null or undefined word', () => {
    expect(score._foldWord(null)).toBe('');
    expect(score._foldWord(undefined)).toBe('');
  });
});

describe('_foldForMatching()', () => {
  it('should strip accents, punctuation, digits and symbols', () => {
    expect(score._foldForMatching('Ében-Ézer')).toBe('ebenezer');
    expect(score._foldForMatching('3. Sweet hour')).toBe('sweet hour');
    expect(score._foldForMatching('Copyright © 2012')).toBe('copyright');
  });

  it('should drop the markup a styled block carries', () => {
    expect(score._foldForMatching('<em>Words:</em> Anon.')).toBe('words anon');
  });

  it('should remove whitespace entirely when asked', () => {
    expect(score._foldForMatching('Sweet hour of prayer', 'remove')).toBe('sweethourofprayer');
    // A printed verse number folds away, which is what lines the line up with the syllables
    expect(score._foldForMatching('3. Sweet hour of prayer', 'remove')).toBe('sweethourofprayer');
  });

  it('should fold the two apostrophe spellings together', () => {
    expect(score._foldForMatching("ev'ry")).toBe(score._foldForMatching('ev’ry'));
  });
});

describe('_foldText()', () => {
  it('should keep everything but case by default', () => {
    expect(score._foldText('  Ében-Ézer!  ')).toBe('  ében-ézer!  ');
  });

  it('should collapse whitespace on request', () => {
    expect(score._foldText('THE   LORD', { whitespace: 'collapse' })).toBe('the lord');
  });

  it('should recompose an accent it was not told to strip', () => {
    // NFD internally, so what comes back has to be a single precomposed character again
    expect(score._foldText('é').length).toBe(1);
  });
});
