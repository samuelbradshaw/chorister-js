/**
 * Tests: injectedSyllables input -- syllables added to the MEI before it's read, as if
 * engraved (a verse printed below the music, or a correction to an engraved syllable).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';
import { sampleMusicXmlHGW } from './song-data.js';

let ChScore, origDrawScore;

beforeAll(async () => {
  ({ ChScore, origDrawScore } = await initChScore());
  ChScore.prototype._drawScore = function() {};
});

afterAll(() => { ChScore.prototype._drawScore = origDrawScore; });

setupStandardHooks();

async function loadScore(inputData = {}) {
  const score = new ChScore('#score-container');
  await score.load('musicxml', { scoreContent: sampleMusicXmlHGW, ...inputData });
  return score;
}

const sylsOnLine = (score, lineNumber) => [...score._scoreData.meiParsed.querySelectorAll(`staff[n="1"] verse[n="${lineNumber}"] syl`)]
  .filter(syl => syl.textContent.trim());

// An engraved lyric line of How Great the Wisdom (four verses on staff 1) as injected rows
function lineAsRows(score, lineNumber) {
  return sylsOnLine(score, lineNumber)
    .map(syl => ({
      chordPosition: Number.parseInt(syl.closest('[ch-chord-position]').getAttribute('ch-chord-position')),
      text: syl.textContent.trim(),
      connector: { d: 'HYPHEN_SOFT', u: 'EXTENDER' }[syl.getAttribute('con')] ?? 'SPACE',
    }));
}

const asTsv = (rows) => 'chordPosition\ttext\tconnector\n'
  + rows.map(row => `${row.chordPosition}\t${row.text}\t${row.connector}`).join('\n');

let verse1Rows;
beforeAll(async () => {
  verse1Rows = lineAsRows(await loadScore(), 1);
});

describe('injectedSyllables', () => {
  it('adds a verse on the first unused line, as an inline section', async () => {
    const score = await loadScore({ injectedSyllables: verse1Rows });

    const verse5 = score._scoreData.sections.find(section => section.sectionId === 'verse-5');
    expect(verse5?.placement).toBe('inline');
    expect(verse5.chordPositionRanges.map(r => [r.start, r.end, r.lyricLineIds])).toEqual([[0, 37, ['1.5']]]);
    expect(verse5.lyricsText).toBe(score._scoreData.sections.find(section => section.sectionId === 'verse-1').lyricsText);
  });

  it('reads TSV by its header row, like objects', async () => {
    const fromObjects = await loadScore({ injectedSyllables: verse1Rows });
    const fromTsv = await loadScore({ injectedSyllables: asTsv(verse1Rows) });
    expect(fromTsv._scoreData.lyricsText).toBe(fromObjects._scoreData.lyricsText);
    const reordered = 'text\tchordPosition\n' + verse1Rows.map(row => `${row.text}\t${row.chordPosition}`).join('\n');
    const score = await loadScore({ injectedSyllables: reordered });
    expect(sylsOnLine(score, 5).map(syl => syl.textContent)).toEqual(verse1Rows.map(row => row.text));
  });

  it('writes word positions from the connectors', async () => {
    const plain = await loadScore();
    const score = await loadScore({ injectedSyllables: verse1Rows });
    const described = (score, lineNumber) => sylsOnLine(score, lineNumber)
      .map(syl => `${syl.textContent}/${syl.getAttribute('wordpos')}/${syl.getAttribute('con') ?? 's'}`);
    expect(described(score, 5)).toEqual(described(plain, 1));
  });

  it('renumbers lines past the engraved ones to follow straight on from them', async () => {
    const score = await loadScore({ injectedSyllables: [
      ...verse1Rows.map(row => ({ ...row, lineNumber: 11 })),
      ...verse1Rows.map(row => ({ ...row, lineNumber: 10 })),
    ] });

    const lines = [...score._scoreData.meiParsed.querySelectorAll('staff[n="1"] verse')].map(v => v.getAttribute('n'));
    expect([...new Set(lines)].sort()).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  it('replaces an engraved syllable, keeping its label', async () => {
    const plain = await loadScore();
    const lyricAt = (score) => [...score._scoreData.meiParsed.querySelectorAll('staff[n="1"] [ch-chord-position="0"] verse[n="1"]')];
    const score = await loadScore({ injectedSyllables: [{ chordPosition: 0, text: 'Who', lineNumber: 1 }] });

    const lyricElements = lyricAt(score);
    expect(lyricElements).toHaveLength(1);
    expect([...lyricElements[0].querySelectorAll('syl')].map(syl => syl.textContent)).toEqual(['Who']);
    expect(lyricElements[0].querySelector('label')?.textContent).toBe(lyricAt(plain)[0].querySelector('label').textContent);
    expect(score._scoreData.sections.find(section => section.sectionId === 'verse-1').lyricsText.startsWith('Who great')).toBe(true);
  });

  it('takes a verse number written before the first syllable as its label', async () => {
    const rows = verse1Rows.map((row, index) => index === 0 ? { ...row, text: `5. ${row.text}` } : row);
    const score = await loadScore({ injectedSyllables: rows });

    const first = score._scoreData.meiParsed.querySelector(`staff[n="1"] [ch-chord-position="${rows[0].chordPosition}"] verse[n="5"]`);
    expect(first.querySelector('label')?.textContent.trim()).toBe('5.');
    expect(first.querySelector('syl').textContent.trim()).toBe(verse1Rows[0].text);
    expect(score._scoreData.sections.find(section => section.sectionId === 'verse-5')?.marker).toBe('5');
  });

  it('breaks the lyric line after SPACE_NEWLINE', async () => {
    const breakAfter = verse1Rows.findIndex(row => row.text.endsWith(','));
    const rows = verse1Rows.map((row, index) => index === breakAfter ? { ...row, connector: 'SPACE_NEWLINE' } : row);
    const score = await loadScore({ injectedSyllables: rows });

    const lines = score._scoreData.sections.find(section => section.sectionId === 'verse-5').lyricsText.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0].endsWith(verse1Rows[breakAfter].text)).toBe(true);
  });

  it('writes <wbr> in the lyrics after SPACE_TAB', async () => {
    // Mid-line: at a line's end, the line break is what's written
    const breakAfter = verse1Rows.findIndex(row => row.text === 'great');
    const rows = verse1Rows.map((row, index) => index === breakAfter ? { ...row, connector: 'SPACE_TAB' } : row);
    const score = await loadScore({ injectedSyllables: rows });

    const verse5 = score._scoreData.sections.find(section => section.sectionId === 'verse-5');
    expect(verse5.lyricsText).toContain(`${verse1Rows[breakAfter].text} <wbr>`);
    expect(verse5.lyricsText.match(/<wbr>/g)).toHaveLength(1);
    expect(verse5.lyricsAnnotated.match(/<wbr>/g)).toHaveLength(1);
    // Read back as lyricsText, the <wbr> is skipped like other markup
    const reread = await loadScore({ injectedSyllables: rows, lyricsText: score._scoreData.lyricsText });
    expect(reread._scoreData.sections.find(section => section.sectionId === 'verse-5')?.placement).toBe('inline');
  });

  it('maps each connector to MEI', async () => {
    const connectors = ['NONE', 'SPACE_TAB', 'HYPHEN', 'TIE_OVER', 'TIE_UNDER', 'EXTENDER_END'];
    const rows = connectors.map((connector, index) => ({ chordPosition: index, text: `s${index}`, connector: connector }));
    const score = await loadScore({ injectedSyllables: rows });

    const syls = sylsOnLine(score, 5);
    expect(syls.map(syl => syl.getAttribute('con'))).toEqual(['s', 's', 'd', 't', 't', 'u']);
    // NONE and HYPHEN carry the word on; the rest end it
    expect(syls.map(syl => syl.getAttribute('wordpos'))).toEqual(['i', 't', 'i', 't', 's', 's']);
    // HYPHEN spells the word with its hyphen, in this word only
    expect(score._scoreData.sections.find(section => section.sectionId === 'verse-5').lyricsText).toContain('s2-s3');
    expect(score._scoreData.hyphenatedWords).toEqual([]);
    // EXTENDER_END stops the extender at the next note, with an empty syllable
    const stub = score._scoreData.meiParsed.querySelector('staff[n="1"] [ch-chord-position="6"] verse[n="5"] syl[ch-extender-end]');
    expect(stub).not.toBeNull();
  });

  it('ends an extender at the next note, once', async () => {
    const score = await loadScore({ injectedSyllables: [{ chordPosition: 0, text: 'Oh', connector: 'EXTENDER_END' }] });

    const onLine = [...score._scoreData.meiParsed.querySelectorAll('staff[n="1"] verse[n="5"] syl')]
      .map(syl => `${syl.closest('[ch-chord-position]').getAttribute('ch-chord-position')}:${syl.textContent}:${syl.getAttribute('con')}`);
    // The syllable draws the extender (con u); the stub on the next note stops it (con s)
    expect(onLine).toEqual(['0:Oh:u', '1::s']);
  });

  it('ignores TSV without a header row, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const headless = verse1Rows.map(row => `${row.chordPosition}\t${row.text}\t${row.connector}`).join('\n');
    const score = await loadScore({ injectedSyllables: headless });

    expect(sylsOnLine(score, 5)).toEqual([]);
    expect(warn.mock.calls.some(([message]) => message.includes('header row'))).toBe(true);
  });

  it('warns about a syllable with no note, or an unknown connector', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const score = await loadScore({ injectedSyllables: [
      { chordPosition: 0, text: 'How', connector: 'SPACE', staffNumber: 9 },
      { chordPosition: 1, text: 'great', connector: 'BOGUS' },
    ] });

    expect(score._scoreData.meiParsed.querySelector('staff[n="9"] verse')).toBeNull();
    expect(sylsOnLine(score, 5).map(syl => syl.getAttribute('con'))).toEqual(['s']);
    const messages = warn.mock.calls.map(([message]) => message);
    expect(messages.some(message => message.includes('has no note to go on'))).toBe(true);
    expect(messages.some(message => message.includes('unknown connector'))).toBe(true);
  });
});
