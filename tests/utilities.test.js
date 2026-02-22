/**
 * Tests: Utility functions and template parsing.
 *
 * Covers: _getKeySignatures, _buildPartsFromTemplate, _binaryFind, _bisectLeft,
 * _qstampToTstamp, _getMidiDuration, _debounce, _isThrottled, _getQpmAtTime,
 * _normalizeChordSets, _markSingleLineChordPositions, _getInlineVerseNumbers
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks, resetScoreState, sampleMusicXml, sampleMusicXml2 } from './helpers.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// ============================================================
// Key Signatures
// ============================================================
describe('_getKeySignatures()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should return major key signatures by default', () => {
    const keys = score._getKeySignatures();
    expect(keys).toBeDefined();
    expect(keys['c-major']).toBeDefined();
    expect(keys['c-major'].tonality).toBe('major');
    expect(keys['c-major'].name).toBe('C major');
  });

  it('should return 15 major key signatures', () => {
    const keys = score._getKeySignatures('major');
    expect(Object.keys(keys).length).toBe(15);
  });

  it('should return 15 minor key signatures', () => {
    const keys = score._getKeySignatures('minor');
    expect(Object.keys(keys).length).toBe(15);
  });

  it('should include expected major keys', () => {
    const keys = score._getKeySignatures('major');
    const expectedKeys = [
      'g-flat-major', 'g-major', 'a-flat-major', 'a-major',
      'b-flat-major', 'b-major', 'c-flat-major', 'c-major',
      'c-sharp-major', 'd-flat-major', 'd-major', 'e-flat-major',
      'e-major', 'f-major', 'f-sharp-major',
    ];
    for (const key of expectedKeys) {
      expect(keys[key]).toBeDefined();
    }
  });

  it('should include expected minor keys', () => {
    const keys = score._getKeySignatures('minor');
    const expectedKeys = [
      'g-minor', 'g-sharp-minor', 'g-flat-minor', 'a-minor',
      'a-sharp-minor', 'b-flat-minor', 'b-minor', 'c-minor',
      'c-sharp-minor', 'd-minor', 'd-sharp-minor', 'e-flat-minor',
      'e-minor', 'f-minor', 'f-sharp-minor',
    ];
    for (const key of expectedKeys) {
      expect(keys[key]).toBeDefined();
    }
  });

  it('should have MIDI pitch values for each key', () => {
    const majorKeys = score._getKeySignatures('major');
    for (const [id, info] of Object.entries(majorKeys)) {
      expect(info.midiPitch).toBeGreaterThanOrEqual(54);
      expect(info.midiPitch).toBeLessThanOrEqual(66);
    }
  });

  it('should have consistent properties for each key', () => {
    const majorKeys = score._getKeySignatures('major');
    for (const [id, info] of Object.entries(majorKeys)) {
      expect(info).toHaveProperty('mxlFifths');
      expect(info).toHaveProperty('meiSig');
      expect(info).toHaveProperty('meiPnameAccid');
      expect(info).toHaveProperty('midiPitch');
      expect(info).toHaveProperty('tonality');
      expect(info).toHaveProperty('name');
    }
  });

  it('C major should have 0 fifths and MIDI pitch 60', () => {
    const keys = score._getKeySignatures('major');
    expect(keys['c-major'].mxlFifths).toBe('0');
    expect(keys['c-major'].midiPitch).toBe(60);
    expect(keys['c-major'].meiSig).toBe('0');
  });

  it('A minor should have 0 fifths and MIDI pitch 57', () => {
    const keys = score._getKeySignatures('minor');
    expect(keys['a-minor'].mxlFifths).toBe('0');
    expect(keys['a-minor'].midiPitch).toBe(57);
  });
});

// ============================================================
// Parts Template Parsing (_buildPartsFromTemplate)
// ============================================================
describe('_buildPartsFromTemplate()', () => {
  let score;
  const staffNumbers = [1, 2];
  const numChordPositions = 64;
  const hasLyrics = true;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should parse SATB template into 4 parts + accompaniment', () => {
    const parts = score._buildPartsFromTemplate('SATB', staffNumbers, numChordPositions, hasLyrics);
    const partIds = parts.map(p => p.partId);
    expect(partIds).toContain('soprano');
    expect(partIds).toContain('alto');
    expect(partIds).toContain('tenor');
    expect(partIds).toContain('bass');
  });

  it('should assign soprano and alto to staff 1, tenor and bass to staff 2 for SATB', () => {
    const parts = score._buildPartsFromTemplate('SATB', staffNumbers, numChordPositions, hasLyrics);
    const soprano = parts.find(p => p.partId === 'soprano');
    const alto = parts.find(p => p.partId === 'alto');
    const tenor = parts.find(p => p.partId === 'tenor');
    const bass = parts.find(p => p.partId === 'bass');

    expect(soprano.chordPositionRefs[0].staffNumbers).toContain(1);
    expect(alto.chordPositionRefs[0].staffNumbers).toContain(1);
    expect(tenor.chordPositionRefs[0].staffNumbers).toContain(2);
    expect(bass.chordPositionRefs[0].staffNumbers).toContain(2);
  });

  it('should mark soprano as melody in SATB', () => {
    const parts = score._buildPartsFromTemplate('SATB', staffNumbers, numChordPositions, hasLyrics);
    const soprano = parts.find(p => p.partId === 'soprano');
    expect(soprano.chordPositionRefs[0].isMelody).toBe(true);
  });

  it('should mark non-melody parts correctly in SATB', () => {
    const parts = score._buildPartsFromTemplate('SATB', staffNumbers, numChordPositions, hasLyrics);
    for (const part of parts) {
      if (part.partId !== 'soprano' && part.partId !== 'accompaniment') {
        expect(part.chordPositionRefs[0].isMelody).toBe(false);
      }
    }
  });

  // Parameterized: single-staff melody templates
  it.each([
    ['Unison', [1], ['melody', 'accompaniment']],
    ['Melody', [1], ['melody', 'accompaniment']],
    ['Solo', [1], ['melody', 'accompaniment']],
  ])('should parse %s template into melody + accompaniment', (template, staves, expected) => {
    const parts = score._buildPartsFromTemplate(template, staves, numChordPositions, hasLyrics);
    const partIds = parts.map(p => p.partId);
    for (const id of expected) {
      expect(partIds).toContain(id);
    }
  });

  it('should parse Two-Part template into two parts on separate staves', () => {
    const parts = score._buildPartsFromTemplate('Two-Part', staffNumbers, numChordPositions, hasLyrics);
    const partParts = parts.filter(p => p.partId.startsWith('part'));
    expect(partParts.length).toBe(2);
    const staff1 = partParts[0].chordPositionRefs[0].staffNumbers;
    const staff2 = partParts[1].chordPositionRefs[0].staffNumbers;
    expect(staff1).not.toEqual(staff2);
  });

  it('should parse Duet template into two parts on the same staff', () => {
    const parts = score._buildPartsFromTemplate('Duet', [1], numChordPositions, hasLyrics);
    const partParts = parts.filter(p => p.partId.startsWith('part'));
    expect(partParts.length).toBe(2);
    expect(partParts[0].chordPositionRefs[0].staffNumbers).toContain(1);
    expect(partParts[1].chordPositionRefs[0].staffNumbers).toContain(1);
  });

  it('should parse TTBB template', () => {
    const parts = score._buildPartsFromTemplate('TTBB', staffNumbers, numChordPositions, hasLyrics);
    const partIds = parts.map(p => p.partId);
    expect(partIds).toContain('tenor-1');
    expect(partIds).toContain('tenor-2');
    expect(partIds).toContain('bass-1');
    expect(partIds).toContain('bass-2');
  });

  it('should parse SSAA template', () => {
    const parts = score._buildPartsFromTemplate('SSAA', staffNumbers, numChordPositions, hasLyrics);
    const partIds = parts.map(p => p.partId);
    expect(partIds).toContain('soprano-1');
    expect(partIds).toContain('soprano-2');
    expect(partIds).toContain('alto-1');
    expect(partIds).toContain('alto-2');
  });

  it('should handle melody part override with # syntax', () => {
    const parts = score._buildPartsFromTemplate('TT+BB#T2', staffNumbers, numChordPositions, hasLyrics);
    const tenor2 = parts.find(p => p.partId === 'tenor-2');
    expect(tenor2).toBeDefined();
    expect(tenor2.chordPositionRefs[0].isMelody).toBe(true);
  });

  it('should handle chord position changes with ; delimiter', () => {
    const parts = score._buildPartsFromTemplate('0:Unison; 39:SA+TB', staffNumbers, numChordPositions, hasLyrics);
    const melody = parts.find(p => p.partId === 'melody');
    expect(melody).toBeDefined();
    expect(melody.chordPositionRefs[0]).toBeDefined();
    const soprano = parts.find(p => p.partId === 'soprano');
    expect(soprano).toBeDefined();
    expect(soprano.chordPositionRefs[39]).toBeDefined();
  });

  it('should mark vocal parts as isVocal=true', () => {
    const parts = score._buildPartsFromTemplate('SATB', staffNumbers, numChordPositions, hasLyrics);
    const vocalParts = parts.filter(p => ['soprano', 'alto', 'tenor', 'bass'].includes(p.partId));
    for (const part of vocalParts) {
      expect(part.isVocal).toBe(true);
    }
  });

  it('should mark accompaniment as isVocal=false when present', () => {
    const parts = score._buildPartsFromTemplate('SATB', [1, 2, 3], numChordPositions, hasLyrics);
    const accompaniment = parts.find(p => p.partId === 'accompaniment');
    expect(accompaniment).toBeDefined();
    expect(accompaniment.isVocal).toBe(false);
  });

  it('should place accompaniment last in the parts list when present', () => {
    const parts = score._buildPartsFromTemplate('SATB', [1, 2, 3], numChordPositions, hasLyrics);
    const lastPart = parts[parts.length - 1];
    expect(lastPart.partId).toBe('accompaniment');
  });

  it('should not create extra parts when template fills all staves', () => {
    const parts = score._buildPartsFromTemplate('SATB', staffNumbers, numChordPositions, hasLyrics);
    const accompaniment = parts.find(p => p.partId === 'accompaniment');
    expect(accompaniment).toBeUndefined();
  });

  it('should pad with C (accompaniment) when hasLyrics is true and extra staves exist', () => {
    const parts = score._buildPartsFromTemplate('SA+TB', [1, 2, 3], numChordPositions, true);
    const accompaniment = parts.find(p => p.partId === 'accompaniment');
    expect(accompaniment).toBeDefined();
  });

  it('should pad with I (instrumental) when hasLyrics is false and extra staves exist', () => {
    const parts = score._buildPartsFromTemplate('SA+TB', [1, 2, 3], numChordPositions, false);
    const instrumental = parts.find(p => p.partId === 'instrumental');
    expect(instrumental).toBeDefined();
  });

  it('should parse Descant template', () => {
    const parts = score._buildPartsFromTemplate('Descant+Unison', staffNumbers, numChordPositions, hasLyrics);
    const partIds = parts.map(p => p.partId);
    expect(partIds).toContain('descant');
    expect(partIds).toContain('melody');
  });

  it('should generate correct part names from part IDs', () => {
    const parts = score._buildPartsFromTemplate('SATB', staffNumbers, numChordPositions, hasLyrics);
    const soprano = parts.find(p => p.partId === 'soprano');
    expect(soprano.name).toBe('Soprano');
    const alto = parts.find(p => p.partId === 'alto');
    expect(alto.name).toBe('Alto');
  });

  it('should generate numbered part names for split parts', () => {
    const parts = score._buildPartsFromTemplate('TTBB', staffNumbers, numChordPositions, hasLyrics);
    const tenor1 = parts.find(p => p.partId === 'tenor-1');
    expect(tenor1.name).toBe('Tenor 1');
    const bass2 = parts.find(p => p.partId === 'bass-2');
    expect(bass2.name).toBe('Bass 2');
  });
});

// ============================================================
// _buildPartsFromTemplate() — AATT
// ============================================================
describe('_buildPartsFromTemplate() — AATT', () => {
  let score;
  const staffNumbers = [1, 2];
  const numChordPositions = 64;
  const hasLyrics = true;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should parse AATT into AA+TT (4 parts)', () => {
    const parts = score._buildPartsFromTemplate('AATT', staffNumbers, numChordPositions, hasLyrics);
    const partIds = parts.map(p => p.partId);
    expect(partIds).toContain('alto-1');
    expect(partIds).toContain('alto-2');
    expect(partIds).toContain('tenor-1');
    expect(partIds).toContain('tenor-2');
  });

  it('should assign alto parts to staff 1 and tenor parts to staff 2', () => {
    const parts = score._buildPartsFromTemplate('AATT', staffNumbers, numChordPositions, hasLyrics);
    const alto1 = parts.find(p => p.partId === 'alto-1');
    const alto2 = parts.find(p => p.partId === 'alto-2');
    const tenor1 = parts.find(p => p.partId === 'tenor-1');
    const tenor2 = parts.find(p => p.partId === 'tenor-2');
    expect(alto1.chordPositionRefs[0].staffNumbers).toContain(1);
    expect(alto2.chordPositionRefs[0].staffNumbers).toContain(1);
    expect(tenor1.chordPositionRefs[0].staffNumbers).toContain(2);
    expect(tenor2.chordPositionRefs[0].staffNumbers).toContain(2);
  });

  it('should mark alto-1 as the melody', () => {
    const parts = score._buildPartsFromTemplate('AATT', staffNumbers, numChordPositions, hasLyrics);
    const alto1 = parts.find(p => p.partId === 'alto-1');
    expect(alto1.chordPositionRefs[0].isMelody).toBe(true);
  });
});

// ============================================================
// _buildPartsFromTemplate() — full-word normalizations
// ============================================================
describe('_buildPartsFromTemplate() — full-word normalizations', () => {
  let score;
  const numChordPositions = 64;
  const hasLyrics = true;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  // Parameterized: single-word template normalizations
  it.each([
    ['Soprano', 'soprano'],
    ['Alto', 'alto'],
    ['Tenor', 'tenor'],
    ['Bass', 'bass'],
  ])('should normalize "%s" to %s part', (template, expectedPartId) => {
    const parts = score._buildPartsFromTemplate(template, [1], numChordPositions, hasLyrics);
    expect(parts.map(p => p.partId)).toContain(expectedPartId);
  });

  it('should normalize "Obbligato" to obbligato part', () => {
    const parts = score._buildPartsFromTemplate('Obbligato', [1], numChordPositions, hasLyrics);
    expect(parts.map(p => p.partId)).toContain('obbligato');
  });

  it('should normalize "Accompaniment" to accompaniment-only part', () => {
    const parts = score._buildPartsFromTemplate('Accompaniment', [1], numChordPositions, hasLyrics);
    expect(parts.map(p => p.partId)).toContain('accompaniment');
  });
});

// ============================================================
// _buildPartsFromTemplate() — multi-segment melody switching
// ============================================================
describe('_buildPartsFromTemplate() — multi-segment melody switching', () => {
  let score;
  const staffNumbers = [1, 2];
  const numChordPositions = 64;
  const hasLyrics = true;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should handle 3-segment melody change: 0:SA+TB#S; 24:SA+TB#T; 36:SA+TB#S', () => {
    const parts = score._buildPartsFromTemplate('0:SA+TB#S; 24:SA+TB#T; 36:SA+TB#S', staffNumbers, numChordPositions, hasLyrics);

    const soprano = parts.find(p => p.partId === 'soprano');
    const tenor = parts.find(p => p.partId === 'tenor');

    expect(soprano.chordPositionRefs[0].isMelody).toBe(true);
    expect(tenor.chordPositionRefs[24].isMelody).toBe(true);
    expect(soprano.chordPositionRefs[36].isMelody).toBe(true);
  });

  it('should handle repeated template: 0:SS+A#S1; 35:SS+A#S1', () => {
    const parts = score._buildPartsFromTemplate('0:SS+A#S1; 35:SS+A#S1', [1, 2], numChordPositions, hasLyrics);

    const soprano1 = parts.find(p => p.partId === 'soprano-1');
    expect(soprano1).toBeDefined();
    expect(soprano1.chordPositionRefs[0].isMelody).toBe(true);
    expect(soprano1.chordPositionRefs[35].isMelody).toBe(true);
  });
});

// ============================================================
// Utility: _binaryFind()
// ============================================================
describe('_binaryFind()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should find last value <= target (last-lte) in simple array', () => {
    const arr = [1, 3, 5, 7, 9];
    const result = score._binaryFind(arr, 6, { findType: 'last-lte' });
    expect(result).toBe(5);
  });

  it('should find exact match with last-lte', () => {
    const arr = [1, 3, 5, 7, 9];
    const result = score._binaryFind(arr, 5, { findType: 'last-lte' });
    expect(result).toBe(5);
  });

  it('should find first value >= target (first-gte)', () => {
    const arr = [1, 3, 5, 7, 9];
    const result = score._binaryFind(arr, 6, { findType: 'first-gte' });
    expect(result).toBe(7);
  });

  it('should find exact match with first-gte', () => {
    const arr = [1, 3, 5, 7, 9];
    const result = score._binaryFind(arr, 5, { findType: 'first-gte' });
    expect(result).toBe(5);
  });

  it('should return index when returnIndex=true', () => {
    const arr = [10, 20, 30, 40];
    const idx = score._binaryFind(arr, 25, { findType: 'last-lte', returnIndex: true });
    expect(idx).toBe(1);
  });

  it('should work with key parameter on objects', () => {
    const arr = [
      { time: 0, qpm: 120 },
      { time: 1.5, qpm: 100 },
      { time: 3.0, qpm: 80 },
    ];
    const result = score._binaryFind(arr, 2.0, { key: 'time', findType: 'last-lte' });
    expect(result).toEqual({ time: 1.5, qpm: 100 });
  });

  it('should return undefined (arr[-1]) when no element is <= target', () => {
    const arr = [5, 10, 15];
    const result = score._binaryFind(arr, 2, { findType: 'last-lte' });
    expect(result).toBeUndefined();
  });

  it('should return undefined (arr[-1]) when no element is >= target', () => {
    const arr = [5, 10, 15];
    const result = score._binaryFind(arr, 20, { findType: 'first-gte' });
    expect(result).toBeUndefined();
  });

  it('should handle single-element array', () => {
    expect(score._binaryFind([5], 5, { findType: 'last-lte' })).toBe(5);
    expect(score._binaryFind([5], 3, { findType: 'first-gte' })).toBe(5);
  });

  it('should handle empty array', () => {
    expect(score._binaryFind([], 5, { findType: 'last-lte' })).toBeUndefined();
  });

  it('should find last lte at the end of array', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(score._binaryFind(arr, 100, { findType: 'last-lte' })).toBe(5);
  });

  it('should find first gte at the start of array', () => {
    const arr = [1, 2, 3, 4, 5];
    expect(score._binaryFind(arr, -10, { findType: 'first-gte' })).toBe(1);
  });
});

// ============================================================
// _binaryFind() — sort option
// ============================================================
describe('_binaryFind() — sort option', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should sort array before searching when sort=true', () => {
    const arr = [9, 3, 7, 1, 5];
    const result = score._binaryFind(arr, 6, { findType: 'last-lte', sort: true });
    expect(result).toBe(5);
  });

  it('should sort by key when sort=true and key is specified', () => {
    const arr = [
      { time: 3.0, qpm: 80 },
      { time: 0, qpm: 120 },
      { time: 1.5, qpm: 100 },
    ];
    const result = score._binaryFind(arr, 2.0, { key: 'time', findType: 'last-lte', sort: true });
    expect(result).toEqual({ time: 1.5, qpm: 100 });
  });

  it('should work correctly with sort=true and first-gte', () => {
    const arr = [7, 1, 5, 9, 3];
    const result = score._binaryFind(arr, 6, { findType: 'first-gte', sort: true });
    expect(result).toBe(7);
  });
});

// ============================================================
// Utility: _bisectLeft()
// ============================================================
describe('_bisectLeft()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should return insertion point for target in sorted array', () => {
    const arr = [1, 3, 5, 7, 9];
    expect(score._bisectLeft(arr, 5)).toBe(2);
  });

  it('should return 0 when target is less than all elements', () => {
    const arr = [1, 3, 5, 7, 9];
    expect(score._bisectLeft(arr, 0)).toBe(0);
  });

  it('should return array length when target is greater than all elements', () => {
    const arr = [1, 3, 5, 7, 9];
    expect(score._bisectLeft(arr, 10)).toBe(5);
  });

  it('should return left insertion point for duplicate values', () => {
    const arr = [1, 3, 3, 3, 5];
    expect(score._bisectLeft(arr, 3)).toBe(1);
  });

  it('should return insertion point for value between elements', () => {
    const arr = [1, 3, 5, 7, 9];
    expect(score._bisectLeft(arr, 4)).toBe(2);
  });

  it('should return 0 for empty array', () => {
    expect(score._bisectLeft([], 5)).toBe(0);
  });
});

// ============================================================
// Utility: _qstampToTstamp()
// ============================================================
describe('_qstampToTstamp()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should return 1 for the first beat of a measure', () => {
    expect(score._qstampToTstamp(0, 0, 4)).toBe(1);
  });

  it('should return 2 for the second beat in 4/4 time', () => {
    expect(score._qstampToTstamp(1, 0, 4)).toBe(2);
  });

  it('should return 3 for the third beat in 4/4 time', () => {
    expect(score._qstampToTstamp(2, 0, 4)).toBe(3);
  });

  it('should handle time signature denominator of 8', () => {
    expect(score._qstampToTstamp(0.5, 0, 8)).toBe(2);
  });

  it('should handle non-zero measure start', () => {
    expect(score._qstampToTstamp(5, 4, 4)).toBe(2);
  });

  it('should handle time signature denominator of 2', () => {
    expect(score._qstampToTstamp(2, 0, 2)).toBe(2);
  });
});

// ============================================================
// Utility: _getMidiDuration()
// ============================================================
describe('_getMidiDuration()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should calculate duration in seconds from quarter note duration and QPM', () => {
    expect(score._getMidiDuration(1, 120)).toBe(0.5);
  });

  it('should calculate duration for 2 quarter notes at 120 QPM', () => {
    expect(score._getMidiDuration(2, 120)).toBe(1.0);
  });

  it('should calculate duration for half note at 60 QPM', () => {
    expect(score._getMidiDuration(2, 60)).toBe(2.0);
  });

  it('should handle fractional quarter note durations', () => {
    expect(score._getMidiDuration(0.5, 120)).toBe(0.25);
  });
});

// ============================================================
// Utility: _debounce()
// ============================================================
describe('_debounce()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delay function execution', () => {
    const fn = vi.fn();
    const debounced = score._debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('should reset the timer on subsequent calls', () => {
    const fn = vi.fn();
    const debounced = score._debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('should pass arguments to the debounced function', () => {
    const fn = vi.fn();
    const debounced = score._debounce(fn, 100);

    debounced('arg1', 'arg2');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });
});

// ============================================================
// Utility: _isThrottled()
// ============================================================
describe('_isThrottled()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return false on first call', () => {
    expect(score._isThrottled('test-key', 100)).toBe(false);
  });

  it('should return true on subsequent calls within the throttle period', () => {
    score._isThrottled('test-key', 100);
    expect(score._isThrottled('test-key', 100)).toBe(true);
  });

  it('should return false again after the throttle period', () => {
    score._isThrottled('test-key', 100);
    vi.advanceTimersByTime(101);
    expect(score._isThrottled('test-key', 100)).toBe(false);
  });

  it('should track different keys independently', () => {
    score._isThrottled('key-a', 100);
    expect(score._isThrottled('key-b', 100)).toBe(false);
    expect(score._isThrottled('key-a', 100)).toBe(true);
  });
});

// ============================================================
// _getQpmAtTime()
// ============================================================
describe('_getQpmAtTime()', () => {
  let score;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype.drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterAll(() => { ChScore.prototype.drawScore = origDrawScore; });

  it('should return QPM from tempo array when time is found', () => {
    const tempos = [{ time: 0, qpm: 120 }, { time: 5, qpm: 100 }];
    const qpm = score._getQpmAtTime(3, tempos);
    expect(qpm).toBe(120);
  });

  it('should return QPM from the latest matching tempo', () => {
    const tempos = [{ time: 0, qpm: 120 }, { time: 5, qpm: 100 }];
    const qpm = score._getQpmAtTime(7, tempos);
    expect(qpm).toBe(100);
  });

  it('should fall back to MEI tempo element when binary find returns null', () => {
    const tempos = [{ time: 5, qpm: 100 }];
    const qpm = score._getQpmAtTime(0, tempos);
    expect(qpm).toBeGreaterThan(0);
  });
});


// ============================================================
// _normalizeChordSets
// ============================================================
describe('_normalizeChordSets()', () => {
  it('should create a default chord set from <harm> elements in MEI', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};

    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      chordSets: [{
        chordSetId: 'user-chords',
        name: 'User Chords',
        svgSymbolsUrl: null,
        chordInfoList: [],
        chordPositionRefs: {
          0: { prefix: null, text: 'Ab', svgSymbolId: null },
        },
      }],
    });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.chordSetsById).toBeDefined();
    expect(score._scoreData.chordSetsById['user-chords']).toBeDefined();
  });

  it('should populate chordSetsById lookup', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', {
      scoreContent: sampleMusicXml,
      chordSets: [{
        chordSetId: 'test-normalize',
        name: 'Test',
        svgSymbolsUrl: null,
        chordInfoList: [],
        chordPositionRefs: {},
      }],
    });
    ChScore.prototype.drawScore = origDrawScore;

    expect(score._scoreData.chordSetsById['test-normalize']).toBeDefined();
  });
});


// ============================================================
// _markSingleLineChordPositions
// ============================================================
describe('_markSingleLineChordPositions()', () => {
  it('should mark chord positions as single line when only one lyric line exists', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml2 });
    ChScore.prototype.drawScore = origDrawScore;

    let hasSingleLine = false;
    for (const cpInfo of score._scoreData.chordPositions) {
      if (cpInfo.isSingleLine === true) {
        hasSingleLine = true;
        break;
      }
    }
    expect(score._scoreData.chordPositions.length).toBeGreaterThan(0);
    expect(hasSingleLine).toBe(true);
  });
});


// ============================================================
// _getInlineVerseNumbers
// ============================================================
describe('_getInlineVerseNumbers()', () => {
  it('should extract verse numbers from label elements', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype.drawScore = origDrawScore;

    const verseNumbers = score._getInlineVerseNumbers(score._scoreData.meiParsed);
    expect(verseNumbers.length).toBe(4);
    expect(verseNumbers).toEqual([1, 2, 3, 4]);
  });

  it('should return [1] for single-verse songs without labels', async () => {
    const abcContent = `X:1\nT:Test\nL:1/4\nM:4/4\nK:C\nw:la la\nCDEF|`;
    const score = new ChScore('#score-container');
    ChScore.prototype.drawScore = function() {};
    await score.load('abc', { scoreContent: abcContent });
    ChScore.prototype.drawScore = origDrawScore;

    const verseNumbers = score._getInlineVerseNumbers(score._scoreData.meiParsed);
    expect(verseNumbers).toEqual([1]);
  });
});
