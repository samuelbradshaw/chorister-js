/**
 * Tests: parts and sections survive the trip between full object and template.
 *
 * `scoreData.partsTemplate` and `scoreData.sectionsTemplate` are always reported,
 * however the parts and sections were arrived at — derived, built from a template, or
 * handed in whole. These check both directions of that:
 *
 * - object -> template: hand the derived objects back in as `parts` / `sections` and the
 *   template reported is the same one the score derived for itself
 *   (_convertPartsToTemplate, _convertSectionsToTemplate)
 * - template -> object: hand the derived template back in and the objects rebuild
 *   identically (_buildPartsFromTemplate, _buildSectionsFromTemplate)
 *
 * Covers three shapes: SATB on two staves (HGW), melody over accompaniment with a
 * pre-built parts and sections set (IIW), and melody with chords (TLL).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks, buildFixedMock } from './helpers.js';
import {
  sampleMusicXmlHGW, sampleMusicXmlIIW, sampleMusicXmlTLL, sampleMusicXmlTwoPart,
} from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
});

setupStandardHooks();

// What identifies a section or a part, and where it applies. Compared as a whole so a
// difference anywhere in the shape fails rather than only the fields a test remembered.
const shapeSections = (sections) => (sections ?? []).map(section => ({
  sectionId: section.sectionId,
  type: section.type,
  marker: section.marker,
  placement: section.placement,
  ranges: (section.chordPositionRanges ?? []).map(range => [
    range.start, range.end,
    (range.staffNumbers ?? []).join(','),
    (range.lyricLineIds ?? []).join(','),
  ]),
}));

const shapeParts = (parts) => (parts ?? []).map(part => ({
  partId: part.partId,
  isVocal: part.isVocal,
  placement: part.placement,
  refs: Object.entries(part.chordPositionRefs ?? {}).map(([chordPosition, ref]) => [
    chordPosition, ref.isMelody, (ref.staffNumbers ?? []).join(','),
  ]),
}));

const load = async (scoreContent, extra = {}) => {
  document.body.innerHTML = '<div id="score-container"></div>';
  ChScore.prototype._drawScore = function () {};
  const score = new ChScore('#score-container');
  await score.load('musicxml', {
    scoreContent: scoreContent,
    midiNoteSequence: buildFixedMock(0),
    ...extra,
  });
  return score;
};

const songs = [
  ['How Great the Wisdom (SATB, two staves)', sampleMusicXmlHGW],
  ['It Is Well (melody over accompaniment)', sampleMusicXmlIIW],
  ['This Little Light (melody with chords)', sampleMusicXmlTLL],
  ['Two-Part (two melody lines)', sampleMusicXmlTwoPart],
];

describe('parts and sections round-trip through their templates', { timeout: 60000 }, () => {
  afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

  for (const [label, content] of songs) {
    describe(label, () => {
      let derived;
      // The score reloaded from its own parts template, which two of the tests below read:
      // one for the parts it rebuilt, one for the template it reports back
      let rebuiltFromPartsTemplate;

      beforeAll(async () => {
        const score = await load(content);
        derived = {
          partsTemplate: score._scoreData.partsTemplate,
          sectionsTemplate: score._scoreData.sectionsTemplate,
          parts: JSON.parse(JSON.stringify(score._scoreData.parts)),
          sections: JSON.parse(JSON.stringify(score._scoreData.sections)),
          partsShape: shapeParts(score._scoreData.parts),
          sectionsShape: shapeSections(score._scoreData.sections),
        };
        rebuiltFromPartsTemplate = await load(content, { partsTemplate: derived.partsTemplate });
      });

      it('should report a parts template and a sections template when nothing is given', () => {
        expect(derived.partsTemplate).toBeTruthy();
        expect(derived.sectionsTemplate).toBeTruthy();
      });

      it('should report the same parts template when the parts object is given', async () => {
        const score = await load(content, { parts: derived.parts });
        expect(score._scoreData.partsTemplate).toBe(derived.partsTemplate);
      });

      it('should report the same sections template when the sections object is given', async () => {
        const score = await load(content, { sections: derived.sections });
        expect(score._scoreData.sectionsTemplate).toBe(derived.sectionsTemplate);
      });

      it('should rebuild the same parts from its own parts template', () => {
        expect(shapeParts(rebuiltFromPartsTemplate._scoreData.parts)).toEqual(derived.partsShape);
      });

      it('should rebuild the same sections from its own sections template', async () => {
        const score = await load(content, { sectionsTemplate: derived.sectionsTemplate });
        expect(shapeSections(score._scoreData.sections)).toEqual(derived.sectionsShape);
      });

      it('should keep a template the caller gave rather than deriving over it', () => {
        expect(rebuiltFromPartsTemplate._scoreData.partsTemplate).toBe(derived.partsTemplate);
      });
    });
  }
});
