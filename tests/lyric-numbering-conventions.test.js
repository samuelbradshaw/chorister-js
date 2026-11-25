/**
 * Tests: lyric@number read the same whether it is the lyric line (the syllable's row on its
 * staff) or the printed verse label.
 *
 * Covers:
 * - Two-Part: part 2's words on its own staff numbered 1 (line) or 2 (label), as in "A Child's
 *   Prayer" (1989 CSB), with its "(3.)" pickup on part 1's line numbered 1 (line) or 3 (label)
 * - Stacked verses on one staff whose first ending carries pickups "2." and "3." on rows 1 and 2
 *   (line) or 2 and 3 (label), and whose third ending verse 3 sings alone, numbered 1 (line) or
 *   3 (label), as in "I Want to Be a Missionary Now" (1989 CSB)
 *
 * Fixtures are synthetic, so no copyrighted score is redistributed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';
import { sampleMusicXmlTwoPart } from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
  ChScore.prototype._drawScore = function () {};
});

afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

setupStandardHooks();

async function load(scoreContent) {
  document.body.innerHTML = '<div id="score-container"></div>';
  const score = new ChScore('#score-container');
  await score.load('musicxml', { scoreContent });
  const meiParsed = score._scoreData.meiParsed;
  return {
    lyrics: score.getLyrics(),
    sectionsTemplate: score._scoreData.templates.sectionsTemplateCp,
    sections: score._scoreData.sections.map(section => ({
      type: section.type, marker: section.marker,
      ranges: section.chordPositionRanges.map(range => [range.start, range.end]),
    })),
    pickups: [...score._pickupVerses(meiParsed.querySelectorAll('verse[ch-lyric-line-id]'))]
      .filter(([lyricElement]) => lyricElement.querySelector('label'))
      .map(([lyricElement, verse]) => [lyricElement.closest('[ch-chord-position]').getAttribute('ch-chord-position'), verse]),
  };
}

describe('Two-Part: lyric@number as line or as label', { timeout: 30000 }, () => {
  // The fixture numbers by label: part 2's words are 2, the "(3.)" pickup on part 1's line is 1
  const [head, part2] = sampleMusicXmlTwoPart.split('<part id="P2">');
  const byLine = head + '<part id="P2">' + part2.replaceAll('<lyric number="2">', '<lyric number="1">');
  // "(3.) Ho-san-na" numbered by its label, as a Finale file can
  const pickupByLabel = (xml) => xml.replace(
    /<lyric number="1">(\s*<syllabic>single<\/syllabic>\s*<text>\(3\.\)<\/text>[\s\S]*?)(<lyric number="1">[\s\S]*?<lyric number="1">)/,
    (match, pickup, rest) => `<lyric number="3">${pickup}${rest.replaceAll('<lyric number="1">', '<lyric number="3">')}`);
  const variants = {
    label: sampleMusicXmlTwoPart,
    line: byLine,
    'label, pickup by label': pickupByLabel(sampleMusicXmlTwoPart),
    'line, pickup by label': pickupByLabel(byLine),
  };
  const results = {};

  beforeAll(async () => {
    for (const [name, xml] of Object.entries(variants)) results[name] = await load(xml);
  });

  it('builds the fixtures it means to', () => {
    expect(variants.line).not.toContain('<lyric number="2">');
    expect(variants['label, pickup by label'].match(/<lyric number="3">/g)).toHaveLength(3);
  });

  it('reads each part as its own verse, with the parts together after', () => {
    expect(results.label.sectionsTemplate).toBe('V([1]:1.1); V([2]:2.1); V(0-12:1.1,2.1)');
  });

  it('gives the same sections and lyrics in every convention', () => {
    for (const name of Object.keys(variants)) {
      expect(results[name].sectionsTemplate, name).toBe(results.label.sectionsTemplate);
      expect(results[name].lyrics, name).toBe(results.label.lyrics);
    }
  });

  it('finds the "(3.)" pickup in every convention', () => {
    expect(results.label.pickups.map(([, verse]) => verse)).toEqual([3]);
    for (const name of Object.keys(variants)) expect(results[name].pickups, name).toEqual(results.label.pickups);
  });
});

// One staff, three verses stacked over a repeat. The first ending closes verses 1 and 2, then
// one note carries the pickups into verses 2 and 3; the third ending closes verse 3, on the row
// it's printed on (1) or numbered by its verse (3).
function stackedPickupSong(pickupRows, endingRow = 3) {
  const lyric = (row, text, label = null) => `<lyric number="${row}">`
    + (label ? `<syllabic>single</syllabic><text>${label}</text><elision> </elision>` : '')
    + `<syllabic>single</syllabic><text>${text}</text></lyric>`;
  const note = (step, type, duration, lyrics = '') => `<note><pitch><step>${step}</step><octave>4</octave></pitch>`
    + `<duration>${duration}</duration><voice>1</voice><type>${type}</type>${lyrics}</note>`;
  const words = [['Sun', 'and', 'rain', 'to', 'geth', 'er', 'call', 'us'], ['Wind', 'and', 'snow', 'a', 'cross', 'the', 'hills', 'we'],
    ['Stars', 'and', 'moon', 'a', 'bove', 'the', 'fields', 'they']];
  const stacked = (index) => words.map((verse, row) => lyric(row + 1, verse[index], index === 0 ? `${row + 1}.` : null)).join('');
  const steps = ['C', 'D', 'E', 'F', 'G', 'A', 'G', 'F'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>
      ${[0, 1, 2, 3].map(index => note(steps[index], 'quarter', 1, stacked(index))).join('')}
    </measure>
    <measure number="2">${[4, 5, 6, 7].map(index => note(steps[index], 'quarter', 1, stacked(index))).join('')}</measure>
    <measure number="3">
      <barline location="left"><ending number="1, 2" type="start"/></barline>
      ${note('E', 'half', 2, lyric(1, 'home.') + lyric(2, 'go.'))}
      <note><rest/><duration>1</duration><voice>1</voice><type>quarter</type></note>
      ${note('G', 'quarter', 1, lyric(pickupRows[0], 'Then', '2.') + lyric(pickupRows[1], 'Now', '3.'))}
      <barline location="right"><bar-style>light-heavy</bar-style><ending number="1, 2" type="stop"/><repeat direction="backward"/></barline>
    </measure>
    <measure number="4">
      <barline location="left"><ending number="3" type="start"/></barline>
      ${note('C', 'whole', 4, lyric(endingRow, 'shine.'))}
      <barline location="right"><bar-style>light-heavy</bar-style><ending number="3" type="discontinue"/></barline>
    </measure>
  </part>
</score-partwise>`;
}

describe('Stacked verses with pickups in the first ending: lyric@number as line or as label', { timeout: 30000 }, () => {
  let byLine, byLabel;

  beforeAll(async () => {
    byLine = await load(stackedPickupSong([1, 2]));
    byLabel = await load(stackedPickupSong([2, 3]));
  });

  it('finds both pickups, leading into verses 2 and 3, in either convention', () => {
    expect(byLine.pickups.map(([, verse]) => verse)).toEqual([2, 3]);
    expect(byLabel.pickups).toEqual(byLine.pickups);
  });

  it('gives the same lyrics, each later verse opening on its pickup', () => {
    expect(byLabel.lyrics).toBe(byLine.lyrics);
    expect(byLine.lyrics).toMatch(/\[Verse 2\]\nThen\b/);
    expect(byLine.lyrics).toMatch(/\[Verse 3\]\nNow\b/);
  });

  // The pickups' one-note ranges name the line each is engraved on, which is lyric@number
  it('gives the same sections, by chord position', () => {
    expect(byLabel.sections).toEqual(byLine.sections);
  });
});

describe('A third ending verse 3 sings alone: lyric@number as line or as label', { timeout: 30000 }, () => {
  let byLine, byLabel;

  beforeAll(async () => {
    byLine = await load(stackedPickupSong([1, 2], 1));
    byLabel = await load(stackedPickupSong([1, 2], 3));
  });

  it('reads the ending as verse 3\'s line in either convention', () => {
    expect(byLabel.sectionsTemplate).toMatch(/:1\.3\)$/);
    expect(byLine.sectionsTemplate).toBe(byLabel.sectionsTemplate);
  });

  it('gives the same lyrics', () => {
    expect(byLine.lyrics).toBe(byLabel.lyrics);
    expect(byLine.lyrics).toMatch(/\[Verse 3\][^[]*shine\.$/);
  });
});
