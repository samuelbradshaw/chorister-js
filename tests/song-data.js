/**
 * Song-specific test data for the three demo songs.
 *
 * Provides, for each song:
 * - MusicXML file content
 * - Lyrics text file content
 * - Expected chord position counts (independently verified)
 * - Fermata configuration
 *
 * For "It Is Well" (explicit parts/sections rather than a partsTemplate):
 * - Parts configuration (iiwParts)
 * - Sections configuration (iiwSections)
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const resourcesDir = resolve(import.meta.dirname, '..', 'resources');

// ── MusicXML file contents ────────────────────────────────────

export const sampleMusicXmlHGW = readFileSync(
  resolve(resourcesDir, 'how-great-the-wisdom-and-the-love.musicxml'), 'utf-8'
);
export const sampleMusicXmlIIW = readFileSync(
  resolve(resourcesDir, 'it-is-well-with-my-soul.musicxml'), 'utf-8'
);
export const sampleMusicXmlTLL = readFileSync(
  resolve(resourcesDir, 'this-little-light-of-mine.musicxml'), 'utf-8'
);

// ── Lyrics text file contents ─────────────────────────────────

export const sampleLyricsHGW = readFileSync(
  resolve(resourcesDir, 'how-great-the-wisdom-and-the-love.txt'), 'utf-8'
);
export const sampleLyricsIIW = readFileSync(
  resolve(resourcesDir, 'it-is-well-with-my-soul.txt'), 'utf-8'
);
export const sampleLyricsTLL = readFileSync(
  resolve(resourcesDir, 'this-little-light-of-mine.txt'), 'utf-8'
);

// ── Expected chord position counts (independently verified) ──

export const EXPECTED_HGW = { total: 37, audible: 37, expanded: 156, audibleExpanded: 156 };
export const EXPECTED_IIW = { total: 64, audible: 64, expanded: 278, audibleExpanded: 278 };
export const EXPECTED_TLL = { total: 61, audible: 58, expanded: 100, audibleExpanded: 94 };

// ── partsTemplate strings ────────────────────────────────────

export const hgwPartsTemplate = 'SATB';
export const tllPartsTemplate = 'MC';

// ── Fermata configurations ────────────────────────────────────

export const hgwFermatas = [{ chordPosition: 28, durationFactor: 2.5 }];

export const iiwFermatas = [{ chordPosition: 41, durationFactor: 3 }];

export const tllFermatas = [
  { chordPosition: 14, durationFactor: 2 },
  { chordPosition: 20, durationFactor: 2 },
  { chordPosition: 26, durationFactor: 2 },
  { chordPosition: 32, durationFactor: 2 },
  { chordPosition: 38, durationFactor: 2 },
  { chordPosition: 44, durationFactor: 2 },
];

// ── IIW parts configuration (mirrors demo.html) ───────────────

export const iiwParts = [
  {
    partId: 'descant', name: 'Descant', isVocal: true, placement: 'auto',
    chordPositionRefs: {
      '0': { isMelody: false, staffNumbers: [1], lyricLineIds: ['1.1'] },
    },
  },
  {
    partId: 'soprano', name: 'Soprano', isVocal: true, placement: 'auto',
    chordPositionRefs: {
      '0': { isMelody: true, staffNumbers: [2], lyricLineIds: ['2.1', '2.2', '2.3', '2.4'] },
      '42': { isMelody: true, staffNumbers: [2], lyricLineIds: ['2.1'] },
    },
  },
  {
    partId: 'alto', name: 'Alto', isVocal: true, placement: 'auto',
    chordPositionRefs: {
      '0': { isMelody: false, staffNumbers: [2], lyricLineIds: ['2.1', '2.2', '2.3', '2.4'] },
      '42': { isMelody: false, staffNumbers: [2], lyricLineIds: ['2.1'] },
    },
  },
  {
    partId: 'tenor', name: 'Tenor', isVocal: true, placement: 'auto',
    chordPositionRefs: {
      '0': { isMelody: false, staffNumbers: [3], lyricLineIds: ['2.1', '2.2', '2.3', '2.4'] },
      '42': { isMelody: false, staffNumbers: [3], lyricLineIds: ['2.1'] },
    },
  },
  {
    partId: 'bass', name: 'Bass', isVocal: true, placement: 'auto',
    chordPositionRefs: {
      '0': { isMelody: false, staffNumbers: [3], lyricLineIds: ['2.1', '2.2', '2.3', '2.4'] },
      '42': { isMelody: false, staffNumbers: [3], lyricLineIds: ['2.1'] },
    },
  },
];

// ── IIW sections configuration (mirrors demo.html) ────────────

export const iiwSections = [
  {
    sectionId: 'introduction', type: 'introduction', name: 'Introduction',
    marker: null, placement: 'inline', pauseAfter: false,
    chordPositionRanges: [
      { start: 0, end: 13, staffNumbers: [2, 3], lyricLineIds: [] },
      { start: 55, end: 64, staffNumbers: [2, 3], lyricLineIds: [] },
    ],
  },
  {
    sectionId: 'verse-1', type: 'verse', name: 'Verse 1',
    marker: '1', placement: 'inline', pauseAfter: false,
    chordPositionRanges: [
      { start: 0, end: 42, staffNumbers: [2, 3], lyricLineIds: ['2.1'] },
    ],
  },
  {
    sectionId: 'chorus-1', type: 'chorus', name: 'Chorus',
    marker: null, placement: 'inline', pauseAfter: false,
    chordPositionRanges: [
      { start: 42, end: 64, staffNumbers: [2, 3], lyricLineIds: ['2.1', '3.1'] },
    ],
  },
  {
    sectionId: 'verse-2', type: 'verse', name: 'Verse 2',
    marker: '2', placement: 'inline', pauseAfter: false,
    chordPositionRanges: [
      { start: 0, end: 42, staffNumbers: [2, 3], lyricLineIds: ['2.2'] },
    ],
  },
  {
    sectionId: 'chorus-2', type: 'chorus', name: 'Chorus',
    marker: null, placement: 'inline', pauseAfter: false,
    chordPositionRanges: [
      { start: 42, end: 64, staffNumbers: [2, 3], lyricLineIds: ['2.1', '3.1'] },
    ],
  },
  {
    sectionId: 'verse-3', type: 'verse', name: 'Verse 3',
    marker: '3', placement: 'inline', pauseAfter: false,
    chordPositionRanges: [
      { start: 0, end: 42, staffNumbers: [2, 3], lyricLineIds: ['2.3'] },
    ],
  },
  {
    sectionId: 'chorus-3', type: 'chorus', name: 'Chorus',
    marker: null, placement: 'inline', pauseAfter: false,
    chordPositionRanges: [
      { start: 42, end: 64, staffNumbers: [2, 3], lyricLineIds: ['2.1', '3.1'] },
    ],
  },
  {
    sectionId: 'verse-4', type: 'verse', name: 'Verse 4',
    marker: '4', placement: 'inline', pauseAfter: false,
    chordPositionRanges: [
      { start: 0, end: 42, staffNumbers: [2, 3], lyricLineIds: ['2.4'] },
    ],
  },
  {
    sectionId: 'chorus-4', type: 'chorus', name: 'Chorus',
    marker: null, placement: 'inline', pauseAfter: false,
    chordPositionRanges: [
      { start: 42, end: 64, staffNumbers: [1, 2, 3], lyricLineIds: ['1.1', '2.1', '3.1'] },
    ],
  },
];
