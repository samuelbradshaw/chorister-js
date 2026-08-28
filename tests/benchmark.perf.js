/**
 * Timing harness for lyric alignment and folding. Not part of `npm test` — it runs
 * under its own config (`npm run bench`, vitest.bench.config.js) because setup.js
 * needs the vitest runtime for its Magenta mock.
 *
 * Each fixture is loaded twice: with lyricsText, which takes _alignSyllablesToLyrics,
 * and without, which takes _getLyricsFromSyllables. The Python parser only ever does
 * the second — bridge.js passes no lyrics — so the two columns are different audiences.
 *
 * Reports the median of REPS runs after a warmup, since the first load pays for
 * Verovio's WASM module.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import './setup.js';
import { initChScore } from './helpers.js';
import {
  sampleMusicXmlHGW, sampleLyricsHGW, hgwPartsTemplate, hgwFermatas,
  sampleMusicXmlIIW, sampleLyricsIIW, iiwParts, iiwSections, iiwFermatas,
  sampleMusicXmlTLL, sampleLyricsTLL, tllPartsTemplate, tllFermatas,
} from './song-data.js';

const REPS = 5;

let ChScore;
beforeAll(async () => { ({ ChScore } = await initChScore()); });

// Deliberately wrong lyrics for the score, so every syllable misses the exact match and
// falls through to the fuzzy scan — the path the matching fixtures never reach.
const MISMATCH = {
  name: 'How Great (mismatched lyrics)',
  inputData: { scoreContent: sampleMusicXmlHGW, partsTemplate: hgwPartsTemplate, fermatas: hgwFermatas },
  lyricsText: sampleLyricsIIW,
  alignedOnly: true,
};

const songs = [
  {
    name: 'How Great the Wisdom',
    inputData: { scoreContent: sampleMusicXmlHGW, partsTemplate: hgwPartsTemplate, fermatas: hgwFermatas },
    lyricsText: sampleLyricsHGW,
  },
  {
    name: 'It Is Well with My Soul',
    inputData: { scoreContent: sampleMusicXmlIIW, parts: iiwParts, sections: iiwSections, fermatas: iiwFermatas },
    lyricsText: sampleLyricsIIW,
  },
  {
    name: 'This Little Light of Mine',
    inputData: { scoreContent: sampleMusicXmlTLL, partsTemplate: tllPartsTemplate, fermatas: tllFermatas },
    lyricsText: sampleLyricsTLL,
  },
];

/** Count calls and wall time through a prototype method, restoring it afterwards. */
function instrument(names) {
  const stats = {};
  const originals = {};
  for (const name of names) {
    stats[name] = { calls: 0, ms: 0 };
    originals[name] = ChScore.prototype[name];
    ChScore.prototype[name] = function (...args) {
      stats[name].calls++;
      const t0 = performance.now();
      try { return originals[name].apply(this, args); }
      finally { stats[name].ms += performance.now() - t0; }
    };
  }
  return { stats, restore: () => Object.assign(ChScore.prototype, originals) };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const TRACKED = [
  '_alignSyllablesToLyrics', '_getLyricsFromSyllables',
  '_normalizeLyricsForMatching', '_foldWord', '_lyricSimilarity', '_foldForMatching',
];

async function measure(inputData) {
  const samples = [];
  for (let rep = 0; rep <= REPS; rep++) {
    const probe = instrument(TRACKED);
    document.body.innerHTML = '<div id="bench-container"></div>';
    const score = new ChScore('#bench-container');
    ChScore.prototype._drawScore = function () {};

    const t0 = performance.now();
    await score.load('musicxml', inputData);
    const loadMs = performance.now() - t0;

    probe.restore();
    if (rep > 0) samples.push({ loadMs, stats: probe.stats }); // rep 0 is warmup
  }

  // Median every timing independently: one GC pause in one rep would otherwise be
  // reported as though it were the cost of whatever that rep happened to measure.
  const at = (pick) => median(samples.map(pick));
  return {
    loadMs: at(s => s.loadMs),
    align: at(s => s.stats._alignSyllablesToLyrics.ms),
    derive: at(s => s.stats._getLyricsFromSyllables.ms),
    normMs: at(s => s.stats._normalizeLyricsForMatching.ms),
    normCalls: samples[0].stats._normalizeLyricsForMatching.calls,
    foldWord: samples[0].stats._foldWord.calls,
    sims: samples[0].stats._lyricSimilarity.calls,
  };
}

describe('lyric alignment benchmark', () => {
  it('reports timings and call counts', async () => {
    const rows = [];
    for (const song of [...songs, MISMATCH]) {
      for (const withLyrics of song.alignedOnly ? [true] : [true, false]) {
        const inputData = withLyrics
          ? { ...song.inputData, lyricsText: song.lyricsText }
          : { ...song.inputData };
        const measured = await measure(inputData);
        rows.push({ song: song.name, mode: withLyrics ? 'aligned' : 'derived', ...measured });
      }
    }

    const n = (value, places = 2) => value.toFixed(places).padStart(8);
    console.log('\n' + 'song'.padEnd(28) + 'mode'.padEnd(9)
      + 'load ms'.padStart(9) + 'align ms'.padStart(9) + 'derive ms'.padStart(10)
      + 'normCalls'.padStart(11) + 'norm ms'.padStart(9) + 'foldWord'.padStart(10) + 'fuzzy'.padStart(7));
    for (const r of rows) {
      console.log(r.song.slice(0, 27).padEnd(28) + r.mode.padEnd(9)
        + n(r.loadMs, 1) + n(r.align) + n(r.derive)
        + String(r.normCalls).padStart(11) + n(r.normMs)
        + String(r.foldWord).padStart(10) + String(r.sims).padStart(7));
    }
    console.log('');

    expect(rows.length).toBe(songs.length * 2 + 1);
  }, 300000);

  // The mismatch path in isolation: both changes there only pay off when a syllable
  // misses, which the matching fixtures never do. Compared against the implementations
  // they replaced rather than asserted.
  it('compares the fuzzy-path internals against what they replaced', () => {
    const haystack = sampleLyricsHGW.toLowerCase().replace(/[^a-z]/g, '');
    const needles = ['great', 'wisdom', 'love', 'the', 'redeemer', 'zzzz'];
    const WINDOW = 20;
    const ROUNDS = 400;

    function fullMatrixSimilarity(str1, str2) {
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

    const score = new ChScore('#bench-container');
    const time = (label, fn) => {
      fn(); // warm
      const t0 = performance.now();
      fn();
      return { label, ms: performance.now() - t0 };
    };

    const oldSim = time('matrix + substring', () => {
      for (let r = 0; r < ROUNDS; r++) {
        for (const needle of needles) {
          for (let i = 0; i < WINDOW; i++) fullMatrixSimilarity(needle, haystack.substring(i, i + needle.length));
        }
      }
    });
    const newSim = time('rolling row, in place', () => {
      for (let r = 0; r < ROUNDS; r++) {
        for (const needle of needles) {
          for (let i = 0; i < WINDOW; i++) score._lyricSimilarity(needle, haystack, i, needle.length);
        }
      }
    });

    const oldScan = time('indexOf, unbounded', () => {
      for (let r = 0; r < ROUNDS; r++) {
        for (const needle of needles) {
          for (let pos = 0; pos < 200; pos++) {
            const at = haystack.indexOf(needle, pos);
            if (at !== -1 && at < pos + WINDOW) { /* accepted */ }
          }
        }
      }
    });
    const newScan = time('startsWith, windowed', () => {
      for (let r = 0; r < ROUNDS; r++) {
        for (const needle of needles) {
          for (let pos = 0; pos < 200; pos++) {
            const end = Math.min(pos + WINDOW, haystack.length);
            for (let i = pos; i < end; i++) if (haystack.startsWith(needle, i)) break;
          }
        }
      }
    });

    const pct = (before, after) => ((1 - after / before) * 100).toFixed(0) + '% faster';
    console.log('\n  _lyricSimilarity  ' + oldSim.label + '=' + oldSim.ms.toFixed(1) + 'ms'
      + '  ->  ' + newSim.label + '=' + newSim.ms.toFixed(1) + 'ms  (' + pct(oldSim.ms, newSim.ms) + ')');
    console.log('  exact-match scan  ' + oldScan.label + '=' + oldScan.ms.toFixed(1) + 'ms'
      + '  ->  ' + newScan.label + '=' + newScan.ms.toFixed(1) + 'ms  (' + pct(oldScan.ms, newScan.ms) + ')\n');

    expect(newSim.ms).toBeGreaterThan(0);
  }, 300000);
});
