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

describe('_lyricSimilarity()', () => {
  /** The original full-matrix implementation, kept here as the thing to agree with. */
  function referenceSimilarity(str1, str2) {
    const matrix = Array(str1.length + 1).fill(null).map(() => Array(str2.length + 1).fill(0));
    let maxLen = 0;
    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1] + 1;
          maxLen = Math.max(maxLen, matrix[i][j]);
        }
      }
    }
    return str1.length + str2.length > 0 ? (maxLen * 2) / (str1.length + str2.length) : 0;
  }

  const PAIRS = [
    ['', ''], ['', 'abc'], ['abc', ''],
    ['abc', 'abc'], ['abc', 'xyz'],
    ['great', 'greet'], ['wisdom', 'wisdon'], ['love', 'glove'],
    ['a', 'aaaa'], ['aaaa', 'a'], ['abcabc', 'cabcab'],
    ['thelord', 'thelamb'], ['ebenezer', 'ebenezer'],
  ];

  it.each(PAIRS)('should score %j against %j exactly as the full matrix did', (a, b) => {
    expect(score._lyricSimilarity(a, b)).toBe(referenceSimilarity(a, b));
  });

  it('should read a window of the haystack the same as a substring of it', () => {
    const haystack = 'howgreatthewisdomandthelove';
    for (let i = 0; i < haystack.length; i++) {
      for (const needle of ['great', 'wisdom', 'zzz', 'the']) {
        expect(score._lyricSimilarity(needle, haystack, i, needle.length))
          .toBe(referenceSimilarity(needle, haystack.substring(i, i + needle.length)));
      }
    }
  });

  it('should reuse its row buffer without leaking state between calls', () => {
    const first = score._lyricSimilarity('abcdefgh', 'abcdefgh');
    score._lyricSimilarity('zz', 'zz');           // shorter, reuses the same buffer
    expect(score._lyricSimilarity('abcdefgh', 'abcdefgh')).toBe(first);
  });
});
