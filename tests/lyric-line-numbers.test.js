/**
 * Tests: _normalizeLyricLineNumbers -- lyric lines numbered by their order on the page.
 *
 * Each fixture is a list of stretches ({ tag, id, notes }: an MEI section, or an ending
 * joining the section before it), each holding notes: { staff, layer, cp, melody, verses }.
 * `verses` maps an engraved row to its text; '' is a melisma's closing stub, and
 * { text, help, label } a verse with attributes. An optional plist of stretch ids says how
 * the expansion plays them.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import './setup.js';
import { initChScore, setupStandardHooks } from './helpers.js';

let ChScore;

beforeAll(async () => {
  ({ ChScore } = await initChScore());
});

setupStandardHooks();

describe('_normalizeLyricLineNumbers()', () => {
  let score;
  const parser = new DOMParser();

  beforeAll(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    score = new ChScore('#score-container');
  });

  function buildMei(stretches, plist = null) {
    const verseXml = (row, verse) => {
      const { text, help = false, label = null } = typeof verse === 'string' ? { text: verse } : verse;
      const attributes = `n="${row}"${help ? ' ch-help-text=""' : ''}${label ? ` label="${label}"` : ''}`;
      return `<verse ${attributes}>${text ? `<syl>${text}</syl>` : '<syl/>'}</verse>`;
    };
    const xml = stretches.map(({ tag = 'section', id = null, notes }) => {
      const staves = [...new Set(notes.map(note => note.staff ?? 1))].sort();
      const staffXml = staves.map(staff => {
        const onStaff = notes.filter(note => (note.staff ?? 1) === staff);
        const layers = [...new Set(onStaff.map(note => note.layer ?? 1))].sort();
        return `<staff n="${staff}">` + layers.map(layer => `<layer n="${layer}">`
          + onStaff.filter(note => (note.layer ?? 1) === layer).map(note =>
            `<note ch-chord-position="${note.cp}"${note.melody === false ? '' : ' ch-melody=""'}>`
            + Object.entries(note.verses ?? {}).map(([row, verse]) => verseXml(row, verse)).join('')
            + '</note>').join('')
          + '</layer>').join('') + '</staff>';
      }).join('');
      return `<${tag}${id ? ` xml:id="${id}"` : ''}><measure>${staffXml}</measure></${tag}>`;
    }).join('');
    const expansion = plist ? `<expansion plist="${plist.map(id => `#${id}`).join(' ')}"/>` : '';
    return parser.parseFromString(
      `<mei><body><section>${expansion}${xml}</section></body></mei>`, 'text/xml');
  }

  // Normalizes a fixture, then reads back each verse as "staff:cp:row" plus its label
  function normalize(stretches, plist = null) {
    const mei = buildMei(stretches, plist);
    const numChordPositions = Math.max(...stretches.flatMap(({ notes }) => notes.map(note => note.cp))) + 1;
    score._scoreData = { ...(score._scoreData ?? {}), meiParsed: mei, numChordPositions };
    score._verseNumbersByLineNumber = null;
    score._normalizeLyricLineNumbers();
    return Array.from(mei.querySelectorAll('verse')).map(verse => ({
      at: `${verse.closest('staff').getAttribute('n')}:${verse.parentElement.getAttribute('ch-chord-position')}`,
      text: verse.textContent,
      row: Number.parseInt(verse.getAttribute('n')),
      label: verse.getAttribute('label'),
    }));
  }
  const rowsOf = (verses, text) => verses.filter(verse => verse.text === text).map(verse => verse.row);
  const labelsOf = (verses, text) => verses.filter(verse => verse.text === text).map(verse => verse.label);

  // Four notes with a syllable on each of the given rows
  const stacked = (rows, from, texts = {}) => [0, 1, 2, 3].map(offset => ({
    cp: from + offset,
    verses: Object.fromEntries(rows.map(row => [row, texts[row] ?? `v${row}`])),
  }));
  // Notes with a syllable on one row only
  const alone = (row, from, count, text) => Array.from({ length: count }, (_, offset) => ({
    cp: from + offset, verses: { [row]: text },
  }));

  it('leaves lines already numbered from 1 alone, and labels nothing', () => {
    const verses = normalize([{ notes: stacked([1, 2, 3], 0) }]);
    expect(rowsOf(verses, 'v1')).toEqual([1, 1, 1, 1]);
    expect(rowsOf(verses, 'v3')).toEqual([3, 3, 3, 3]);
    expect(verses.every(verse => verse.label === null)).toBe(true);
  });

  it('moves stacked lines up so the lowest is 1, endings included', () => {
    // "Gethsemane", Spanish: the last chorus is engraved on lines 2 and 3 where English
    // uses 1 and 2, and its first and second endings carry on each line
    const verses = normalize([
      { notes: stacked([2, 3], 0, { 2: 'first', 3: 'second' }) },
      { tag: 'ending', notes: alone(2, 4, 1, 'ending1') },
      { tag: 'ending', notes: alone(3, 5, 1, 'ending2') },
    ]);
    expect(rowsOf(verses, 'first')).toEqual([1, 1, 1, 1]);
    expect(rowsOf(verses, 'second')).toEqual([2, 2, 2, 2]);
    expect(rowsOf(verses, 'ending1')).toEqual([1]);
    expect(rowsOf(verses, 'ending2')).toEqual([2]);
  });

  it('ranks the verse numbers again once lines move', () => {
    normalize([{ notes: stacked([2, 3], 0) }]);
    expect([...score._verseNumbersByLineNumber]).toEqual([[1, 1], [2, 2]]);
  });

  it('labels a line never stacked with another, beside lines that are, and makes it 1', () => {
    // "The Dearest Names": "I love you." engraved on line 3 after the two stacked verses,
    // printed centered because both verses sing it
    const verses = normalize([{ notes: [...stacked([1, 2], 0), ...alone(3, 4, 3, 'shared')] }]);
    expect(rowsOf(verses, 'shared')).toEqual([1, 1, 1]);
    expect(labelsOf(verses, 'shared')).toEqual(['chorus', 'chorus', 'chorus']);
    expect(labelsOf(verses, 'v1').every(label => label === null)).toBe(true);
  });

  it('labels a long passage one stacked line sings alone, and leaves the rest of that line', () => {
    // "Far, Far Away on Judea's Plains" sings its chorus on verse 2's line
    const verses = normalize([{ notes: [...stacked([1, 2], 0), ...alone(2, 4, 4, 'chorus')] }]);
    expect(rowsOf(verses, 'chorus')).toEqual([1, 1, 1, 1]);
    expect(labelsOf(verses, 'chorus')).toEqual(['chorus', 'chorus', 'chorus', 'chorus']);
    expect(rowsOf(verses, 'v2')).toEqual([2, 2, 2, 2]);
    expect(labelsOf(verses, 'v2').every(label => label === null)).toBe(true);
  });

  it('does not label a line singing alone for only a few syllables', () => {
    // One verse carrying a syllable or two where the others hold a note
    const verses = normalize([{ notes: [...stacked([1, 2], 0), ...alone(2, 4, 3, 'short')] }]);
    expect(rowsOf(verses, 'short')).toEqual([2, 2, 2]);
    expect(labelsOf(verses, 'short')).toEqual([null, null, null]);
  });

  it('labels a line singing alone for exactly that few syllables when it opens a phrase', () => {
    // A capital opening the first word says a new phrase starts there
    const verses = normalize([{ notes: [...stacked([1, 2], 0), ...alone(2, 4, 3, 'Shared')] }]);
    expect(rowsOf(verses, 'Shared')).toEqual([1, 1, 1]);
    expect(labelsOf(verses, 'Shared')).toEqual(['chorus', 'chorus', 'chorus']);
  });

  it('does not label a line singing alone in an ending, where each verse sings its own words', () => {
    const verses = normalize([
      { notes: stacked([1, 2], 0) },
      { tag: 'ending', notes: alone(1, 4, 4, 'first ending') },
      { tag: 'ending', notes: alone(2, 8, 4, 'second ending') },
    ]);
    expect(rowsOf(verses, 'second ending')).toEqual([2, 2, 2, 2]);
    expect(labelsOf(verses, 'first ending')).toEqual([null, null, null, null]);
    expect(labelsOf(verses, 'second ending')).toEqual([null, null, null, null]);
  });

  it('keeps a name the engraving gave while moving the line', () => {
    const verses = normalize([{ notes: [
      ...stacked([1, 2], 0),
      ...alone(3, 4, 3, { text: 'named', label: 'section' }),
    ] }]);
    expect(rowsOf(verses, 'named')).toEqual([1, 1, 1]);
    expect(labelsOf(verses, 'named')).toEqual(['section', 'section', 'section']);
  });

  it('labels shared words a chorus even where the engraving named them a verse', () => {
    // "Far, Far Away on Judea's Plains" names its chorus "verse"
    const verses = normalize([{ notes: [
      ...stacked([1, 2], 0, { 1: { text: 'v1', label: 'verse' }, 2: { text: 'v2', label: 'verse' } }),
      ...alone(2, 4, 4, { text: 'chorus', label: 'verse' }),
    ] }]);
    expect(labelsOf(verses, 'chorus')).toEqual(['chorus', 'chorus', 'chorus', 'chorus']);
    expect(labelsOf(verses, 'v1').every(label => label === 'verse')).toBe(true);
  });

  it('counts words engraved on a voice above the melody as the melody\'s', () => {
    // Where a lower voice carries the tune, its words are engraved on the voice above it, so
    // a chorus sung that way is still one line singing alone
    const verses = normalize([{ notes: [
      ...stacked([1, 2], 0),
      ...[4, 5, 6, 7].flatMap(cp => [
        { cp, layer: 1, melody: false, verses: { 2: 'chorus' } },
        { cp, layer: 2 },
      ]),
    ] }]);
    expect(rowsOf(verses, 'chorus')).toEqual([1, 1, 1, 1]);
    expect(labelsOf(verses, 'chorus')).toEqual(['chorus', 'chorus', 'chorus', 'chorus']);
  });

  it('numbers a line starting fresh in a stretch with nothing stacked from 1, unlabelled', () => {
    // "All Things Bright and Beautiful" engraves its chorus section on line 5
    const verses = normalize([
      { notes: alone(5, 0, 4, 'chorus') },
      { notes: stacked([1, 2, 3, 4], 4) },
    ]);
    expect(rowsOf(verses, 'chorus')).toEqual([1, 1, 1, 1]);
    expect(labelsOf(verses, 'chorus')).toEqual([null, null, null, null]);
  });

  it('carries a labelled line into the next stretch with its number and label', () => {
    // "We'll Bring the World His Truth": the chorus beside the stacked verses runs on into a
    // section of its own
    const verses = normalize([
      { notes: [...stacked([1, 2, 3], 0), ...alone(4, 4, 4, 'chorus')] },
      { notes: alone(4, 8, 4, 'chorus goes on') },
    ]);
    expect(rowsOf(verses, 'chorus goes on')).toEqual([1, 1, 1, 1]);
    expect(labelsOf(verses, 'chorus goes on')).toEqual(['chorus', 'chorus', 'chorus', 'chorus']);
  });

  it('keeps the number of a verse carrying on into a stretch of its own', () => {
    // "See the Mighty Priesthood Gathered": verse 3's coda after the third ending
    const verses = normalize([
      { notes: stacked([1, 2, 3], 0) },
      { notes: alone(3, 4, 4, 'coda') },
    ]);
    expect(rowsOf(verses, 'coda')).toEqual([3, 3, 3, 3]);
    expect(labelsOf(verses, 'coda')).toEqual([null, null, null, null]);
  });

  it('numbers a staff with no melody from 1', () => {
    // "I Am a Child of God" (Wolford): the descant's words are engraved on line 4
    const verses = normalize([{ notes: [
      ...stacked([1, 2, 3], 0),
      ...[0, 1, 2, 3].map(cp => ({ staff: 2, cp, melody: false, verses: { 4: 'descant' } })),
    ] }]);
    expect(rowsOf(verses, 'descant')).toEqual([1, 1, 1, 1]);
    expect(rowsOf(verses, 'v3')).toEqual([3, 3, 3, 3]);
  });

  it('keeps the rows of the parts\' words beside the melody', () => {
    // "Stand by Me" engraves each verse's echo on that verse's row, on the lower voice's notes
    const verses = normalize([{ notes: [
      ...stacked([1, 2], 0),
      { cp: 4, melody: false, verses: { 1: 'echo1', 2: 'echo2' } },
      { cp: 5, melody: false, verses: { 1: 'echo1', 2: 'echo2' } },
    ] }]);
    expect(rowsOf(verses, 'echo1')).toEqual([1, 1]);
    expect(rowsOf(verses, 'echo2')).toEqual([2, 2]);
    expect(labelsOf(verses, 'echo1')).toEqual([null, null]);
  });

  it('moves help text with the lines around it, and never counts it as a line singing', () => {
    // A pronunciation guide under verse 1, both stacked verses engraved from line 2
    const verses = normalize([{ notes: stacked([2, 4], 0).map(note => ({
      ...note, verses: { ...note.verses, 3: { text: '(guide)', help: true } },
    })) }]);
    expect(rowsOf(verses, 'v2')).toEqual([1, 1, 1, 1]);
    expect(rowsOf(verses, '(guide)')).toEqual([2, 2, 2, 2]);
    expect(rowsOf(verses, 'v4')).toEqual([3, 3, 3, 3]);
  });

  it('removes a melisma\'s closing stub on the row a line moves onto', () => {
    // The verses' extenders end on the note the shared words start on
    const verses = normalize([{ notes: [
      ...stacked([1, 2], 0),
      { cp: 4, verses: { 1: '', 2: '', 3: 'shared' } },
      ...alone(3, 5, 2, 'shared'),
    ] }]);
    const atFour = verses.filter(verse => verse.at === '1:4');
    expect(atFour.map(verse => [verse.text, verse.row])).toEqual([['', 2], ['shared', 1]]);
  });

  it('does not label a part singing alone in a two-part song', () => {
    // Two melody staves take turns singing alone without either being everyone's words
    const verses = normalize([{ notes: [
      { staff: 1, cp: 0, verses: { 1: 'both' } },
      { staff: 2, cp: 0, verses: { 1: 'both' } },
      ...[1, 2, 3, 4].map(cp => ({ staff: 1, cp, verses: { 1: 'part one' } })),
    ] }]);
    expect(labelsOf(verses, 'part one')).toEqual([null, null, null, null]);
  });
});
