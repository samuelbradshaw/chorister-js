/**
 * Tests: Utility functions and template parsing.
 *
 * Covers: _getKeySignatures, _normalizeParts, _buildPartsFromTemplate, _binaryFind,
 * _bisectLeft, _qstampToTstamp, _getMidiDuration, _debounce, _isThrottled,
 * _getQpmAtTime, _normalizeChordSets, _markSingleLineChordPositions,
 * _getInlineVerseNumbers
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks, resetScoreState } from './helpers.js';
import { sampleMusicXmlHGW as sampleMusicXml, sampleMusicXmlTLL as sampleMusicXml2 } from './song-data.js';

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
// Normalize Parts (_normalizeParts)
// ============================================================
describe('_normalizeParts()', () => {
  let score;

  beforeEach(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    score._scoreData = {
      parts: [],
      partsById: null,
      partsTemplate: null,
      staffNumbers: [1, 2],
      numChordPositions: 64,
      hasLyrics: true,
    };
  });

  // ── Default fallback (no parts, no template) ──

  it('should create default melody + accompaniment when no parts or template are provided', () => {
    score._normalizeParts();
    const partIds = score._scoreData.parts.map(p => p.partId);
    expect(partIds).toEqual(['melody', 'accompaniment']);
  });

  it('should mark the default melody part as isMelody=true', () => {
    score._normalizeParts();
    const melody = score._scoreData.parts.find(p => p.partId === 'melody');
    expect(melody.chordPositionRefs[0].isMelody).toBe(true);
  });

  it('should mark the default accompaniment part as isMelody=false', () => {
    score._normalizeParts();
    const accompaniment = score._scoreData.parts.find(p => p.partId === 'accompaniment');
    expect(accompaniment.chordPositionRefs[0].isMelody).toBe(false);
  });

  it('should assign melody to staff 1 only', () => {
    score._normalizeParts();
    const melody = score._scoreData.parts.find(p => p.partId === 'melody');
    expect(melody.chordPositionRefs[0].staffNumbers).toEqual([1]);
  });

  it('should assign accompaniment to all staff numbers', () => {
    score._normalizeParts();
    const accompaniment = score._scoreData.parts.find(p => p.partId === 'accompaniment');
    expect(accompaniment.chordPositionRefs[0].staffNumbers).toEqual([1, 2]);
  });

  it('should assign accompaniment to 3 staves when staffNumbers has 3 entries', () => {
    score._scoreData.staffNumbers = [1, 2, 3];
    score._normalizeParts();
    const accompaniment = score._scoreData.parts.find(p => p.partId === 'accompaniment');
    expect(accompaniment.chordPositionRefs[0].staffNumbers).toEqual([1, 2, 3]);
  });

  it('should set melody isVocal=true and accompaniment isVocal=false', () => {
    score._normalizeParts();
    const melody = score._scoreData.parts.find(p => p.partId === 'melody');
    const accompaniment = score._scoreData.parts.find(p => p.partId === 'accompaniment');
    expect(melody.isVocal).toBe(true);
    expect(accompaniment.isVocal).toBe(false);
  });

  it('should set correct placement values on default parts', () => {
    score._normalizeParts();
    const melody = score._scoreData.parts.find(p => p.partId === 'melody');
    const accompaniment = score._scoreData.parts.find(p => p.partId === 'accompaniment');
    expect(melody.placement).toBe('auto');
    expect(accompaniment.placement).toBe('full');
  });

  it('should set correct name values on default parts', () => {
    score._normalizeParts();
    const melody = score._scoreData.parts.find(p => p.partId === 'melody');
    const accompaniment = score._scoreData.parts.find(p => p.partId === 'accompaniment');
    expect(melody.name).toBe('Melody');
    expect(accompaniment.name).toBe('Accompaniment');
  });

  // ── partsTemplate branch ──

  it('should delegate to _buildPartsFromTemplate when partsTemplate is set', () => {
    score._scoreData.partsTemplate = 'SATB';
    score._normalizeParts();
    const partIds = score._scoreData.parts.map(p => p.partId);
    expect(partIds).toContain('soprano');
    expect(partIds).toContain('alto');
    expect(partIds).toContain('tenor');
    expect(partIds).toContain('bass');
  });

  it('should pass staffNumbers and numChordPositions to _buildPartsFromTemplate', () => {
    score._scoreData.partsTemplate = 'Unison';
    score._scoreData.staffNumbers = [1, 2, 3];
    score._normalizeParts();
    const accompaniment = score._scoreData.parts.find(p => p.partId === 'accompaniment');
    expect(accompaniment).toBeDefined();
  });

  // ── Explicit parts branch ──

  it('should keep existing parts when parts array is non-empty', () => {
    const customParts = [
      { partId: 'custom-voice', name: 'Custom Voice', isVocal: true, chordPositionRefs: { 0: { isMelody: true, staffNumbers: [1], lyricLineIds: null } } },
    ];
    score._scoreData.parts = customParts;
    score._normalizeParts();
    expect(score._scoreData.parts).toEqual(customParts);
  });

  it('should prefer explicit parts over partsTemplate', () => {
    const customParts = [
      { partId: 'custom', name: 'Custom', isVocal: true, chordPositionRefs: {} },
    ];
    score._scoreData.parts = customParts;
    score._scoreData.partsTemplate = 'SATB';
    score._normalizeParts();
    expect(score._scoreData.parts.length).toBe(1);
    expect(score._scoreData.parts[0].partId).toBe('custom');
  });

  // ── partsById ──

  it('should populate partsById from the resulting parts', () => {
    score._normalizeParts();
    expect(score._scoreData.partsById).toBeDefined();
    expect(score._scoreData.partsById['melody']).toBe(score._scoreData.parts[0]);
    expect(score._scoreData.partsById['accompaniment']).toBe(score._scoreData.parts[1]);
  });

  it('should populate partsById when using a template', () => {
    score._scoreData.partsTemplate = 'SATB';
    score._normalizeParts();
    expect(score._scoreData.partsById['soprano']).toBeDefined();
    expect(score._scoreData.partsById['alto']).toBeDefined();
    expect(score._scoreData.partsById['tenor']).toBeDefined();
    expect(score._scoreData.partsById['bass']).toBeDefined();
  });

  it('should populate partsById when using explicit parts', () => {
    score._scoreData.parts = [
      { partId: 'voice-a', name: 'A' },
      { partId: 'voice-b', name: 'B' },
    ];
    score._normalizeParts();
    expect(score._scoreData.partsById['voice-a']).toBe(score._scoreData.parts[0]);
    expect(score._scoreData.partsById['voice-b']).toBe(score._scoreData.parts[1]);
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
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: sampleMusicXml });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

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
  it('should create a default chord set from <harm> elements in MEI (integration)', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};

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
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData.chordSetsById).toBeDefined();
    expect(score._scoreData.chordSetsById['user-chords']).toBeDefined();
  });

  it('should populate chordSetsById lookup (integration)', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
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
    ChScore.prototype._drawScore = origDrawScore;

    expect(score._scoreData.chordSetsById['test-normalize']).toBeDefined();
  });

  // ── Unit tests (lightweight MEI snippets) ──
  const parser = new DOMParser();

  function buildMEI(harms) {
    let xml = '<mei xmlns="http://www.music-encoding.org/ns/mei"><music><body><mdiv><score><section>';
    for (const harm of harms) {
      const measureId = harm.measureId || 'measure-1';
      xml += `<measure xml:id="${measureId}">`;
      const cpAttr = harm.cp != null ? ` ch-chord-position="${harm.cp}"` : '';
      const tstamp = harm.tstamp != null ? ` tstamp="${harm.tstamp}"` : '';
      xml += `<harm${cpAttr}${tstamp}>${harm.text}</harm>`;
      xml += '</measure>';
    }
    if (harms.length === 0) {
      xml += '<measure xml:id="m1"><note/></measure>';
    }
    xml += '</section></score></mdiv></body></music></mei>';
    return parser.parseFromString(xml, 'text/xml');
  }

  function callNormalize(meiParsed, chordSets = []) {
    const scoreData = { meiParsed, chordSets: [...chordSets], chordSetsById: {} };
    ChScore.prototype._normalizeChordSets.call({ _scoreData: scoreData });
    return scoreData;
  }

  // ── No <harm> elements ──
  it('should not add default chord set when no <harm> elements exist', () => {
    const sd = callNormalize(buildMEI([]));
    expect(sd.chordSets.length).toBe(0);
    expect(Object.keys(sd.chordSetsById).length).toBe(0);
  });

  it('should still build chordSetsById from user chord sets when no <harm> elements exist', () => {
    const userSet = { chordSetId: 'user', name: 'User', chordPositionRefs: {}, svgSymbolsUrl: null, chordInfoList: [] };
    const sd = callNormalize(buildMEI([]), [userSet]);
    expect(sd.chordSets.length).toBe(1);
    expect(sd.chordSetsById['user']).toBe(userSet);
  });

  // ── Default chord set from <harm> ──
  it('should create a default chord set with id "default" from <harm> elements', () => {
    const sd = callNormalize(buildMEI([{ text: 'C', cp: 0, tstamp: '1' }]));
    expect(sd.chordSets.length).toBe(1);
    expect(sd.chordSets[0].chordSetId).toBe('default');
    expect(sd.chordSets[0].name).toBe('Default');
    expect(sd.chordSetsById['default']).toBeDefined();
  });

  it('default chord set should have null svgSymbolsUrl', () => {
    const sd = callNormalize(buildMEI([{ text: 'C', cp: 0, tstamp: '1' }]));
    expect(sd.chordSets[0].svgSymbolsUrl).toBeNull();
  });

  // ── chordInfoList ──
  it('should populate chordInfoList with one entry per <harm> element', () => {
    const sd = callNormalize(buildMEI([
      { text: 'C', cp: 0, tstamp: '1', measureId: 'm1' },
      { text: 'G', cp: 1, tstamp: '3', measureId: 'm1' },
    ]));
    expect(sd.chordSets[0].chordInfoList.length).toBe(2);
  });

  it('chordInfo should have correct text, prefix null, svgSymbolId null', () => {
    const sd = callNormalize(buildMEI([{ text: 'Am', cp: 0, tstamp: '1' }]));
    const info = sd.chordSets[0].chordInfoList[0];
    expect(info.text).toBe('Am');
    expect(info.prefix).toBeNull();
    expect(info.svgSymbolId).toBeNull();
  });

  it('chordInfo should include measureId from closest <measure>', () => {
    const sd = callNormalize(buildMEI([{ text: 'D', cp: 0, tstamp: '1', measureId: 'meas-42' }]));
    expect(sd.chordSets[0].chordInfoList[0].measureId).toBe('meas-42');
  });

  it('chordInfo should include tstamp attribute', () => {
    const sd = callNormalize(buildMEI([{ text: 'F', cp: 0, tstamp: '2.5' }]));
    expect(sd.chordSets[0].chordInfoList[0].tstamp).toBe('2.5');
  });

  // ── Symbol replacement ──
  it('should replace ♭ with b in chord text', () => {
    const sd = callNormalize(buildMEI([{ text: 'B♭', cp: 0, tstamp: '1' }]));
    expect(sd.chordSets[0].chordInfoList[0].text).toBe('Bb');
  });

  it('should replace ♯ with # in chord text', () => {
    const sd = callNormalize(buildMEI([{ text: 'F♯', cp: 0, tstamp: '1' }]));
    expect(sd.chordSets[0].chordInfoList[0].text).toBe('F#');
  });

  it('should trim whitespace from chord text', () => {
    const sd = callNormalize(buildMEI([{ text: '  G  ', cp: 0, tstamp: '1' }]));
    expect(sd.chordSets[0].chordInfoList[0].text).toBe('G');
  });

  // ── chordPositionRefs ──
  it('should map ch-chord-position to chordInfo in chordPositionRefs', () => {
    const sd = callNormalize(buildMEI([
      { text: 'C', cp: 0, tstamp: '1' },
      { text: 'G', cp: 4, tstamp: '1' },
    ]));
    const refs = sd.chordSets[0].chordPositionRefs;
    expect(refs[0]).toBeDefined();
    expect(refs[0].text).toBe('C');
    expect(refs[4]).toBeDefined();
    expect(refs[4].text).toBe('G');
  });

  it('should not add to chordPositionRefs when ch-chord-position is absent', () => {
    const sd = callNormalize(buildMEI([{ text: 'Em', tstamp: '1' }]));
    expect(Object.keys(sd.chordSets[0].chordPositionRefs).length).toBe(0);
    // But chordInfoList should still have the entry
    expect(sd.chordSets[0].chordInfoList.length).toBe(1);
  });

  // ── Prepend (unshift) ──
  it('should prepend default chord set before user chord sets', () => {
    const userSet = { chordSetId: 'user', name: 'User', chordPositionRefs: {}, svgSymbolsUrl: null, chordInfoList: [] };
    const sd = callNormalize(buildMEI([{ text: 'A', cp: 0, tstamp: '1' }]), [userSet]);
    expect(sd.chordSets.length).toBe(2);
    expect(sd.chordSets[0].chordSetId).toBe('default');
    expect(sd.chordSets[1].chordSetId).toBe('user');
  });

  // ── chordSetsById ──
  it('should index all chord sets (default + user) in chordSetsById', () => {
    const userSet = { chordSetId: 'my-set', name: 'My', chordPositionRefs: {}, svgSymbolsUrl: null, chordInfoList: [] };
    const sd = callNormalize(buildMEI([{ text: 'Dm', cp: 0, tstamp: '1' }]), [userSet]);
    expect(sd.chordSetsById['default']).toBe(sd.chordSets[0]);
    expect(sd.chordSetsById['my-set']).toBe(sd.chordSets[1]);
  });

  it('should handle multiple user chord sets in chordSetsById', () => {
    const set1 = { chordSetId: 'a', name: 'A', chordPositionRefs: {}, svgSymbolsUrl: null, chordInfoList: [] };
    const set2 = { chordSetId: 'b', name: 'B', chordPositionRefs: {}, svgSymbolsUrl: null, chordInfoList: [] };
    const sd = callNormalize(buildMEI([]), [set1, set2]);
    expect(Object.keys(sd.chordSetsById).length).toBe(2);
    expect(sd.chordSetsById['a']).toBe(set1);
    expect(sd.chordSetsById['b']).toBe(set2);
  });
});


// ============================================================
// _markSingleLineChordPositions
// ============================================================
describe('_markSingleLineChordPositions()', () => {
  it('should mark chord positions as single line when only one lyric line exists (integration)', async () => {
    const score = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await score.load('musicxml', { scoreContent: sampleMusicXml2 });
    ChScore.prototype._drawScore = origDrawScore;

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

  // ── Unit tests (lightweight MEI snippets) ──
  const parser = new DOMParser();

  /**
   * Build a minimal MEI with melody notes at specific chord positions.
   * @param {Array} notes - [{cp, lyricLines:[{staff, line},...]}]
   *   Each note becomes <note ch-melody="" ch-chord-position="cp"> with verse children.
   *   Omit lyricLines (or pass []) for a melody note without lyrics.
   */
  function buildMEI(notes) {
    let xml = '<mei><music><body><mdiv><score><section><measure><staff n="1"><layer>';
    for (const note of notes) {
      xml += `<note ch-melody="" ch-chord-position="${note.cp}">`;
      if (note.lyricLines) {
        for (const ll of note.lyricLines) {
          xml += `<verse n="${ll.line}" ch-lyric-line-id="${ll.staff}.${ll.line}"><syl>la</syl></verse>`;
        }
      }
      xml += '</note>';
    }
    xml += '</layer></staff></measure></section></score></mdiv></body></music></mei>';
    return parser.parseFromString(xml, 'text/xml');
  }

  /** Create an array of chordPosition objects with isSingleLine: null. */
  function makeCPs(count) {
    return Array.from({ length: count }, (_, i) => ({ chordPosition: i, isSingleLine: null }));
  }

  /** Call _markSingleLineChordPositions with a mock _scoreData context. */
  function callMark(meiParsed, chordPositions, lyricCpRanges, maxAllowedGap) {
    const args = [lyricCpRanges];
    if (maxAllowedGap != null) args.push(maxAllowedGap);
    // Inherit the prototype: the function leans on _walkSungChordPositions, not just _scoreData
    const context = Object.assign(Object.create(ChScore.prototype),
      { _scoreData: { meiParsed, chordPositions } });
    return ChScore.prototype._markSingleLineChordPositions.apply(context, args);
  }

  /** Shorthand: melody notes on staff 1 with N lyric lines. */
  function s1Notes(cpCount, linesPerCp) {
    return Array.from({ length: cpCount }, (_, i) => ({
      cp: i,
      lyricLines: linesPerCp(i),
    }));
  }

  // ── All multi-line: no single-line positions ──
  it('should not mark any CP when all positions have multiple lyric lines', () => {
    // CPs 0-4, each with lines 1 and 2 on staff 1
    const notes = s1Notes(5, () => [{ staff: 1, line: 1 }, { staff: 1, line: 2 }]);
    const cps = makeCPs(5);
    const result = callMark(buildMEI(notes), cps, [{ start: 0, end: 5 }]);
    expect(cps.every(cp => cp.isSingleLine === null)).toBe(true);
    expect(result['1']).toEqual([]);
  });

  // ── Basic single-line detection ──
  it('should mark CPs where only one lyric line exists (range > default gap)', () => {
    // CP 0: multi-line, CPs 1-5: single-line (5 positions > gap 3)
    const notes = [
      { cp: 0, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }] },
      ...Array.from({ length: 5 }, (_, i) => ({
        cp: i + 1, lyricLines: [{ staff: 1, line: 1 }],
      })),
    ];
    const cps = makeCPs(6);
    callMark(buildMEI(notes), cps, [{ start: 0, end: 6 }]);
    expect(cps[0].isSingleLine).toBeNull();
    for (let i = 1; i <= 5; i++) {
      expect(cps[i].isSingleLine).toBe(true);
    }
  });

  // ── Gap threshold boundary ──
  it('should NOT mark when single-line range length equals maxAllowedGap', () => {
    // CP 0: multi-line, CPs 1-3: single-line (3 = default gap → filtered)
    const notes = [
      { cp: 0, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }] },
      ...Array.from({ length: 3 }, (_, i) => ({
        cp: i + 1, lyricLines: [{ staff: 1, line: 1 }],
      })),
    ];
    const cps = makeCPs(4);
    callMark(buildMEI(notes), cps, [{ start: 0, end: 4 }]);
    expect(cps.every(cp => cp.isSingleLine === null)).toBe(true);
  });

  it('should mark when single-line range length is maxAllowedGap + 1', () => {
    // CP 0: multi-line, CPs 1-4: single-line (4 > gap 3 → kept)
    const notes = [
      { cp: 0, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }] },
      ...Array.from({ length: 4 }, (_, i) => ({
        cp: i + 1, lyricLines: [{ staff: 1, line: 1 }],
      })),
    ];
    const cps = makeCPs(5);
    callMark(buildMEI(notes), cps, [{ start: 0, end: 5 }]);
    for (let i = 1; i <= 4; i++) {
      expect(cps[i].isSingleLine).toBe(true);
    }
  });

  it('should respect custom maxAllowedGap parameter', () => {
    // CP 0: multi-line, CPs 1-5: single-line, maxAllowedGap=5 → length 5 = gap → filtered
    const notes = [
      { cp: 0, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }] },
      ...Array.from({ length: 5 }, (_, i) => ({
        cp: i + 1, lyricLines: [{ staff: 1, line: 1 }],
      })),
    ];
    const cps = makeCPs(6);
    callMark(buildMEI(notes), cps, [{ start: 0, end: 6 }], 5);
    expect(cps.every(cp => cp.isSingleLine === null)).toBe(true);
  });

  // ── Gap expansion forward ──
  it('should expand range forward into no-lyric ECPs at the end', () => {
    // CP 0: multi-line, CPs 1-5: single-line, CP 6: no lyrics (in range but no MEI note)
    const notes = [
      { cp: 0, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }] },
      ...Array.from({ length: 5 }, (_, i) => ({
        cp: i + 1, lyricLines: [{ staff: 1, line: 1 }],
      })),
      // CP 6 intentionally omitted → no-lyric ECP
    ];
    const cps = makeCPs(7);
    callMark(buildMEI(notes), cps, [{ start: 0, end: 7 }]);
    // CPs 1-5 from single-line range + CP 6 from forward expansion
    for (let i = 1; i <= 6; i++) {
      expect(cps[i].isSingleLine).toBe(true);
    }
  });

  // ── Gap expansion backward (firstLyricEcp) ──
  it('should expand range backward into no-lyric ECPs when range starts at firstLyricEcp', () => {
    // CP 0: no lyrics (in range), CPs 1-5: single-line (firstLyricEcp = ECP 1)
    const notes = Array.from({ length: 5 }, (_, i) => ({
      cp: i + 1, lyricLines: [{ staff: 1, line: 1 }],
    }));
    const cps = makeCPs(6);
    callMark(buildMEI(notes), cps, [{ start: 0, end: 6 }]);
    // CP 0 included via backward expansion, CPs 1-5 from single-line range
    for (let i = 0; i <= 5; i++) {
      expect(cps[i].isSingleLine).toBe(true);
    }
  });

  it('should NOT expand backward when range does not start at firstLyricEcp', () => {
    // CP 0: multi-line, CP 5: no lyrics, CPs 6-10: single-line (5 > gap 3)
    const notes = [
      { cp: 0, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }] },
      // CP 5: no lyrics
      ...Array.from({ length: 5 }, (_, i) => ({
        cp: i + 6, lyricLines: [{ staff: 1, line: 1 }],
      })),
    ];
    const cps = makeCPs(11);
    callMark(buildMEI(notes), cps, [{ start: 0, end: 11 }]);
    // firstLyricEcp = 0 (CP 0 has lyrics). Single-line range starts at ECP 6 ≠ firstLyricEcp.
    // CP 5 should NOT be included (no backward expansion for non-first ranges)
    expect(cps[5].isSingleLine).toBeNull();
    // But forward expansion at end still occurs (no ECP 11 to expand into here)
    for (let i = 6; i <= 10; i++) {
      expect(cps[i].isSingleLine).toBe(true);
    }
  });

  // ── Non-contiguous lyricChordPositionRanges ──
  it('should handle non-contiguous lyricChordPositionRanges via ECP mapping', () => {
    // Range 1: CPs 0-4, Range 2: CPs 10-14  →  ECPs 0-4 and 5-9
    // CP 0: multi, CPs 1-4 single, CP 10: multi, CPs 11-14 single
    const notes = [
      { cp: 0, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }] },
      ...Array.from({ length: 4 }, (_, i) => ({ cp: i + 1, lyricLines: [{ staff: 1, line: 1 }] })),
      { cp: 10, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }] },
      ...Array.from({ length: 4 }, (_, i) => ({ cp: i + 11, lyricLines: [{ staff: 1, line: 1 }] })),
    ];
    const cps = makeCPs(15);
    callMark(buildMEI(notes), cps, [{ start: 0, end: 5 }, { start: 10, end: 15 }]);
    // Both ranges have 4 single-line ECPs (> gap 3)
    for (const cp of [1, 2, 3, 4]) expect(cps[cp].isSingleLine).toBe(true);
    for (const cp of [11, 12, 13, 14]) expect(cps[cp].isSingleLine).toBe(true);
    // CPs not in any range should be untouched
    expect(cps[0].isSingleLine).toBeNull();
    expect(cps[10].isSingleLine).toBeNull();
    for (let i = 5; i <= 9; i++) expect(cps[i].isSingleLine).toBeNull();
  });

  // ── Multi-staff ──
  it('should process staves independently', () => {
    // Staff 1: CP 0 multi, CPs 1-4 single → marked
    // Staff 2: CPs 0-4 all multi → not marked
    const notes = [
      { cp: 0, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }, { staff: 2, line: 1 }, { staff: 2, line: 2 }] },
      ...Array.from({ length: 4 }, (_, i) => ({
        cp: i + 1,
        lyricLines: [{ staff: 1, line: 1 }, { staff: 2, line: 1 }, { staff: 2, line: 2 }],
      })),
    ];
    const cps = makeCPs(5);
    const result = callMark(buildMEI(notes), cps, [{ start: 0, end: 5 }]);
    expect(result).toHaveProperty('1');
    expect(result).toHaveProperty('2');
    expect(result['1'].length).toBe(1); // one single-line range for staff 1
    expect(result['2']).toEqual([]);     // no single-line range for staff 2
  });

  // ── Return structure ──
  it('returned ranges should have start, end, and lineNumbers properties', () => {
    const notes = [
      { cp: 0, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }] },
      ...Array.from({ length: 5 }, (_, i) => ({
        cp: i + 1, lyricLines: [{ staff: 1, line: 1 }],
      })),
    ];
    const cps = makeCPs(6);
    const result = callMark(buildMEI(notes), cps, [{ start: 0, end: 6 }]);
    const range = result['1'][0];
    expect(range).toHaveProperty('start');
    expect(range).toHaveProperty('end');
    expect(range).toHaveProperty('lineNumbers');
    expect(typeof range.start).toBe('number');
    expect(typeof range.end).toBe('number');
    expect(range.lineNumbers).toBeInstanceOf(Set);
    expect(range.start).toBe(1);
    expect(range.end).toBe(6);
  });

  // ── No lyrics at all ──
  it('should return empty object when MEI has no lyrics', () => {
    const mei = parser.parseFromString(
      '<mei><music><body><mdiv><score><section><measure><staff n="1"><layer>' +
      '<note ch-melody="" ch-chord-position="0"/>' +
      '</layer></staff></measure></section></score></mdiv></body></music></mei>',
      'text/xml',
    );
    const cps = makeCPs(5);
    const result = callMark(mei, cps, [{ start: 0, end: 5 }]);
    expect(Object.keys(result).length).toBe(0);
    expect(cps.every(cp => cp.isSingleLine === null)).toBe(true);
  });

  // ── Multiple single-line ranges in one staff ──
  it('should detect multiple separate single-line ranges', () => {
    // multi(0), single(1-5), multi(6), single(7-11)
    const notes = [
      { cp: 0, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }] },
      ...Array.from({ length: 5 }, (_, i) => ({ cp: i + 1, lyricLines: [{ staff: 1, line: 1 }] })),
      { cp: 6, lyricLines: [{ staff: 1, line: 1 }, { staff: 1, line: 2 }] },
      ...Array.from({ length: 5 }, (_, i) => ({ cp: i + 7, lyricLines: [{ staff: 1, line: 1 }] })),
    ];
    const cps = makeCPs(12);
    const result = callMark(buildMEI(notes), cps, [{ start: 0, end: 12 }]);
    expect(result['1'].length).toBe(2);
    expect(result['1'][0]).toMatchObject({ start: 1, end: 6 });
    expect(result['1'][1]).toMatchObject({ start: 7, end: 12 });
  });
});


// ============================================================
// Verses printed below the music
// ============================================================
describe('Verses printed below the music', { timeout: 30000 }, () => {
  let score;

  // A one-measure score sung once, with three further verses printed underneath as
  // <credit> text — verse 1 is the one already sung, so only 5 and 6 are recovered.
  const printedVersesMusicXml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <credit page="1"><credit-words valign="bottom">1. Do Re Mi</credit-words></credit>
  <credit page="1"><credit-words valign="bottom">5. Prayer is the soul\u2019s sincere desire,
Uttered or unexpressed.</credit-words></credit>
  <credit page="1"><credit-words valign="bottom">6. The saints, in prayer, appear as one,
In word and deed and mind.</credit-words></credit>
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><key><fifths>0</fifths></key>
      <time><beats>3</beats><beat-type>4</beat-type></time>
      <clef><sign>G</sign><line>2</line></clef></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>
      <lyric number="1"><syllabic>single</syllabic><text>Do</text></lyric></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>
      <lyric number="1"><syllabic>single</syllabic><text>Re</text></lyric></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>
      <lyric number="1"><syllabic>single</syllabic><text>Mi</text></lyric></note>
  </measure></part>
</score-partwise>`;

  beforeAll(async () => {
    document.body.innerHTML = '<div id="score-container"></div>';
    ChScore.prototype._drawScore = function() {};
    score = new ChScore('#score-container');
    await score.load('musicxml', { scoreContent: printedVersesMusicXml });
  });

  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  it('should recover printed verses that are not sung from the staff', () => {
    const below = score._scoreData.sections.filter(section => section.placement === 'below');
    // Verse 1 is sung from the staff, so it is not recovered a second time
    expect(below.map(section => String(section.marker))).toEqual(['5', '6']);

    for (const section of below) {
      expect(section.type).toBe('verse');
      // Printed verses keep their line breaks, and the number is split off the text
      expect(section.annotatedLyrics).toContain('\n');
      expect(section.annotatedLyrics[0]).not.toMatch(/\d/);
      // Nothing sings them, so they hold no chord positions
      expect(section.chordPositionRanges).toEqual([]);
    }
  });

  it('should place printed verses after the ones sung from the staff', () => {
    const placements = score._scoreData.sections
      .filter(section => section.annotatedLyrics)
      .map(section => section.placement);
    expect(placements).toEqual(['inline', 'below', 'below']);
  });

  it('should add nothing for a score with no printed verses', async () => {
    const plain = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await plain.load('musicxml', {
      scoreContent: printedVersesMusicXml.replace(/<credit[\s\S]*?<\/credit>/g, ''),
    });

    expect(plain._scoreData.sections.filter(section => section.placement === 'below')).toEqual([]);
    plain.removeScore();
  });
});


// ============================================================
// _fixIntroBrackets
// ============================================================
describe('_fixIntroBrackets()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  const note = (x) => `<note default-x="${x}"><pitch><step>C</step><octave>4</octave></pitch></note>`;
  const bracket = (x) => `<direction><direction-type><words default-x="${x}">\u231C</words></direction-type></direction>`;

  /** A one-measure score from the parts given, in the order given. */
  const scoreXml = (...parts) =>
    `<score-partwise><part id="P1"><measure number="1">${parts.join('')}</measure></part></score-partwise>`;

  /** What the measure holds, in document order: 'note:X' or 'bracket'. */
  function layout(musicXml) {
    const measure = new DOMParser().parseFromString(musicXml, 'text/xml').querySelector('measure');
    return [...measure.children].map(child =>
      child.nodeName === 'note' ? `note:${child.getAttribute('default-x')}` : 'bracket');
  }

  it('should return a score with no brackets untouched, without parsing it', () => {
    const musicXml = scoreXml(note(10), note(50));
    // The same string back, not a re-serialized copy
    expect(score._fixIntroBrackets(musicXml)).toBe(musicXml);
    expect(score._fixIntroBrackets('<score-partwise/>')).toBe('<score-partwise/>');
  });

  it('should leave a bracket already in its printed position', () => {
    const musicXml = scoreXml(note(10), bracket(30), note(50));
    expect(score._fixIntroBrackets(musicXml)).toBe(musicXml);
  });

  it('should move a bracket back past notes printed to the right of it', () => {
    // Engraved after the note at x=50, but printed at x=30 — so it belongs before it
    const musicXml = scoreXml(note(10), note(50), bracket(30), note(70));
    expect(layout(score._fixIntroBrackets(musicXml)))
      .toEqual(['note:10', 'bracket', 'note:50', 'note:70']);
  });

  it('should move a bracket forward past notes printed to the left of it', () => {
    const musicXml = scoreXml(note(10), bracket(90), note(50), note(70));
    expect(layout(score._fixIntroBrackets(musicXml)))
      .toEqual(['note:10', 'note:50', 'note:70', 'bracket']);
  });

  it('should leave a bracket that carries no printed position', () => {
    const musicXml = scoreXml(note(10), note(50), '<direction><direction-type><words>\u231C</words></direction-type></direction>');
    expect(score._fixIntroBrackets(musicXml)).toBe(musicXml);
  });
});


// ============================================================
// _getScoreMetadata
// ============================================================
describe('_getScoreMetadata()', () => {
  let score;
  const parser = new DOMParser();

  /** A minimal MEI header, plus whatever page blocks a test needs. */
  function buildMei({ fileDesc = '', pgHead = '', pgFoot = '' } = {}) {
    return parser.parseFromString(
      `<mei><meiHead><fileDesc>${fileDesc}</fileDesc></meiHead>` +
      `<music><body><mdiv><score>${pgHead}${pgFoot}</score></mdiv></body></music></mei>`,
      'text/xml'
    );
  }

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should read what the score says about itself', () => {
    const metadata = score._getScoreMetadata(buildMei({ fileDesc: `
      <titleStmt><title>Come, Follow Me</title>
        <respStmt>
          <persName role="composer">John Nicholson</persName>
          <persName role="lyricist">Samuel McBurney</persName>
        </respStmt>
      </titleStmt>
      <pubStmt>
        <date isodate="1985">1985</date>
        <distributor>Some Publisher</distributor>
        <availability>Public domain</availability>
      </pubStmt>` }));

    expect(metadata.title).toBe('Come, Follow Me');
    expect(metadata.contributors).toEqual([
      { role: 'composer', name: 'John Nicholson' },
      { role: 'lyricist', name: 'Samuel McBurney' },
    ]);
    // @isodate is preferred over the printed text
    expect(metadata.date).toBe('1985');
    expect(metadata.distributor).toBe('Some Publisher');
    expect(metadata.availability).toBe('Public domain');
  });

  it('should leave every field optional', () => {
    const metadata = score._getScoreMetadata(buildMei());

    expect(metadata.title).toBeNull();
    expect(metadata.date).toBeNull();
    expect(metadata.distributor).toBeNull();
    // An empty respStmt yields no contributors rather than failing
    expect(metadata.contributors).toEqual([]);
    expect(metadata.header).toEqual([]);
    expect(metadata.stanzas).toEqual([]);
  });

  it('should keep line breaks in a text block but lose stray whitespace', () => {
    const metadata = score._getScoreMetadata(buildMei({
      pgHead: '<pgHead><rend halign="center" valign="top" xml:id="h1">  Hymns   of   Praise <lb/>' +
              '  <rend>second</rend>   line  </rend></pgHead>',
    }));

    expect(metadata.header).toEqual([{
      text: 'Hymns of Praise\nsecond line',
      halign: 'center',
      valign: 'top',
      elementId: 'h1',
    }]);
  });

  it('should collect only numbered verse blocks as stanzas', () => {
    const metadata = score._getScoreMetadata(buildMei({
      pgHead: '<pgHead><rend>Hymns of Praise</rend></pgHead>',
      pgFoot: '<pgFoot><rend>5. Prayer is the soul\u2019s sincere desire<lb/>Uttered or unexpressed</rend>' +
              '<rend>6. The saints, in prayer, appear as one</rend>' +
              '<rend>Text: James Montgomery</rend></pgFoot>',
    }));

    // The title above and the attribution below are text blocks, but not stanzas
    expect(metadata.header.length).toBe(1);
    expect(metadata.footer.length).toBe(3);
    expect(metadata.stanzas.length).toBe(2);
    // The verse number stays in the text, and the printed lines are kept
    expect(metadata.stanzas[0]).toBe('5. Prayer is the soul\u2019s sincere desire\nUttered or unexpressed');
    expect(metadata.stanzas[1]).toBe('6. The saints, in prayer, appear as one');
  });
});


// ============================================================
// _mergePickupStanzas
// ============================================================
describe('_mergePickupStanzas()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
    score._scoreData = { staffNumbers: [1, 2] };
  });

  /** A stanza as _getLyricsFromSyllables would have built it. */
  function stanza(lyricLineId, marker, words, chordPosition) {
    const built = score._newLyricStanza(lyricLineId, 'verse', marker, chordPosition, chordPosition);
    built.annotatedLyrics = words;
    return built;
  }

  it('should merge a pickup into the verse its label names', () => {
    // Example: "Were You There" (HHC). Verse 2's first syllables sit on a pickup
    // before the repeat, so playback reaches them at the end of verse 1's pass —
    // a short stanza labelled "2." while sitting on lyric line 1.
    const pickup = stanza('1.1', '2.', 'Were you', 40);
    const verse2 = stanza('1.2', null, 'there when they crucified my Lord?', 0);

    const merged = score._mergePickupStanzas([pickup, verse2]);

    expect(merged.length).toBe(1);
    expect(merged[0].marker).toBe('2.');
    // The pickup's words belong to the verse it names, not a stanza of their own
    expect(merged[0].annotatedLyrics).toBe('Were you there when they crucified my Lord?');
    // ...and it is sung first, so its chord positions come first
    expect(merged[0].chordPositionRanges.map(range => range.start)).toEqual([40, 0]);
  });

  it('should leave a stanza whose label matches its own lyric line', () => {
    const verse1 = stanza('1.1', '1.', 'Were you there', 0);
    const verse2 = stanza('1.2', null, 'Were you there', 40);

    expect(score._mergePickupStanzas([verse1, verse2]).length).toBe(2);
  });

  it('should leave a pickup whose next stanza is already numbered', () => {
    const pickup = stanza('1.1', '2.', 'Were you', 40);
    const verse2 = stanza('1.2', '3.', 'there when they crucified', 0);

    expect(score._mergePickupStanzas([pickup, verse2]).length).toBe(2);
  });

  it('should leave a pickup whose label names a different lyric line', () => {
    const pickup = stanza('1.1', '4.', 'Were you', 40);
    const verse2 = stanza('1.2', null, 'there when they crucified', 0);

    expect(score._mergePickupStanzas([pickup, verse2]).length).toBe(2);
  });
});


// ============================================================
// _normalizeLyricVerseNumbers
// ============================================================
describe('_normalizeLyricVerseNumbers()', () => {
  let score;
  const parser = new DOMParser();

  /** Minimal MEI: one melody note per lyric line, each with a first syllable. */
  function buildMei(firstSyllables) {
    const notes = firstSyllables.map((text, index) =>
      `<note ch-melody="true"><verse n="${index + 1}"><syl>${text}</syl></verse></note>`
    ).join('');
    return parser.parseFromString(`<mei>${notes}</mei>`, 'text/xml');
  }

  const firstSyl = (mei, n) => mei.querySelector(`verse[n="${n}"] syl`).textContent;
  const firstLabel = (mei, n) => mei.querySelector(`verse[n="${n}"] label`)?.textContent ?? null;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  it('should split a verse number engraved into the first syllable', () => {
    // Example: "Venid a Mí" (Spanish Hymns 61), which writes verse 1 as "1.Ve"
    const mei = buildMei(['1.Ve', '2.Bus']);
    score._normalizeLyricVerseNumbers(mei);

    expect([firstLabel(mei, 1), firstLabel(mei, 2)]).toEqual(['1.', '2.']);
    expect([firstSyl(mei, 1), firstSyl(mei, 2)]).toEqual(['Ve', 'Bus']);
  });

  it('should leave a number that does not match its lyric line in the words', () => {
    const mei = buildMei(['7.Do']);
    score._normalizeLyricVerseNumbers(mei);

    expect(firstLabel(mei, 1)).toBeNull();
    expect(firstSyl(mei, 1)).toBe('7.Do');
  });

  it('should leave the lyrics alone when the score already labels its verses', () => {
    const mei = parser.parseFromString(
      '<mei><note ch-melody="true"><verse n="1"><label>1.</label><syl>2.Do</syl></verse></note></mei>',
      'text/xml'
    );
    score._normalizeLyricVerseNumbers(mei);

    expect(firstSyl(mei, 1)).toBe('2.Do');
    expect(mei.querySelectorAll('verse label').length).toBe(1);
  });
});


// ============================================================
// _getInlineVerseNumbers
// ============================================================
describe('_getInlineVerseNumbers()', () => {
  let score;
  const parser = new DOMParser();

  /** Build a minimal MEI XML document with <verse> and <label> elements. */
  function buildMei(verses) {
    // verses: array of { n, labelText } or null for no-label verses
    const verseXml = verses.map(v => {
      const label = v.labelText != null ? `<label>${v.labelText}</label>` : '';
      return `<verse n="${v.n}"><syl>la</syl>${label}</verse>`;
    }).join('');
    return parser.parseFromString(
      `<mei><note>${verseXml}</note></mei>`,
      'text/xml'
    );
  }

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  // ── Integration tests (full score load) ──

  it('should extract verse numbers from label elements (integration)', async () => {
    const integrationScore = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await integrationScore.load('musicxml', { scoreContent: sampleMusicXml });
    ChScore.prototype._drawScore = origDrawScore;

    const verseNumbers = integrationScore._getInlineVerseNumbers(integrationScore._scoreData.meiParsed);
    expect(verseNumbers.length).toBe(4);
    expect(verseNumbers).toEqual([1, 2, 3, 4]);
  });

  it('should return [1] for single-verse songs without labels (integration)', async () => {
    const abcContent = `X:1\nT:Test\nL:1/4\nM:4/4\nK:C\nw:la la\nCDEF|`;
    const integrationScore = new ChScore('#score-container');
    ChScore.prototype._drawScore = function() {};
    await integrationScore.load('abc', { scoreContent: abcContent });
    ChScore.prototype._drawScore = origDrawScore;

    const verseNumbers = integrationScore._getInlineVerseNumbers(integrationScore._scoreData.meiParsed);
    expect(verseNumbers).toEqual([1]);
  });

  // ── Unit tests (lightweight MEI snippets) ──

  it('should return [1] when no verse labels exist', () => {
    const mei = buildMei([{ n: 1, labelText: null }]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([1]);
  });

  it('should return [1] when there are no verse elements at all', () => {
    const mei = parser.parseFromString('<mei><note></note></mei>', 'text/xml');
    expect(score._getInlineVerseNumbers(mei)).toEqual([1]);
  });

  it('should return [1, 2] for two sequential verses', () => {
    const mei = buildMei([
      { n: 1, labelText: '1' },
      { n: 2, labelText: '2' },
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([1, 2]);
  });

  it('should return [1, 2, 3] for three sequential verses', () => {
    const mei = buildMei([
      { n: 1, labelText: '1' },
      { n: 2, labelText: '2' },
      { n: 3, labelText: '3' },
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([1, 2, 3]);
  });

  it('should strip parentheses from label text like "(1)"', () => {
    const mei = buildMei([
      { n: 1, labelText: '(1)' },
      { n: 2, labelText: '(2)' },
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([1, 2]);
  });

  it('should strip periods from label text like "1."', () => {
    const mei = buildMei([
      { n: 1, labelText: '1.' },
      { n: 2, labelText: '2.' },
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([1, 2]);
  });

  it('should strip combined punctuation like "(1.)"', () => {
    const mei = buildMei([
      { n: 1, labelText: '(1.)' },
      { n: 2, labelText: '(2.)' },
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([1, 2]);
  });

  it('should handle whitespace around label text', () => {
    const mei = buildMei([
      { n: 1, labelText: '  1  ' },
      { n: 2, labelText: '  2  ' },
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([1, 2]);
  });

  it('should return [] when verse n attribute does not match label text', () => {
    const mei = buildMei([
      { n: 1, labelText: '1' },
      { n: 3, labelText: '2' },  // n=3 but label says 2
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([]);
  });

  it('should return [] when label text does not match expected counter', () => {
    const mei = buildMei([
      { n: 1, labelText: '1' },
      { n: 2, labelText: '5' },  // label says 5, counter expects 2
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([]);
  });

  it('should return [] when labels start at 2 instead of 1', () => {
    const mei = buildMei([
      { n: 2, labelText: '2' },
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([]);
  });

  it('should return [] when n and label are consistent but skip a number', () => {
    const mei = buildMei([
      { n: 1, labelText: '1' },
      { n: 3, labelText: '3' },  // skips 2; counter expects 2
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([]);
  });

  it('should stop collecting and return [] on first mismatch in a longer sequence', () => {
    const mei = buildMei([
      { n: 1, labelText: '1' },
      { n: 2, labelText: '2' },
      { n: 3, labelText: '99' },  // mismatch
      { n: 4, labelText: '4' },
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([]);
  });

  it('should ignore pickup labels that announce a verse already counted', () => {
    // Example: "Were You There" (HHC). Each verse begins on a pickup note before
    // the repeat, labeled with the next verse's number, so that label sits on the
    // previous verse's lyric line.
    const mei = buildMei([
      { n: 1, labelText: '1.' },
      { n: 2, labelText: '(2.' },
      { n: 3, labelText: '(3.' },
      { n: 1, labelText: '2.' },  // pickup into verse 2, engraved on lyric line 1
      { n: 2, labelText: '3.' },
    ]);
    expect(score._getInlineVerseNumbers(mei)).toEqual([1, 2, 3]);
  });
});

// ============================================================
// _walkSungChordPositions
// ============================================================
describe('_walkSungChordPositions()', () => {
  let score;

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  /** Collect the walk into plain tuples for readable assertions. */
  function walk(ranges, options) {
    return Array.from(score._walkSungChordPositions(ranges, options))
      .map(entry => [entry.chordPosition, entry.expandedChordPosition, entry.passNumber]);
  }

  it('should number chord positions sequentially across ranges', () => {
    expect(walk([{ start: 0, end: 3 }, { start: 10, end: 12 }])).toEqual([
      [0, 0, 1], [1, 1, 1], [2, 2, 1],
      [10, 3, 1], [11, 4, 1],
    ]);
  });

  it('should start numbering at ecpStart', () => {
    expect(walk([{ start: 5, end: 7 }], { ecpStart: 100 })).toEqual([
      [5, 100, 1], [6, 101, 1],
    ]);
  });

  it('should give a repeated chord position a new number and the next pass count', () => {
    // The same range twice, as a repeat renders it
    expect(walk([{ start: 0, end: 2 }, { start: 0, end: 2 }])).toEqual([
      [0, 0, 1], [1, 1, 1],
      [0, 2, 2], [1, 3, 2],
    ]);
  });

  it('should number a countPass:false range without advancing the pass count', () => {
    // An introduction is usually an excerpt of the song's own opening; counting it would
    // make the verse that reuses those positions look like a second pass
    expect(walk([{ start: 0, end: 2, countPass: false }, { start: 0, end: 2 }])).toEqual([
      [0, 0, 0], [1, 1, 0],
      [0, 2, 1], [1, 3, 1],
    ]);
  });

  it('should yield nothing for empty or backwards ranges', () => {
    expect(walk([{ start: 4, end: 4 }, { start: 9, end: 2 }])).toEqual([]);
  });

  it('should hand back the caller own range object on every entry', () => {
    const range = { start: 0, end: 2, sectionInfo: { sectionId: 'verse-1' } };
    const entries = Array.from(score._walkSungChordPositions([range]));
    expect(entries.map(entry => entry.range)).toEqual([range, range]);
    expect(entries.map(entry => entry.chordPosition)).toEqual([0, 1]);
  });
});
