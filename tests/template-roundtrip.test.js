/**
 * Tests: parts, sections and lyric line breaks survive the trip between full object and
 * template. All three templates are always reported, however the score was arrived at, and
 * both directions are checked:
 *
 * - object -> template: hand the derived objects back in and the template reported is the
 *   one the score derived for itself
 * - template -> object: hand the derived template back in and the objects rebuild identically
 *
 * Each is also rebuilt from the measure+beat form of its own template, since the two forms
 * have to name the same places -- a beat runs on through a bar written in two pieces, which
 * the split bars in HGW and IIW exercise.
 *
 * Covers three shapes: SATB on two staves (HGW), melody over accompaniment with a pre-built
 * parts and sections set (IIW), and melody with chords (TLL).
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
          templates: { ...score._scoreData.templates },
          partsTemplate: score._scoreData.templates.partsTemplateCp,
          sectionsTemplate: score._scoreData.templates.sectionsTemplateCp,
          parts: JSON.parse(JSON.stringify(score._scoreData.parts)),
          sections: JSON.parse(JSON.stringify(score._scoreData.sections)),
          partsShape: shapeParts(score._scoreData.parts),
          sectionsShape: shapeSections(score._scoreData.sections),
          lyricLinesTemplate: score._scoreData.templates.lyricLinesTemplateMb,
          chordPositionTemplate: score._scoreData.templates.lyricLinesTemplateCp,
          lyricsText: score._scoreData.lyricsText,
          numChordPositions: score._scoreData.numChordPositions,
          partsTemplateMeasureBeat: score._scoreData.templates.partsTemplateMb,
          sectionsTemplateMeasureBeat: score._scoreData.templates.sectionsTemplateMb,
          splitBars: [...score._measureRuns().byNumber]
            .filter(([, pieces]) => pieces.length > 1)
            .map(([barNumber, pieces]) => ({
              barNumber: barNumber,
              beatsInFirstPiece: pieces[0].durationQ / (4 / pieces[0].timeSignature[1]),
            })),
        };
        rebuiltFromPartsTemplate = await load(content, { partsTemplate: derived.partsTemplate });
      });

      it('should report every template in both forms when nothing is given', () => {
        // All of them, whatever was handed in -- that is what makes them storable
        expect(Object.keys(derived.templates).sort()).toEqual([
          'lyricLinesTemplateCp', 'lyricLinesTemplateInput', 'lyricLinesTemplateMb',
          'partsTemplateCp', 'partsTemplateInput', 'partsTemplateMb',
          'sectionsTemplateCp', 'sectionsTemplateInput', 'sectionsTemplateMb',
        ]);
        expect(derived.partsTemplate).toBeTruthy();
        expect(derived.sectionsTemplate).toBeTruthy();
        expect(derived.partsTemplateMeasureBeat).toBeTruthy();
        expect(derived.sectionsTemplateMeasureBeat).toBeTruthy();
        // Nothing was given, so there is nothing to report back as input
        expect(derived.templates.partsTemplateInput).toBeNull();
        expect(derived.templates.sectionsTemplateInput).toBeNull();
        expect(derived.templates.lyricLinesTemplateInput).toBeNull();
      });

      it('should report the same parts template when the parts object is given', async () => {
        const score = await load(content, { parts: derived.parts });
        expect(score._scoreData.templates.partsTemplateCp).toBe(derived.partsTemplate);
      });

      it('should report the same sections template when the sections object is given', async () => {
        const score = await load(content, { sections: derived.sections });
        expect(score._scoreData.templates.sectionsTemplateCp).toBe(derived.sectionsTemplate);
      });

      it('should rebuild the same parts from its own parts template', () => {
        expect(shapeParts(rebuiltFromPartsTemplate._scoreData.parts)).toEqual(derived.partsShape);
      });

      it('should rebuild the same sections from its own sections template', async () => {
        const score = await load(content, { sectionsTemplate: derived.sectionsTemplate });
        expect(shapeSections(score._scoreData.sections)).toEqual(derived.sectionsShape);
      });

      it('should report a template the caller gave back in both forms', () => {
        // Not echoed into Cp/Mb: those describe the parts that were built, so a caller who
        // supplied one form gets both, resolved against this engraving. What they wrote comes
        // back untouched beside them.
        expect(rebuiltFromPartsTemplate._scoreData.templates.partsTemplateCp)
          .toBe(derived.partsTemplate);
        expect(rebuiltFromPartsTemplate._scoreData.templates.partsTemplateMb)
          .toBe(derived.partsTemplateMeasureBeat);
        expect(rebuiltFromPartsTemplate._scoreData.templates.partsTemplateInput)
          .toBe(derived.partsTemplate);
      });

      it('should report a supplied template verbatim, in the form it was written', async () => {
        // The measure+beat spelling of the same parts: what comes back as input is what went
        // in, not the chord-position form the score resolved it to
        const score = await load(content, { partsTemplate: derived.partsTemplateMeasureBeat });
        expect(score._scoreData.templates.partsTemplateInput)
          .toBe(derived.partsTemplateMeasureBeat);
        expect(score._scoreData.templates.partsTemplateCp).toBe(derived.partsTemplate);
      });

      it('should report a lyric lines template as measure and beat', () => {
        // Not every fixture has enough words to divide, so a song with no breaks reports
        // none; one that has any writes them portably
        if (!derived.lyricLinesTemplate) return;
        expect(derived.lyricLinesTemplate).toMatch(/^[^;]+@[\d.]+/);
      });

      it('should break the same lines from its own lyric lines template', async () => {
        if (!derived.lyricLinesTemplate) return;
        const score = await load(content, { lyricLinesTemplate: derived.lyricLinesTemplate });
        expect(score._scoreData.lyricsText).toBe(derived.lyricsText);
      });

      it('should break the same lines from the chord-position form of it', async () => {
        if (!derived.lyricLinesTemplate) return;
        const score = await load(content, { lyricLinesTemplate: derived.chordPositionTemplate });
        expect(score._scoreData.lyricsText).toBe(derived.lyricsText);
      });

      it('should name the same breaks in both forms', async () => {
        if (!derived.lyricLinesTemplate) return;
        const score = await load(content);
        const asChordPositions = (template) => score
          ._parseLyricLinesTemplate(template)
          .map(entry => [entry.chordPosition, (entry.lyricLineIds ?? []).join(',')]);
        expect(asChordPositions(derived.chordPositionTemplate))
          .toEqual(asChordPositions(derived.lyricLinesTemplate));
      });

      it('should rebuild the same parts from the measure+beat form of its template', async () => {
        const score = await load(content, { partsTemplate: derived.partsTemplateMeasureBeat });
        expect(shapeParts(score._scoreData.parts)).toEqual(derived.partsShape);
      });

      it('should rebuild the same sections from the measure+beat form of its template', async () => {
        const score = await load(content, { sectionsTemplate: derived.sectionsTemplateMeasureBeat });
        expect(shapeSections(score._scoreData.sections)).toEqual(derived.sectionsShape);
      });

      it('should write a range running to the end of the song without naming a position', () => {
        // This score's count of chord positions is not another engraving's, so the portable
        // form says 'to the end' instead. The exact form keeps the number.
        // A range's end is followed by ')' or by its staff numbers
        const endsAtSongEnd = new RegExp(`-${derived.numChordPositions}[)\\[]`);
        if (!endsAtSongEnd.test(derived.sectionsTemplate)) return;
        // An open end is followed by whatever comes next in the range: ')', its staff
        // numbers, or its lyric location
        expect(derived.sectionsTemplateMeasureBeat).toMatch(/-[)[:]/);
        expect(derived.sectionsTemplate).not.toMatch(/-[)[:]/);
      });

      it('should read a range bound left out as the edge of the song', async () => {
        const score = await load(content, { sectionsTemplate: 'V(-)' });
        const [range] = score._scoreData.sections[0].chordPositionRanges;
        expect([range.start, range.end]).toEqual([0, score._scoreData.numChordPositions]);
      });

      it('should pull a range bound outside the song back to its edge', async () => {
        // A template written against a longer engraving of the same song names positions this
        // one hasn't got, and everything downstream indexes chordPositions by them
        const beyond = derived.numChordPositions + 500;
        const score = await load(content, { sectionsTemplate: `V(0-${beyond})` });
        const [range] = score._scoreData.sections[0].chordPositionRanges;
        expect(range.end).toBe(score._scoreData.numChordPositions);
      });

      it('should write measure numbers without a split bar\'s letter', () => {
        // A bar written in two pieces is still one bar, so `14b@2` is written `14@4` and
        // nothing a caller stores has to know the engraving split it
        expect(derived.partsTemplateMeasureBeat + derived.sectionsTemplateMeasureBeat
          + (derived.lyricLinesTemplate ?? '')).not.toMatch(/\d[a-z]@/);
      });

      it('should carry a beat past the end of a split bar into its continuation', async () => {
        if (derived.splitBars.length === 0) return;
        const score = await load(content);
        for (const { barNumber, beatsInFirstPiece } of derived.splitBars) {
          // The first beat of the far half, addressed both ways
          const carried = score._measureBeatToChordPosition(barNumber, beatsInFirstPiece + 1);
          const written = score._measureBeatToChordPosition(`${barNumber}b`, 1);
          expect(carried).toBe(written);
          // ...and it really is past the first piece, not clamped back into it
          expect(carried).toBeGreaterThan(score._measureBeatToChordPosition(barNumber, 1));
        }
      });

      it('should report a lyric lines template the caller gave back in both forms', async () => {
        if (!derived.lyricLinesTemplate) return;
        const score = await load(content, { lyricLinesTemplate: derived.chordPositionTemplate });
        expect(score._scoreData.templates.lyricLinesTemplateCp).toBe(derived.chordPositionTemplate);
        expect(score._scoreData.templates.lyricLinesTemplateMb).toBe(derived.lyricLinesTemplate);
        expect(score._scoreData.templates.lyricLinesTemplateInput)
          .toBe(derived.chordPositionTemplate);
      });
    });
  }
});
