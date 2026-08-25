/**
 * Tests: placing an element Verovio gave no chord position to.
 *
 * Only notes and rests are numbered, so a <fermata> anchored to an invisible
 * <space> — the filler a voice resting under a held chord gets — has none, and
 * _parseAndAnnotateMei used to crash reading startQ off chordPositions[NaN].
 * _qstampOfUnnumbered places it by when it sounds instead.
 *
 * Seen in the guitar arrangements of "Families Can Be Together Forever" and
 * "'Tis Sweet to Sing the Matchless Love" in all three of fr/pt/es.
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

/** A <measure><staff><layer> built from `dur` values; "s" marks the <space> to place.
 *  Registers the measure at `startQ` so _qstampOfUnnumbered can find it. */
function layerWith(startQ, ...items) {
  const doc = new DOMParser().parseFromString(
    '<measure xml:id="m1"><staff><layer/></staff></measure>', 'text/xml');
  const layer = doc.querySelector('layer');
  score._scoreData = { measuresById: { m1: { startQ: startQ } } };
  let target = null;
  for (const item of items) {
    const isSpace = String(item).startsWith('s');
    const element = doc.createElement(isSpace ? 'space' : 'note');
    element.setAttribute('dur', String(item).replace('s', ''));
    layer.appendChild(element);
    if (isSpace && !target) target = element;
  }
  return { layer, target, doc };
}

describe('_qstampOfUnnumbered()', () => {
  it('should place a space after the durations before it in its layer', () => {
    // Four eighths then the space: the real measure 18 of the failing scores,
    // where the space starts on beat 3 and the chord it belongs with sounds there
    const { target } = layerWith(40, 8, 8, 8, 8, 's2');
    expect(score._qstampOfUnnumbered(target)).toBe(42);
  });

  it('should count an earlier space toward the offset too', () => {
    // quarter + quarter-space + the half-space: also beat 3
    const { layer } = layerWith(40, 4, 's4', 's2');
    const target = layer.querySelectorAll('space')[1];
    expect(score._qstampOfUnnumbered(target)).toBe(42);
  });

  it('should place a space opening its layer at the measure start', () => {
    const { target } = layerWith(12, 's1');
    expect(score._qstampOfUnnumbered(target)).toBe(12);
  });

  it('should count a dotted duration as its dotted length', () => {
    const { layer, target } = layerWith(0, 4, 's2');
    layer.firstChild.setAttribute('dots', '1'); // dotted quarter = 1.5
    expect(score._qstampOfUnnumbered(target)).toBe(1.5);
  });

  it('should count a chord once, not once per note inside it', () => {
    const { layer, doc } = layerWith(0);
    const chord = doc.createElement('chord');
    chord.setAttribute('dur', '2'); // one half note, three voices
    for (let i = 0; i < 3; i++) chord.appendChild(doc.createElement('note'));
    layer.appendChild(chord);
    const space = doc.createElement('space');
    space.setAttribute('dur', '2');
    layer.appendChild(space);

    expect(score._qstampOfUnnumbered(space)).toBe(2);
  });

  it('should give up rather than guess when there is nothing to measure from', () => {
    const { target } = layerWith(null, 4, 's2');
    expect(score._qstampOfUnnumbered(target)).toBe(null);
    expect(score._qstampOfUnnumbered(null)).toBe(null);
  });
});
