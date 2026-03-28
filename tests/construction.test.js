/**
 * Tests: Construction, defaults, and Verovio options.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';
import { sampleMusicXmlHGW as sampleMusicXml } from './song-data.js';

let ChScore;

beforeAll(async () => {
  ({ ChScore } = await initChScore());
});

setupStandardHooks();

// ============================================================
// Construction and Initialization
// ============================================================
describe('ChScore Construction', () => {
  it('should create a ChScore instance with a valid container selector', () => {
    const score = new ChScore('#score-container');
    expect(score).toBeDefined();
    expect(score._container).toBe(document.getElementById('score-container'));
    expect(score._containerSelector).toBe('#score-container');
  });

  it('should return false for an invalid container selector', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = new ChScore('#nonexistent');
    expect(result._container).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Couldn\'t find a valid score container'));
    consoleSpy.mockRestore();
  });

  it('should set the container.score reference', () => {
    const container = document.getElementById('score-container');
    const score = new ChScore('#score-container');
    expect(container.score).toBe(score);
  });

  it('should register the instance in _chScores', () => {
    const score = new ChScore('#score-container');
    expect(ChScore.prototype._chScores).toContain(score);
  });

  it('should initialize with null scoreData and currentOptions', () => {
    const score = new ChScore('#score-container');
    expect(score._scoreData).toBeNull();
    expect(score._currentOptions).toBeNull();
  });

  it('should remove previous score if container already has one', async () => {
    const score1 = new ChScore('#score-container');
    await score1.load('musicxml', { scoreContent: sampleMusicXml });
    const score2 = new ChScore('#score-container');
    expect(document.getElementById('score-container').score).toBe(score2);
  });
});

// ============================================================
// Default Options
// ============================================================
describe('Default Options', () => {
  it('should have correct default option values', () => {
    const defaults = ChScore.prototype._defaultOptions;
    expect(defaults.scale).toBe(40);
    expect(defaults.keySignatureId).toBeNull();
    expect(defaults.expandScore).toBe(false);
    expect(defaults.showChordSet).toBe(false);
    expect(defaults.showChordSetImages).toBe(false);
    expect(defaults.showFingeringMarks).toBe(false);
    expect(defaults.showMeasureNumbers).toBe(false);
    expect(defaults.showMelodyOnly).toBe(false);
    expect(defaults.hideSectionIds).toEqual([]);
    expect(defaults.layout).toBe('vertical-scroll');
    expect(defaults.headerContent).toBe('');
    expect(defaults.footerContent).toBe('');
    expect(defaults.drawBackgroundShapes).toEqual([]);
    expect(defaults.drawForegroundShapes).toEqual([]);
    expect(defaults.customEvents).toEqual(['ch:tap', 'ch:midiready', 'ch:scoreload', 'ch:scoredraw', 'ch:pagechange']);
  });
});

// ============================================================
// Default Input Data (fallback score)
// ============================================================
describe('Default Input Data', () => {
  it('should have a default ABC score (Westminster Chimes)', () => {
    const defaultInput = ChScore.prototype._defaultInputData;
    expect(defaultInput.format).toBe('abc');
    expect(defaultInput.scoreContent).toContain('Westminster Chimes');
  });
});

// ============================================================
// Default Verovio Options
// ============================================================
describe('Default Verovio Options', () => {
  it('should have sensible default verovio options', () => {
    const vrvOpts = ChScore.prototype._defaultVerovioOptions;
    expect(vrvOpts.expandNever).toBe(true);
    expect(vrvOpts.header).toBe('none');
    expect(vrvOpts.footer).toBe('none');
    expect(vrvOpts.breaks).toBe('smart');
    expect(vrvOpts.adjustPageHeight).toBe(true);
    expect(vrvOpts.pageHeight).toBe(60000);
    expect(vrvOpts.mmOutput).toBe(false);
  });

  it('should include chorister-specific SVG additional attributes', () => {
    const attrs = ChScore.prototype._defaultVerovioOptions.svgAdditionalAttribute;
    expect(attrs).toContain('chord@ch-chord-position');
    expect(attrs).toContain('note@ch-chord-position');
    expect(attrs).toContain('note@ch-part-id');
    expect(attrs).toContain('note@ch-melody');
    expect(attrs).toContain('verse@ch-lyric-line-id');
    expect(attrs).toContain('verse@ch-section-id');
  });
});
