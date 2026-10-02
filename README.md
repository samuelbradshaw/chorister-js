# Chorister.js

**Chorister.js** is a digital-first sheet music library that enables interactivity on scores rendered by [Verovio](https://www.verovio.org/). Currently, it is optimized for congregational and community songs, such as hymns, children’s songs, folk songs, and carols.

A demo page that shows basic functionality can be found here: [Chorister.js Demo](https://samuelbradshaw.github.io/chorister-js/demo.html).

Chorister.js powers the interactive sheet music at [SingPraises.net](https://singpraises.net) (examples: [1](https://singpraises.net/collections/en/hymns-for-home-and-church/215328/gods-gracious-love?edition=2024-preview), [2](https://singpraises.net/collections/en/hymns-for-home-and-church/247237/standing-on-the-promises?edition=2024-preview), [3](https://singpraises.net/collections/en/hymns-for-home-and-church/179113/gethsemane?edition=2024-preview), [4](https://singpraises.net/collections/en/childrens-songbook/6522/i-am-a-child-of-god?edition=2021-digital), [5](https://singpraises.net/collections/en/hymns-for-home-and-church/179106/when-the-savior-comes-again?edition=2024-preview)).

### Documentation:
- [Features](#features)
- [Getting started](#getting-started)
    - [Installation options](#installation-options)
    - [Basic usage](#basic-usage)
    - [Public methods](#public-methods)
- [Advanced usage](#advanced-usage)
    - [Terminology](#terminology)
    - [Input data](#input-data)
    - [Options](#options)
    - [Custom events](#custom-events)
    - [Elements and attributes](#elements-and-attributes)
- [License](#license)

## <a name="features"></a>Features

### Sheet music rendering

- SVG sheet music rendered by Verovio (supports MusicXML, MEI, ABC notation, and other formats).
- Responsive layout options that adapt to various screen sizes.
- Adjust sheet music size with pinch to zoom or scale to fit.
- Support for expanding/unrolling piano introductions, verses, jumps, and repeats.
- Support for transposing to different keys.
- Flexible “chord sets” system for guitar chords and similar annotations.
- Melody-only view and intelligent part detection in condensed scores.
- Support for printing.

### MIDI alignment

Chorister.js doesn’t directly handle audio playback, but it processes and exports MIDI that can be loaded into other libraries that support MIDI playback, such as [ProxyPlayer.js](https://github.com/samuelbradshaw/proxy-player-js).

- Provided or Verovio-generated MIDI is expanded and aligned with the sheet music.
- MIDI is split into channels based on vocal or instrumental parts.
- MIDI is adapted to the lyrics, handling cases where a syllable is only sung in certain verses.
- Support for adjusting the length of fermatas (when relative durations are provided).

### Advanced lyric handling

- Lyrics are aligned to the sheet music.
- Inline verses can be shown or hidden dynamically.
- Additional lyric syllables can be added to the score when loading.
- Lyrics can be extracted in versified form.

### Tap events and CSS styles

- Chorister.js sends [custom events](https://developer.mozilla.org/en-US/docs/Web/Events/Creating_and_triggering_events) when loading or interacting with the score. These can be used to trigger actions in your code, such as starting playback at a specific place. See “Custom events” below.
- Because the score is rendered as SVG, colors, text fonts, and other visual attributes in the sheet music can be customized with CSS. Chorister.js processes Verovio’s output and adds additional elements and attributes for styling. See “Elements and attributes” below.

## <a name="getting-started"></a>Getting started

### <a name="installation-options"></a>Installation options

Chorister.js is available as classic JavaScript (chorister.js) or as a [JavaScript module](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules) (chorister.mjs).

#### Classic JavaScript

Download chorister.js from GitHub and reference it locally in your HTML file:
```html
<script src="scripts/chorister.js"></script>
```

Or load it from [jsDelivr](https://www.jsdelivr.com/package/gh/samuelbradshaw/chorister-js) CDN:
```html
<script src="https://cdn.jsdelivr.net/gh/samuelbradshaw/chorister-js@main/chorister.min.js"></script>
```

#### JavaScript Module

Download chorister.js and chorister.mjs from GitHub and import as a JavaScript module:
```javascript
import { ChScore } from './chorister.mjs';
```

Or load it from [jsDelivr](https://www.jsdelivr.com/package/gh/samuelbradshaw/chorister-js) CDN:
```javascript
import { ChScore } from 'https://cdn.jsdelivr.net/gh/samuelbradshaw/chorister-js@main/chorister.min.mjs';
```

You can also install it using [npm](https://www.npmjs.com/package/@samuelbradshaw/chorister-js):
```bash
% cd /your/project/folder
% npm i @samuelbradshaw/chorister-js
```

### <a name="basic-usage"></a>Basic usage

```html
<!-- Score container (empty element where the score will be inserted) -->
<div id="score-container"></div>

<!-- Import Chorister.js (classic JavaScript) -->
<script src="https://cdn.jsdelivr.net/gh/samuelbradshaw/chorister-js@main/chorister.min.js"></script>

<script>
  // Gather input data
  const format = 'musicxml';
  const inputData = {
    scoreUrl: 'https://cdn.jsdelivr.net/gh/samuelbradshaw/chorister-js@main/resources/how-great-the-wisdom-and-the-love.musicxml',
    partsTemplate: 'SATB',
  };
  
  // Define options
  const options = {
    scale: 40,
  }
  
  // Use an asynchronous function to load the score
  let chScore, scoreData;
  async function loadScore() {
    // Pass in a CSS selector that selects the score container
    chScore = new ChScore('#score-container');
    scoreData = await chScore.load(format, inputData, options);
  }
  loadScore();
  
</script>
```

### <a name="public-methods"></a>Public methods

- **load(format, inputData, options)** – Load a score. Parameters:
    - **format** – `mxl` (compressed MusicXML), `musicxml`, `mei`, `abc`, `humdrum`, `plaine-and-easie`, or `cmme`. Required. See [Verovio input formats](https://book.verovio.org/toolkit-reference/input-formats.html).
    - **inputData** – Score content and information about the score. Required. See “Input data” below.
    - **options** – Settings to control how the score is rendered. Optional. See “Options” below.
- **setOptions(optionsToUpdate)** – Set one or more options after the score is rendered.
    - **optionsToUpdate** – Object with the options to be changed. Required.
- **getOptions()** – Get the currently-set options.
- **getScoreData()** – Get information about the loaded score. Some of the provided data can be helpful for loading controls (for users to adjust options).
- **getScoreContainer()** – Get a reference to the element that holds the rendered score.
- **getKeySignatureInfo()** – Get key signature information for the loaded score.
- **getPageState()** – Get information about the current page state (for paginated layout).
- **jumpToPage(pageNumber, animate = false)** – Jump to the specified page (for paginated layout).
    - **pageNumber** – Which page to jump to. Required. Valid values: page number integer (starting at 1), `previous`, or `next`. Required.
    - **animate** – Whether the transition between pages should animate. Optional boolean. Default: `false`.
- **getMidi(format = 'note-sequence')** – Get processed MIDI content.
    - **format** – Preferred format. Optional. Valid values: `note-sequence` (Magenta note sequence), `blob` ([Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) object), `array-buffer` ([ArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer) object). Default: `note-sequence`.
- **getLyrics(annotated = false)** – Get song lyrics from the score.
    - **annotated** – Whether to include HTML markers (`<span>` elements with `data-ch-chord-position`, `data-ch-expanded-chord-position`, and `data-ch-lyric-line-id` attributes) that indicate where each syllable is sung. Optional boolean. Default: `false`.
- **removeScore()** – Remove the current score from the page and clear stored data.

Most of these methods will only work after the score is loaded.

## <a name="advanced-usage"></a>Advanced usage

### <a name="terminology"></a>Terminology

- **Score** – Sheet music to be visually rendered.
- **Score container** – HTML element that holds the rendered score, and can receive JavaScript events.
- **Chord position** – Relative position of each note/rest onset, in the order the score is written (ignoring jumps and repeats), starting at 0.
- **Expanded chord position** – Relative position of each note/rest onset, in the order the score is played, starting at 0. If the score has jumps or repeats, notes and rests that are played multiple times will have multiple expanded chord positions.
- **Measure-beat position** – Position of each note/rest onset, expressed in beat numbers and relative to the measure. For example, the first beat in the measure 5 would be 5@1.
- **Part** – Choral voicing or instrument, such as soprano, alto, tenor, bass, violin, trumpet, accompaniment, etc.
- **Section** – Introduction, verse, chorus, or other similar unit of a song. May also refer to MEI `<section>` elements, depending on the context.
- **Lyric line ID** – Identifier for a specific lyric line. For example, syllables in staff 1, lyric line 2, would be marked with lyric line ID `1.2`.
- **Chord set** – Set of guitar chords, ukulele chords, analytical marks, or similar text and/or images that can be displayed just above the music system.
- **Intro bracket** – Brackets (⌜ or ⌝) that appear above the music system to mark a sequence of notes as the piano/organ introduction (mainly used in hymns with compressed scores).

### <a name="input-data"></a>Input data

Input data is provided to Chorister.js when loading the score (see “Methods”). The `inputData` object has the following properties:

- **scoreId** – Unique identifier for the score. Optional.
- **lang** – BCP 47 language code. Used for localized lookups when categorizing text blocks, detecting inline instructions, and hyphenating extracted lyrics. Optional.
- **scoreUrl** – URL where the score can be fetched. Either `scoreUrl` or `scoreContent` is required.
- **scoreContent** – Score content as a string. Either `scoreUrl` or `scoreContent` is required.
- **midiUrl** – URL where a corresponding MIDI file can be fetched. Optional.
- **midiNoteSequence** – MIDI content as a Magenta note sequence. Optional.
- **partsTemplate** – Parts template string (more details below). Optional.
- **parts** – Parts object (more details below). Optional.
- **sectionsTemplate** – Sections template string (more details below). Optional.
- **sections** – Sections object (more details below). Optional.
- **lyricsUrl** – URL where lyrics can be fetched as plain text. Optional.
- **lyricsText** – Lyrics as a string. Optional.
- **chordSets** – Chord sets object (more details below). Optional.
- **fermatas** – Fermatas object (more details below). Optional.
- **injectedSyllables** – Syllables to be added to the sheet music (more details below). Optional.
- **lyricLinesTemplate** – Lyric lines template string (more details below). Optional.
- **hyphenatedWords** – Array of hyphenated words for lyric extraction (more details below). Optional.

`scoreUrl`, `midiUrl`, and `lyricsUrl` may be subject to [CORS restrictions](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) depending on where the files are hosted.

With only a score (`scoreUrl` or `scoreContent`), Chorister.js should render clean, responsive sheet music with basic functionality. However, additional data can enable additional functionality:

- **MIDI.** High-quality MIDI allows for more realistic playback, with variation in volume and tempo. Provided MIDI can be minimal (single play-through from top to bottom, ignoring jumps and repeats) or complete (play-through of the entire song with all verses). If MIDI isn’t provided or can’t be aligned with the score, Chorister.js will use Verovio-generated MIDI.

- **Parts.** The parts template provides information about the choral voicing and/or instruments in the score, This enables Chorister.js to identify the melody, and to tag notes in the score and MIDI as belonging to a specific part. If parts metadata isn’t provided, Chorister.js will attempt to derive parts automatically from the score.

- **Sections.** The sections template identifies the logical sections of the score, such as the introduction, verses, choruses, etc. If not provided, Chorister.js will attempt to derive sections automatically based on lyrics, MEI expansions, verse labels in the score, intro brackets, and other hints.

- **Lyrics.** Chorister.js can align versified lyrics with sheet music syllables. This helps Chorister.js derive sections more accurately.

- **Chord sets.** Guitar chords, ukulele chords, analytical marks, or similar text and/or images to be shown above the music system.

- **Fermatas.** Information about each fermata in the score, for better MIDI playback.

- **Injected syllables.** Syllables to insert into the score at specified locations. This can be used to add additional verses that may not have been in the original score, insert lyrics in a different language, or fix misspelled words, without editing the original score.

- **Lyric lines template** and **hyphenated words.** Chorister.js can extract lyrics from the score. These inputs help Chorister.js to format extracted lyrics more cleanly. Lyric lines templates define the approximate locations of line breaks, and hyphenated words help Chorister.js decide which hyphens to keep or discard when converting syllables to words.


#### Examples

For simple scores, a parts template and a sections template are all Chorister.js needs. Both are optional; when they’re missing, Chorister.js works them out from the score.

```javascript
const scoreData = await chScore.load('musicxml', {
  scoreUrl: 'https://cdn.jsdelivr.net/gh/samuelbradshaw/chorister-js@main/resources/how-great-the-wisdom-and-the-love.musicxml',
  lyricsUrl: 'https://cdn.jsdelivr.net/gh/samuelbradshaw/chorister-js@main/resources/how-great-the-wisdom-and-the-love.txt',
  partsTemplate: 'SATB',
  sectionsTemplate: 'I(29-37); V(:1.1); V(:1.2); V(:1.3); V(:1.4)',
});
```

**Writing templates.** You don’t need to write templates from scratch. Load the score without them, then read `scoreData.templates`. It always reports the parts, sections, and lyric line breaks Chorister.js used, whether they came from your input or were worked out from the score. Correct anything that’s wrong, and pass the corrected template back in next time.

`scoreData.templates` has three keys for each kind of template (parts, sections, and lyric lines): for example, `sectionsTemplateInput`, `sectionsTemplateCp`, and `sectionsTemplateMb`.

- **`Input`** – The template you provided, unchanged, or `null` if you didn’t provide one.
- **`Cp`** – The template Chorister.js used, with positions written as chord positions (`12`). It’s normalized, so `partsTemplate: 'SATB'` is reported as `'SA+TB'`.
- **`Mb`** – The same template, with positions written as measure-beat positions (`4@1`, `12@3.5`). The beat counts from 1 within the measure. Measure-beat positions still work if the same music is engraved differently, such as a translation set to the same music. A measure-beat position that lands partway through a word moves to the start of that word.

Either form can be used anywhere a template takes a position. If a template names a chord position or measure the score doesn’t have, Chorister.js logs a warning and ignores the whole template, as if none had been provided.

<details>
<summary>Parts</summary>

Parts are best provided as a parts template. A parts object is also accepted, for cases a template can’t describe. If both are provided, the parts object is used.

#### Parts template

A parts template lists the parts on each staff, from the top staff down.

Key:
- M = melody
- S = soprano
- A = alto
- T = tenor
- B = bass
- P = part (as in Part 1, Part 2)
- D = descant
- O = obbligato
- I = instrumental
- C = accompaniment
- \+ = separator between staves
- \# = separator for specifying the melody part (if not specified, M, S, P, or the first part is chosen as the melody)
- ; = separator between part changes

Normalizations:
- Melody –> M
- Soprano –> S
- Alto –> A
- Tenor –> T
- Bass –> B
- Descant –> D
- Obbligato –> O
- Instrumental –> I
- Accompaniment –> C
- Solo –> MC
- Unison –> MC
- Two-Part –> P+P
- Duet –> PP
- SATB –> SA+TB
- SSAA –> SS+AA
- AATT –> AA+TT
- TTBB –> TT+BB
- For unspecified staves, the normalized template is padded with C (accompaniment, if there are lyrics) or I (instrumental).

Examples:
- `SATB` – Staff 1: soprano, alto. Staff 2: tenor, bass. Soprano has the melody.
- `D+SATB` – Staff 1: descant. Staff 2: soprano, alto. Staff 3: tenor, bass.
- `MC+C` – Staff 1: melody, with accompaniment below it. Staff 2: accompaniment.
- `SATB#A` – Like `SATB`, but alto has the melody.
- `TT+BB#T2` – Staff 1: first tenor, second tenor. Staff 2: first bass, second bass. Second tenor has the melody.
- `Two-Part` – Staff 1: part 1. Staff 2: part 2. Both parts are melodies, sung on different verses.
- `Descant+Unison` – Staff 1: descant. Staff 2: melody and accompaniment. Remaining staves: accompaniment.

If the parts change partway through the song, write each template with the position where it starts, separated by `;`:
- `0:Unison; 39:SATB` – Unison until chord position 39, then SATB.
- `0@1:SS+A#S1; 10@3.5:SS+A#A` – The melody moves from first soprano to alto on beat 3.5 of measure 10.
- `0@1:SA+TB; 8@3:SA+TB#T; 12@3:SA+TB` – The tenor carries the melody from measure 8, beat 3, until measure 12, beat 3.

#### Parts object

```json
[
    {
        "partId": "soprano",
        "name": "Soprano",
        "isVocal": true,
        "placement": "auto",
        "chordPositionRefs": {
            "0": { "isMelody": true, "staffNumbers": [1], "lyricLineIds": null }
        }
    },
    {
        "partId": "alto",
        "name": "Alto",
        "isVocal": true,
        "placement": "auto",
        "chordPositionRefs": {
            "0": { "isMelody": false, "staffNumbers": [1], "lyricLineIds": null }
        }
    },
    ...
]
```

Properties:
- **partId** – Any unique ID for the part. String.
- **name** – Part name that may be visible to users. String.
- **isVocal** – Whether the part is sung or instrumental. Boolean.
- **placement** – Placement of the part on its staff/staves. Valid values: 1, 2, 3, 4 (relative position among other parts on the staff), "full" (fills the specified staves), "auto" (automatically placed).
- **chordPositionRefs** – Keyed by the chord position where the part starts or where its information changes.
    - **isMelody** – Whether the part includes the melody (starting at the given chord position). Boolean.
    - **staffNumbers** – Numbers of the staves where the part is placed. An empty list means the part stops at this chord position. List of integers.
    - **lyricLineIds** – Lyric lines sung in the part. List of lyric line IDs. Optional.
</details>

<details>
<summary>Sections</summary>

Sections are best provided as a sections template. A sections object is also accepted, for cases a template can’t describe. If both are provided, the sections object is used.

#### Sections template

A sections template lists the sections in the order they’re sung, separated by `;`. Each section is a section character followed by one or more ranges in parentheses.

Section characters:
- V = verse
- C = chorus
- B = bridge
- I = introduction
- N = interlude
- S = section (the default, if no section character is given)

Normalizations:
- Verse –> V
- Chorus –> C
- Bridge –> B
- Introduction –> I
- Interlude –> N
- Section –> S

Inside each pair of parentheses, in this order (each part is optional):
- **Range** – `start-end`, where `end` is exclusive. Either end can be left out: `11@1-` runs to the end of the song, and `-20` starts at the beginning. Default: the whole song.
- **Staff numbers** – Comma-separated, in square brackets. Default: all staves.
- **Lyric location** – After `:`, one of:
    - A comma-separated list of lyric line IDs, such as `2.1` or `1.1,2.1`.
    - `below` – The words are printed below the music and aren’t sung in the score.
    - `none` – Nothing is sung.

  Default: `none` for introductions and interludes; otherwise, all lyric lines.

On its own, `(:below)` or `(:none)` describes a section the score never plays, such as a verse printed below the music. With a range in front of it, the section is still played. For example, `C(0-37:none)` is a chorus played inline with nothing sung over it.

Notes:
- A section with no parentheses covers the whole song. For example, `V` is a single verse that includes all chord positions and staves.
- A section can have more than one range. For example, an introduction made of the first and last few measures would be `I(0-25)(57-65)`.
- Adding `/force` anywhere in the template tells Chorister.js to trust the template over the score. Use it when the score’s lyrics or verse numbers are engraved incorrectly. With `/force`:
    - Verses begin only where the template says. A verse number engraved partway through a lyric line doesn’t start a new verse.
    - Words that don’t belong to any section in the template are left out, instead of being added as a verse below the music.
    - The template sets how many times the song is played, even if the score doesn’t have repeats for every playthrough (see the two-part example below).

Everything else about each section is worked out for you:
- **Numbering** – Verses are numbered from 1. A chorus is numbered from 0 if the song opens with a chorus, and from 1 otherwise. Other types are numbered from 1.
- **marker** – Only verses have one: the verse number. If the score prints its own number for a verse (such as “5.” on a verse below the music), that number is used instead.
- **sectionId** and **name** – From the type and number: `verse-2` / “Verse 2”, `chorus-1` / “Chorus”. The first introduction’s ID is `introduction`.
- **placement** – `inline` where the section has music, `below` where its words are printed below the music, and `none` where it isn’t placed in the score.
- **pauseAfter** – `true` after a bracketed introduction. It’s also `true` after a section that’s followed by another playthrough from the beginning, when the song ends on a note too short to breathe in.

Examples from the [demo scores](https://github.com/samuelbradshaw/chorister-js/tree/main/resources):
- `I(29-37); V(:1.1); V(:1.2); V(:1.3); V(:1.4)` – *How Great the Wisdom and the Love.* An introduction made of the last two lines (marked with intro brackets), then four verses over the whole song, each on its own lyric line.
- `I(0-12); V(12-60:1.1); V(12-48:1.2)(48-51:1.1)(60-69:1.1)` – *This Little Light of Mine.* An introduction, then two verses. Verse 2 has its own words up to chord position 48, then sings the same words as verse 1, skipping the first ending.
- `I(0-13[2,3])(55-64[2,3]); V(0-42[2,3]:2.1); C(42-64[2,3]:2.1); …; V(0-42:2.4); C(42-64:1.1,2.1)` – *It Is Well with My Soul.* The introduction and the first three verses leave out the descant on staff 1. Verse 4 and its chorus add it, and the last chorus also sings the descant’s words (`1.1`).

Other examples:
- `I(0-12); V(12-42); C(42-63); V(:below); C(:below)` – An introduction, a sung verse and chorus, then a verse and chorus printed below the music.
- `V(:1.1); V(:2.1); V(:1.1,2.1) /force` – A two-part song printed once: part 1 sings verse 1, part 2 sings verse 2, then both sing together on a third playthrough.

The same templates in measure-beat form (`templates.sectionsTemplateMb`):
- `I(11@3-); V(:1.1); V(:1.2); V(:1.3); V(:1.4)`
- `I(0@1-4@1); V(4@1-20@1:1.1); V(4@1-16@1:1.2)(16@1-17@1:1.1)(20@1-:1.1)`

#### Sections object

```json
[
    {
        "sectionId": "introduction",
        "type": "introduction",
        "name": "Introduction",
        "marker": null,
        "placement": "inline",
        "pauseAfter": true,
        "chordPositionRanges": [
            { "start": 0, "end": 13, "staffNumbers": [2, 3], "lyricLineIds": [] },
            { "start": 55, "end": 64, "staffNumbers": [2, 3], "lyricLineIds": [] }
        ]
    },
    {
        "sectionId": "verse-1",
        "type": "verse",
        "name": "Verse 1",
        "marker": "1",
        "placement": "inline",
        "pauseAfter": false,
        "chordPositionRanges": [
            { "start": 0, "end": 42, "staffNumbers": [2, 3], "lyricLineIds": ["2.1"] }
        ]
    },
    {
        "sectionId": "chorus-1",
        "type": "chorus",
        "name": "Chorus",
        "marker": null,
        "placement": "inline",
        "pauseAfter": false,
        "chordPositionRanges": [
            { "start": 42, "end": 64, "staffNumbers": [2, 3], "lyricLineIds": ["2.1"] }
        ]
    },
    ...
]
```

Properties:
- **sectionId** – Any unique ID for the section. String.
- **type** – Section type. Valid values: "verse", "chorus", "bridge", "introduction", "interlude", "section". Use "section" where nothing more is known about a passage.
- **name** – Section name that may be visible to users. String.
- **marker** – Verse number or similar sequential marker. String or `null`.
- **placement** – Placement of the section in the score. Valid values: "inline" (inline with the music), "below" (below the music), "none" (not placed in the score).
- **pauseAfter** – Whether a short pause should be added in the MIDI after the section is played. Boolean.
- **lyricsAnnotated** – The section’s words, for sections placed below the music. String. Optional.
- **chordPositionRanges** – Chord position ranges that are part of the section.
    - **start** – Chord position where the range starts. Integer.
    - **end** – Chord position where the range ends (exclusive). Integer.
    - **staffNumbers** – Staves played in the section. For example, if the first staff is a descant that’s only sung on the third verse, only the third verse should include that staff number. List of integers. Optional.
    - **lyricLineIds** – Lyric lines sung in the section. List of lyric line IDs. Optional.
</details>

<details>
<summary>Lyrics</summary>

Provided lyrics should be written in the order they’re sung, with a bracketed label such as `[Verse 1]`, `[Chorus]`, or `[Bridge]` above each block. If the chorus is sung more than once, repeat it each time. Only melody lyrics should be included (not lyrics from alternate or secondary parts). Labels with no words under them, such as `[Introduction]` or `[Interlude]`, are allowed and are skipped. Line breaks are kept, and are reported back as a lyric lines template.

```
[Introduction]

[Verse 1]
When peace, like a river, attendeth my way,
When sorrows, like sea-billows, roll;
Whatever my lot, Thou hast taught me to say,
It is well, it is well with my soul.

[Chorus]
It is well with my soul,
It is well, it is well with my soul.

[Verse 2]
Though Satan should buffet, though trials should come,
Let this blest assurance control:
That Christ hath regarded my helpless estate,
And hath shed His own blood for my soul.

[Chorus]
It is well with my soul,
It is well, it is well with my soul.

...
```

In a two-part song where both parts sing together on the last verse, each part’s words for that verse can be given separately, with a letter after the verse number:

```
[Verse 3a]
(words sung by part 1)

[Verse 3b]
(words sung by part 2)
```

If lyrics aren’t provided, Chorister.js extracts them from the score. Either way, `getLyrics()` returns the lyrics in this format (see “Public methods”).
</details>

<details>
<summary>Lyric lines template</summary>

When Chorister.js extracts lyrics from the score, it decides where each line of lyrics breaks, using punctuation, capitalization, rests, and other hints. A lyric lines template sets the line breaks instead. It lists the positions where new lines start, separated by `;`. A position can be followed by lyric line IDs in square brackets, to apply it only to those lyric lines.

- `11; 19; 29` – Every verse starts a new line at chord positions 11, 19, and 29.
- `4@3; 7@3; 11@3` – The same line breaks, written as measure-beat positions.
- `4@3; 7@3; 9@1[1.2]; 11@3` – Like the previous template, but verse 2 (lyric line `1.2`) also breaks at measure 9, beat 1.

A line break that would fall in the middle of a word moves to the start of that word. If a verse can’t follow the template, its line breaks are worked out automatically instead. Lyric lines templates are only used when lyrics are extracted from the score. Provided lyrics keep their own line breaks.
</details>

<details>
<summary>Injected syllables</summary>

Injected syllables are added to the score before Chorister.js reads it, and are then treated the same as syllables engraved in the score. Use them to:
- Place a verse that’s printed below the music onto the staff, so it can be highlighted and played along with.
- Fix a misspelled or incorrectly engraved syllable. An injected syllable replaces any syllable engraved on the same lyric line at the same chord position, and keeps any verse number engraved with it.

Provide one row per syllable, as a TSV string with a header row or as an array of objects:

| Column | Meaning |
| --- | --- |
| `chordPosition` | Chord position of the note the syllable is sung on. Required. |
| `text` | The syllable. A verse number before the first syllable (`5. Re`) becomes the verse’s label. Required. |
| `connector` | What comes after the syllable (see below). Default: `SPACE`. |
| `staffNumber` | Staff number. Default: the first staff with lyrics. |
| `layerNumber` | Layer number. Default: the first layer. |
| `lineNumber` | Lyric line number on the staff. Default: the staff’s first unused line. Numbers past the staff’s engraved lines continue directly after them, so `10` and `11` on a staff with four engraved verses become lines 5 and 6. |

Connectors:
- `SPACE` – A space (the word ends).
- `NONE` – Nothing; the next syllable continues the word. For languages written without spaces.
- `SPACE_TAB` – A space where the line may wrap, such as between the two halves of a line of Japanese lyrics.
- `SPACE_NEWLINE` – A new line of lyrics.
- `HYPHEN` – A hyphen that’s part of the word’s spelling (`soul-cheering`).
- `HYPHEN_SOFT` – A syllable break within a word (no hyphen in the lyrics).
- `EXTENDER` – An extender line (the word ends, and the syllable is held).
- `EXTENDER_END` – The last syllable held by an extender line.
- `TIE_OVER`, `TIE_UNDER` – An elision joining two words.

```javascript
// Add verse 5, printed below the music, to the staff
await chScore.load('musicxml', {
  scoreUrl: 'redeemer-of-israel.musicxml',
  injectedSyllables: 'chordPosition\ttext\tconnector\n'
    + '0\t5. Re\tHYPHEN_SOFT\n'
    + '1\tstore,\tSPACE\n'
    + '3\tmy\tSPACE\n'
    + '...',
});

// Fix "children", engraved on lyric line 2 at chord positions 14 and 15
await chScore.load('musicxml', {
  scoreUrl: 'called-to-serve.musicxml',
  injectedSyllables: [
    { chordPosition: 14, text: 'chil', connector: 'HYPHEN_SOFT', lineNumber: 2 },
    { chordPosition: 15, text: 'dren', connector: 'SPACE', lineNumber: 2 },
  ],
});
```

When fixing part of a word, inject the whole word: a syllable’s place in its word is worked out from the injected syllables alone. A syllable whose chord position has no note on its staff and layer is skipped, with a warning.
</details>

<details>
<summary>Hyphenated words</summary>

When Chorister.js extracts lyrics from the score, it joins syllables into words. Some words are spelled with a hyphen that falls between two syllables, such as Tagalog `pag-ibig` (engraved `Pag` / `i` / `big`). The score doesn’t show whether those syllables should be joined with a hyphen, so Chorister.js uses these sources, in order of priority:

1. **The score’s own text.** Hyphenated words in the printed title and in verses printed below the music. No setup needed.
2. **`hyphenatedWords`**, if provided.
3. **A built-in list** of common hyphenated words, for `en`, `fr`, and `pt` (selected with `lang`).

For other languages, provide `hyphenatedWords` to restore hyphens that aren’t in the score’s own text:

```javascript
await chScore.load('musicxml', {
  scoreUrl: 'song.musicxml',
  lang: 'tl',
  hyphenatedWords: ['pag-ibig', 'mag-isa', 'nag-ampo'],
});
```

Words are matched without regard to capitalization, and a hyphen is only added where it falls between two syllables, so a listed word can’t change the spelling of an unrelated word.

A good list can be gathered from hyphenated words in existing lyrics in the same language, or from a dictionary such as Wiktionary. Leave out hyphenated words whose unhyphenated spelling is also a word: for example, `sun-light` would turn every `sunlight` into `sun-light`.
</details>

<details>
<summary>MIDI</summary>

Without MIDI, Chorister.js uses MIDI generated by Verovio, which plays the score at a steady tempo. Provided MIDI is used for its timing: tempo changes, rubato, held fermatas, and dynamics. The notes still come from the score, and are reordered to match the expanded score. Use your own MIDI for more natural playback, or to keep highlighting in sync with a recording made from the same MIDI.

```javascript
await chScore.load('musicxml', {
  scoreUrl: 'it-is-well-with-my-soul.musicxml',
  midiUrl: 'it-is-well-with-my-soul.mid',
});
```

To be used, the MIDI must line up note for note with the score, either:
- **Minimal** – One play-through of the score as written, ignoring jumps and repeats. The same timing is used for every verse.
- **Complete** – The whole song as sung, with every verse, jump, and repeat. Each verse keeps its own timing.

Otherwise, Chorister.js logs a warning and uses MIDI generated by Verovio. `scoreData.midiType` reports which kind of MIDI was used. Duplicate notes (such as a piano part doubling the voices) are ignored. If you already have the MIDI as a Magenta note sequence, pass it as `midiNoteSequence` instead of `midiUrl`.
</details>

<details>
<summary>Chord sets</summary>

Chord sets are shown above the music system, one set at a time (see the `showChordSet` option). Each item is keyed by the chord position it’s placed at.

```json
[
    {
        "chordSetId": "guitar",
        "name": "Guitar",
        "svgSymbolsUrl": null,
        "chordPositionRefs": {
            "1": { "text": "C", "prefix": null, "svgSymbolId": null },
            "4": { "text": "C+", "prefix": null, "svgSymbolId": null },
            "7": { "text": "Dm", "prefix": null, "svgSymbolId": null },
            ...
        }
    },
    {
        "chordSetId": "guitar-capo-5",
        "name": "Guitar (Capo 5)",
        "svgSymbolsUrl": null,
        "chordPositionRefs": {
            "1": { "text": "G", "prefix": "Capo 5:", "svgSymbolId": null },
            "4": { "text": "G+", "prefix": null, "svgSymbolId": null },
            "7": { "text": "Am", "prefix": null, "svgSymbolId": null },
            ...
        }
    },
    {
        "chordSetId": "parsons-code",
        "name": "Parsons Code",
        "svgSymbolsUrl": "/static/symbols.svg",
        "chordPositionRefs": {
            "0": { "text": "＊", "prefix": null, "svgSymbolId": "pc-asterisk" },
            "1": { "text": "R", "prefix": null, "svgSymbolId": "pc-repeat" },
            "2": { "text": "D", "prefix": null, "svgSymbolId": "pc-down" },
            ...
        }
    }
]
```

Properties:
- **chordSetId** – Any unique ID for the chord set. String.
- **name** – Chord set name that may be visible to users. String.
- **svgSymbolsUrl** – Relative or absolute URL to an SVG file with SVG symbols. String. Optional.
- **chordPositionRefs** – Keyed by the chord position where an item should be added.
    - **text** – Text to be added. String.
    - **prefix** – Text shown before the item, such as `Capo 5:`. String. Optional.
    - **svgSymbolId** – ID of an SVG symbol (from `svgSymbolsUrl`) to be drawn above the text, such as a chord diagram, when `showChordSetImages` is enabled. String. Optional.
</details>

<details>
<summary>Fermatas</summary>

Fermatas tell Chorister.js how long to hold each note with a fermata during playback. Each duration factor multiplies the length of the note at that chord position. If provided MIDI already slows down noticeably at that point, the fermata is assumed to be part of the MIDI and isn’t applied again.

```json
[
    { "chordPosition": 31, "durationFactor": 2.0 },
    { "chordPosition": 157, "durationFactor": 1.5 }
]
```

Properties:
- **chordPosition** – Chord position of the fermata. Integer.
- **durationFactor** – How many times longer the note is held. Float.
</details>


### <a name="options"></a>Options

Options can be passed in to Chorister.js when calling the `load()` method to load the score. After the score is loaded, options can be changed with the `setOptions()` method (see “Methods”). An `options` object has the following optional properties:

- **layout** – Score layout. Possible values: `vertical-scroll`, `horizontal-scroll`, `paginated`, or `print`. Default: `vertical-scroll`.
- **scale** – Size of the sheet music. Positive integer (exact scale), or an array with two positive integers (min and max scale). When using min and max, the score will attempt to scale to fit within the score container (works best if the score container has a fixed size). Default: `40`.
- **keySignatureId** – Key signature to transpose the sheet music to. Transposition is relative to the tonality (major or minor) at the beginning of the score. Possible values: (major) `g-flat-major`, `g-major`, `a-flat-major`, `a-major`, `b-flat-major`, `b-major`, `c-flat-major`, `c-major`, `c-sharp-major`, `d-flat-major`, `d-major`, `e-flat-major`, `e-major`, `f-major`, `f-sharp-major`, (minor) `g-minor`, `g-sharp-minor`, `g-flat-minor`, `a-minor`, `a-sharp-minor`, `b-flat-minor`, `b-minor`, `c-minor`, `c-sharp-minor`, `d-minor`, `d-sharp-minor`, `e-flat-minor`, `e-minor`, `f-minor`, `f-sharp-minor`, or `null`. Default: `null`.
- **expandScore** – Whether the score should be expanded/unrolled. Possible values: `intro` (expand introduction only, based on intro brackets), `full-score` (expand full score), or `false` (don’t expand). Default: `false`.
- **showChordSet** – Whether chord set should be visible. Possible values: ID of a provided chord set, or `false`. Default: `false`.
- **showChordSetImages** – Whether chord set images should show. Only applies if `showChordSet` is `true` and the currently-visible chord set has images. Boolean. Default: `false`.
- **showFingeringMarks** – Whether fingering marks should be visible. Only applies if the score has fingering marks. Boolean. Default: `false`.
- **showMeasureNumbers** – Whether measure numbers should be visible. Boolean. Default: `false`.
- **showMelodyOnly** – Whether non-melody notes should be hidden. Boolean. Default: `false`.
- **headerContent** – HTML content to display at the beginning of the score. Header and footer content is scaled with the score and included when printing. String or `null`. Default: `null`.
- **footerContent** – HTML content to display at the end of the score. Header and footer content is scaled with the score and included when printing. String or `null`. Default: `null`.
- **hideSectionIds** – Section IDs to hide. Possible values: One or more section (introduction, verse, chorus, etc.) IDs. Array. Default: `[]`.
- **drawBackgroundShapes** – Background shapes to draw. Possible values: See “Background and foreground shapes.” Array. Default: `[]`.
- **drawForegroundShapes** – Foreground shapes to draw. Possible values: See “Background and foreground shapes.” Array. Default: `[]`.
- **customEvents** – Custom events to send. Possible values: See “Custom events.” Array. Default: `['ch:tap', 'ch:scoreload', 'ch:scoredraw', 'ch:midiready', 'ch:pagechange']`.

### <a name="custom-events"></a>Custom events

When enabled in options, Chorister.js sends [custom events](https://developer.mozilla.org/en-US/docs/Web/Events/Creating_and_triggering_events) to the score container:

- **ch:tap** – Sent when the user taps on a shape in the score.
- **ch:hover** – Sent when the user hovers over a shape in the score with a mouse or trackpad. Disabled by default to reduce processing.
- **ch:scoreload** – Sent when the score finishes its initial loading.
- **ch:scoredraw** – Sent each time the score is drawn or redrawn.
- **ch:midiready** – Sent when MIDI is processed and ready to use.
- **ch:pagechange** – Sent when the current page changes (for paginated layout).

Each event has a `detail` attribute that provides additional information. For example, the `ch:tap` event could be used to trigger playback from a specific place in the score:

```javascript
const scoreContainer = document.getElementById('score-container');
scoreContainer.addEventListener('ch:tap', (event) => {
  console.log(event.detail);
  if (event.detail.pointData.expandedChordPositions.length > 0) {
    const startTime = getTimestamp(event.detail.pointData.expandedChordPositions[0]);
    prPlayer.seekToTime(startTime, { play: true });
  }
});
```

The `ch:tap` and `ch:hover` events require corresponding shapes to be added in Chorister.js options. This is because SVG elements don’t respond to pointer events in empty spaces. For example, if you want the event to include chord position information, you’ll need to add `ch-chord-position-rect` as a foreground or background shape.

### <a name="elements-and-attributes"></a>Elements and attributes

Several elements and attributes in the SVG score are useful for CSS styling.

#### Verovio-provided classes

Verovio’s native sheet music format is [MEI](https://music-encoding.org). MusicXML and other input formats are first converted to MEI, then rendered to SVG. SVG elements have class names that represent elements in the MEI. For example, an MEI `<note>` element is rendered to SVG `<g class="note">`.

Verovio also adds the `@data-related` attribute to elements that are related to a specific note, such as ledger lines, note heads, accidentals, stems, and dots. These are useful for styling all of the parts of a note together. The value of the attribute is one or more ID(s) of the related note(s).

#### Additional data attributes

Chorister.js adds the following data attributes to elements in Verovio’s SVG output:

- **@data-ch-chord-position** – Indicates the chord position of each element. Chord position is the relative position of each unique note or rest onset, as written in the sheet music, starting at 0 for the first written note or chord in the sheet music. Added to chord, note, rest, dir, harm, fermata, breath, and caesura elements.
- **@data-ch-expanded-chord-position** – Expanded chord position is similar to chord position, but it indicates relative position in the expanded score, or the order that notes are played. If the score has repeats or jumps, elements may have multiple expanded chord positions. Added to chord, note, rest, dir, harm, fermata, breath, and caesura elements.
- **@data-ch-part-id** – Indicates the vocal or instrumental part. Added to note and rest elements.
- **@data-ch-melody** – Indicates that the note or rest is part of the melody. Added to note and rest elements.
- **@data-ch-section-id** – Indicates the section ID for lyric syllables. Added to verse and label elements. Also added to `dir` elements for instructions that apply to a specific verse.
- **@data-ch-secondary** – Indicates that the lyric text is secondary, i.e. not part of the melody (if part information is provided). Added to verse elements.
- **@data-ch-chorus** – Indicates that the lyric text is part of a chorus or refrain. Added to verse elements.
- **@data-ch-lyric-line-id** – Indicates the lyric line ID. Can be used to highlight a specific verse in the score.
- **@data-ch-intro-bracket** – Indicates an intro bracket (⌜ or ⌝). The attribute value is either `start` or `end`.
- **@data-ch-round-marker** – Indicates a round marker (①, ②, ③, etc.).
- **@data-ch-help-text** – Indicates help text, such as inline pronunciations or singer designations. Added to verse and syl elements.
- **@data-ch-label-marker** – Marker on the left when chord position, measure, or beat labels are enabled.

These data attributes are set on the score container:

- **@data-ch-status** – Attribute that indicates the score loading status (preparing, processing, drawing, or ready).
- **@data-ch-layout** – Attribute that indicates the current layout type.
- **@data-ch-scale-to-fit** – Attribute that indicates if scale to fit is enabled (scale option set to an array with different min and max values).
- **@data-ch-pinch** – Attribute that indicates if the score is currently being pinched to zoom.
- **@data-ch-width** – Attribute that indicates the score width.
- **@data-ch-height** – Attribute that indicates the score height.
- **@data-ch-scale** – Attribute that indicates the score scale.

The score container has inner containers identified by these data attributes:

- **@data-ch-page** – Attribute on each page of the score. The attribute value is the page number.
- **@data-ch-svg** – Attribute on element(s) that contain SVG sheet music.
- **@data-ch-lyrics-below** – Attribute on element(s) that contain lyrics below the sheet music (for provided lyric stanzas that aren’t inline with the sheet music).
- **@data-ch-header** – Attribute on element(s) that contain header content (set with `headerContent` option).
- **@data-ch-footer** – Attribute on element(s) that contain footer content (set with `footerContent` option).

Additionally, the score container has a `style` attribute with the CSS [custom property](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/--*) `--ch-scale`. This can be used to adjust the relative size of header and footer content and verses below.

#### Background and foreground shapes

Chorister.js supports adding labels and shapes to the foreground or background in the SVG output, using the `drawBackgroundShapes` and `drawForegroundShapes` options. These can be used for hover effects, highlighting what’s currently playing, or labeling parts of the score. They are identified by their class names: `ch-staff-label`, `ch-lyric-line-label`, `ch-measure-label`, `ch-beat-label`, `ch-chord-position-label`, `ch-system-rect`, `ch-measure-rect`, `ch-staff-rect`, `ch-chord-position-line`, `ch-chord-position-rect`, `ch-note-circle`, `ch-lyric-rect`.

## <a name="license"></a>License

- Chorister.js: MIT License.
- [Verovio](https://www.verovio.org/): Used for parsing and rendering sheet music to SVG. [LGPLv3](https://book.verovio.org/introduction/licensing.html) license. Chorister.js dynamically links to Verovio at runtime using JavaScript import.
- [Magenta.js](https://github.com/magenta/magenta-js): Used for loading and processing MIDI. Apache 2.0 license.
