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
- Responsive layout that adapts to various screen sizes.
- Support for expanding/unrolling piano introductions, verses, jumps, and repeats.
- Melody-only view (when part information is provided).
- Support for switching between multiple “chord sets” (guitar chords, ukulele chords, analytical marks, etc.).
- Toggling of sheet music features such as fingering marks and measure numbers.
- Support for transposing to different keys.
- Support for showing and hiding verses.
- Support for printing.

### MIDI and lyric alignment

Chorister.js doesn’t directly handle audio playback, but it processes and exports MIDI that can be loaded into other libraries that support MIDI playback, such as [ProxyPlayer.js](https://github.com/samuelbradshaw/proxy-player-js).

- Provided or Verovio-generated MIDI is expanded and aligned with the sheet music.
- MIDI is split into channels based on sheet music parts (when part information is provided).
- MIDI is adapted to the lyrics, handling cases where a syllable is only sung in certain verses.
- Support for adjusting the length of fermatas (when relative durations are provided).
- Lyric text (if provided) is aligned to sheet music syllables, supporting use cases such as displaying chord sets in a standalone lyrics view.

### Tap events and CSS styles

- Chorister.js sends [custom events](https://developer.mozilla.org/en-US/docs/Web/Events/Creating_and_triggering_events) when tapping or hovering over various elements in the score, such as measures, chord positions, and notes. These can be used to trigger actions in your code, such as starting playback at a specific place. See “Custom events” below.
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
  const scoreType = 'mxl';
  const inputData = {
    scoreUrl: 'https://cdn.jsdelivr.net/gh/samuelbradshaw/chorister-js@main/resources/how-great-the-wisdom-and-the-love.musicxml',
    partsTemplate: 'SATB',
  };
  
  // Define options
  const options = {
    zoomPercent: 40,
  }
  
  // Use an asynchronous function to load the score
  let chScore, scoreData;
  async function loadScore() {
    // Pass in a CSS selector that selects the score container
    chScore = new ChScore('#score-container');
    scoreData = await chScore.loadScore(scoreType, inputData, options);
  }
  loadScore();
  
</script>
```

### <a name="public-methods"></a>Public methods

- **load(scoreType, inputData, options)** – Load a score. Parameters:
- * **scoreType** – `mxl` (compressed MusicXML), `musicxml`, `mei`, `abc`, `humdrum`, `plaine-and-easie`, or `cmme`. Required. See [Verovio input formats](https://book.verovio.org/toolkit-reference/input-formats.html).
- * **inputData** – Score content and information about the score. Required. See “Input data” below.
- * **options** – Settings to control how the score is rendered. Optional. See “Options” below.
- **setOptions(optionsToUpdate)** – Set one or more options after the score is rendered.
- * **optionsToUpdate** – Object with the options to be changed. Required.
- **getOptions()** – Get the currently-set options.
- **getScoreData()** – Get information about the loaded score. Some of the provided data can be helpful for loading controls (for users to adjust options).
- **getScoreContainer()** – Get a reference to the element that holds the rendered score.
- **getKeySignatureInfo()** – Get key signature information for the loaded score.
- **getMidi(format)** – Get processed MIDI content.
- * **format** – Preferred format. Optional. Valid values: `note-sequence` (Magenta note sequence), `blob` ([Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) object), `array-buffer` ([ArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/ArrayBuffer) object). Default: `note-sequence`.
- **drawScore()** – Draw or redraw the score. In most cases, Chorister.js will handle drawing automatically, so you shouldn’t usually need to call this.
- **removeScore()** – Remove the current score from the page and clear stored data.

Most of these methods will only work after the score is loaded.

## <a name="advanced-usage"></a>Advanced usage

### <a name="terminology"></a>Terminology

- **Score** – Sheet music to be visually rendered.
- **Score container** – HTML element that holds the rendered score, and can receive JavaScript events.
- **Chord position** – Relative position of each note/rest onset, in the order the score is written (ignoring jumps and repeats), starting at 0.
- **Expanded chord position** – Relative position of each note/rest onset, in the order the score is played, starting at 0. If the score has jumps or repeats, notes and rests that are played multiple times will have multiple expanded chord positions.
- **Part** – Choral voicing or instrument, such as soprano, alto, tenor, bass, violin, trumpet, accompaniment, etc.
- **Section** – Introduction, verse, chorus, or other similar unit of a song. May also refer to MEI `<section>` elements, depending on the context.
- **Lyric line ID** – Identifier for a specific lyric line. For example, syllables in staff 1, lyric line 2, would be marked with lyric line ID `1.2`.
- **Chord set** – Set of guitar chords, ukulele chords, analytical marks, or similar text and/or images that can be displayed just above the music system.
- **Intro bracket** – Brackets (⌜ or ⌝) that appear above the music system to mark a sequence of notes as the piano/organ introduction (mainly used in hymns with compressed scores).

### <a name="input-data"></a>Input data

Input data is provided to Chorister.js when loading the score (see “Methods”). The `inputData` object has the following properties:

- **scoreId** – Unique identifier for the score. Optional.
- **scoreUrl** – URL where the score can be fetched. Either `scoreUrl` or `scoreContent` is required.
- **midiUrl** – URL where a MIDI file can be fetched. Optional.
- **lyricsUrl** – URL where lyrics can be fetched as plain text. Optional.
- **scoreContent** – Score content as a string. Either `scoreUrl` or `scoreContent` is required.
- **midiNoteSequence** – MIDI content as a Magenta note sequence. Optional.
- **lyricsText** – Lyrics as a string. Optional.
- **parts** – Parts object (more details below). Optional.
- **partsTemplate** – Parts template string (more details below). Optional.
- **sections** – Sections object (more details below). Optional.
- **chordSets** – Chord sets object (more details below). Optional.
- **fermatas** – Fermatas object (more details below). Optional.

`scoreUrl`, `midiUrl`, and `lyricsUrl` may be subject to [CORS restrictions](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS) depending on where the files are hosted.

With only a score (`scoreUrl` or `scoreContent`), Chorister.js should render clean, responsive sheet music with basic functionality. However, additional data can enable additional functionality:

- **MIDI.** High-quality MIDI allows for more realistic playback, with variation in volume and tempo. Provided MIDI can be minimal (single play-through from top to bottom, ignoring jumps and repeats) or complete (play-through of the entire song with all verses). If MIDI isn’t provided or can’t be aligned with the score, Chorister.js will use Verovio-generated MIDI.

- **Lyrics.** Chorister.js can align versified lyrics with sheet music syllables. This enables breaking complex scores into logical sections. Lyrics not in the score will be displayed below the sheet music. If lyrics aren't provided, Chorister.js will attempt to extract lyrics on the fly.

- **Parts.** The parts template or parts object provides information about the choral voicing and/or instruments in the score, as well as information about each staff. This enables Chorister.js to identify the melody, and to tag notes in the score and MIDI as belonging to a specific part. If parts metadata isn't provided, Chorister.js will mark the top part in the first staff as the melody, and remaining parts as accompaniment.

- **Sections.** The sections object identifies the logical sections of the score, such as the introduction, verses, choruses, etc. If not provided, Chorister.js will attempt to generate sections automatically based on lyrics, MEI expansions, verse labels in the score, intro brackets, and other hints. Automatic section generation may be sufficient for some scores.

- **Chord sets.** Guitar chords, ukulele chords, analytical marks, or similar text and/or images to be shown above the music system.

- **Fermatas.** Information about each fermata in the score, for better MIDI playback.

#### Examples

<details>
<summary>Lyrics</summary>

Provided lyrics should be written in the order they're sung (for example, repeat the chorus if it's sung multiple times), with bracketed labels such as [Verse 1], [Chorus], or [Bridge] above each lyric block. Only melody lyrics should be included (not lyrics from alternate or secondary parts).

```
[Verse 1]
When peace, like a river, attendeth my way,
When sorrows like sea billows roll—
Whatever my lot, Thou hast taught me to say,
“It is well, it is well with my soul.”

[Chorus]
It is well with my soul;
It is well, it is well with my soul.

[Verse 2]
Though Satan should buffet, though trials should come,
Let this blest assurance control:
That Christ hath regarded my helpless estate
And hath shed His own blood for my soul.

[Chorus]
It is well with my soul;
It is well, it is well with my soul.

[Verse 3]
My sin—oh, the bliss of this glorious thought!—
My sin, not in part but the whole,
Is nailed to the cross, and I bear it no more.
Praise the Lord, praise the Lord, O my soul.

[Chorus]
It is well with my soul;
It is well, it is well with my soul.

[Verse 4]
O Lord, haste the day when my faith shall be sight,
The heav’ns be rolled back like a scroll.
The trump shall resound, and the Lord shall descend;
Even so, it is well with my soul.

[Chorus]
It is well with my soul;
It is well, it is well with my soul.
```
</details>

<details>
<summary>Parts</summary>

Parts can be provided as a “parts template” string, or a parts object.

#### Parts template

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
- \# = separator for specifying melody part (if not specified, M, S, P, or the first part is chosen as the melody)
- ; = separator between chord position changes

Normalizations:
- Melody –> MC
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
- SSAA –> SS+AAA
- AATT –> AA+TT
- TTBB –> TT+BB
- For unspecified staves, the normalized template is padded with C (accompaniment, if there are lyrics) or I (instrumental)

Examples:
- `SATB` – Staff 1: Soprano, alto. Staff 2: Tenor, bass.
- `TT+BB#T2` – Staff 1: First tenor, second tenor. Staff 2: First bass, second bass. Second tenor has the melody.
- `Descant+Unison` – Staff 1: Descant. Remaining staves: Unison (melody and accompaniment).

If parts change throughout the song, templates can be combined and marked with starting chord positions:
- `0:Unison; 39:SA+TB`
- `0:SS+A#S1; 35:SS+A#S1`
- `0:SA+TB#S; 24:SA+TB#T; 36:SA+TB#S`


#### Parts object
```json
[
    {
        "partId": "soprano",
        "name": "Soprano",
        "isVocal": true,
        "placement": "auto",
        "chordPositionRefs": {
            "0": { "isMelody": true,
                "staffNumbers": [1],
                "lyricLineIds": null }
        }
    },
    {
        "partId": "alto",
        "name": "Alto",
        "isVocal": true,
        "placement": "auto",
        "chordPositionRefs": {
            "0": { "isMelody": false,
                "staffNumbers": [1],
                "lyricLineIds": null }
        }
    },
    {
        "partId": "tenor",
        "name": "Tenor",
        "isVocal": true,
        "placement": "auto",
        "chordPositionRefs": {
            "0": { "isMelody": false,
                "staffNumbers": [2],
                "lyricLineIds": null }
        }
    },
    {
        "partId": "bass",
        "name": "Bass",
        "isVocal": true,
        "placement": "auto",
        "chordPositionRefs": {
            "0": { "isMelody": false,
                "staffNumbers": [2],
                "lyricLineIds": null }
        }
    }
]
```

Properties:
- **partId** – Any unique ID for the part. String.
- **name** – Part name that may be visible to users. String.
- **isVocal** – Whether the part is sung or instrumental. Boolean.
- **placement** – Placement of the part on its staff/staves. Valid values: 1, 2, 3, 4 (relative position among other parts on the staff), "full" (fills the specified staves), "auto" (automatically placed).
- **chordPositionRefs** – Chord position where the part starts or where part metadata changes. Integer.
- * **isMelody** – Whether the part includes the melody (starting at the given chord position). Boolean.
- * **staffNumbers** – Numbers of the staves where the part is to be placed. List of integers.
- * **lyricLineIds** – References to lyrics that are sung in the part. List of lyricLineIds (combination of staff and lyric line number – for example, a lyric syllable on the second staff, line number 1, has lyricLineId "2.1"). Optional.
</details>

<details>
<summary>Sections</summary>

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
            { "start": 0, "end": 12,
              "staffNumbers": [1, 2],
              "lyricLineIds": [] },
            { "start": 55, "end": 63,
              "staffNumbers": [1, 2],
              "lyricLineIds": [] }
        ]
    },
    {
        "sectionId": "verse-1",
        "type": "verse",
        "name": "Verse 1",
        "marker": 1,
        "placement": "inline",
        "pauseAfter": false,
        "chordPositionRanges": [
            { "start": 0, "end": 42,
              "staffNumbers": [1, 2],
              "lyricLineIds": ["1.1"] }
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
            { "start": 42, "end": 63,
              "staffNumbers": [1, 2],
              "lyricLineIds": ["1.1"] }
        ]
    }
]
```

Properties:
- **sectionId** – Any unique ID for the part. String.
- **type** – Section type. Valid values: "introduction", "verse", "chorus", "bridge", "interlude", "unknown".
- **name** – Section name that may be visible to users. String.
- **marker** – Verse number or similar sequential marker. String. Optional.
- **placement** – Placement of the section in the score. Valid values: "inline" (inline with the music), "below" (below the music), "none" (not placed in the score).
- **pauseAfter** – Whether a short pause should be added in the MIDI after the section is played. Boolean.
- **chordPositionRanges** – Chord position ranges that are part of the verse.
- * **start** – Chord position where the range starts. Integer.
- * **end** – Chord position where the range ends (exclusive range). Integer.
- * **staffNumbers** – Numbers of the staves that are relevant to the section. For example, if the first staff is a descant only sung on the third verse, only the third verse should include that staff number. List of integers. Optional.
- * **lyricLineIds** – References to lyrics that are relevant to the section. List of lyricLineIds (combination of staff and lyric line number – for example, a lyric syllable on the second staff, line number 1, has lyricLineId "2.1"). Optional.
</details>

<details>
<summary>Chord sets</summary>

```json
[
    {
        "chordSetId": "default",
        "name": "Default",
        "svgSymbolsUrl": null,
        "chordPositionRefs": {
            "1": {
                "prefix": null,
                "text": "C",
                "svgSymbolId": null
            },
            "4": {
                "prefix": null,
                "text": "C+",
                "svgSymbolId": null
            },
            "7": {
                "prefix": null,
                "text": "Dm",
                "svgSymbolId": null
            },
            ...
        }
    },
    {
        "chordSetId": "guitar",
        "name": "Guitar",
        "svgSymbolsUrl": null,
        "chordPositionRefs": {
            "1": {
                "text": "C",
                "prefix": null,
                "svgSymbolId": null
            },
            "4": {
                "text": "C+",
                "prefix": null,
                "svgSymbolId": null
            },
            "7": {
                "text": "Dm",
                "prefix": null,
                "svgSymbolId": null
            },
            ...
        }
    },
    {
        "chordSetId": "parsons-code",
        "name": "Parsons Code",
        "svgSymbolsUrl": "/static/symbols.svg",
        "chordPositionRefs": {
            "0": {
                "text": "＊",
                "prefix": null,
                "svgSymbolId": "pc-asterisk"
            },
            "1": {
                "text": "R",
                "prefix": null,
                "svgSymbolId": "pc-repeat"
            },
            "2": {
                "text": "D",
                "prefix": null,
                "svgSymbolId": "pc-down"
            },
            ...
        }
    }
]
```

Properties:
- **chordSetId** – Any unique ID for the chord set. String.
- **name** – Chord set name that may be visible to users. String.
- **svgSymbolsUrl** – Relative or absolute URL to an SVG file with SVG symbols. String. Optional.
- **chordPositionRefs** – Chord position where an item should be added. Integer.
- * **text** – Text to be added. String.
- * **prefix** – Prefix to be added, such as `Capo 5:`. String. Optional.
- * **svgSymbolId** – ID of the SVG symbol to be drawn above (when enabled in options). String. Optional.
</details>

<details>
<summary>Fermatas</summary>

```json
[
    {
        "chordPosition": 31,
        "durationFactor": 2.0
    },
    {
        "chordPosition": 157,
        "durationFactor": 1.5
    }
]
```

Properties:
- **chordPosition** – Chord position of the fermata. Integer.
- **durationFactor** – Relative duration of the chord position. Float.
</details>


### <a name="options"></a>Options

Options can be passed in to Chorister.js when calling the `load()` method to load the score. After the score is loaded, options can be changed with the `setOptions()` method (see “Methods”). An `options` object has the following optional properties:

- **zoomPercent** – Size of the sheet music. Integer. Default: `40`.
- **keySignatureId** – Key signature to transpose the sheet music to. Possible values: `'c-major'`, `'d-sharp-minor'`, etc. (full list at the bottom of chorister.js) or `null`. Default: `null`.
- **expandScore** – Whether the score should be expanded/unrolled. Possible values: `'intro'` (expand introduction only, based on intro brackets), `'full-score'` (expand full score), or `false` (don’t expand). Default: `false`.
- **showChordSet** – Whether chord set should be visible. Possible values: ID of a provided chord set, or `false`. Default: `false`.
- **showChordSetImages** – Whether chord set images should show. Only applies if `showChordSet` is `true` and the currently-visible chord set has images. Boolean. Default: `false`.
- **showFingeringMarks** – Whether fingering marks should be visible. Only applies if the score has fingering marks. Boolean. Default: `false`.
- **showMeasureNumbers** – Whether measure numbers should be visible. Boolean. Default: `false`.
- **showMelodyOnly** – Whether non-melody notes should be hidden. Boolean. Default: `false`.
- **hiddenSectionIds** – Section IDs to hide. Possible values: One or more section (intro, verse, chorus, etc.) IDs. Array. Default: `[]`.
- **drawBackgroundShapes** – Background shapes to draw. Possible values: See “Background and foreground shapes.” Array. Default: `[]`.
- **drawForegroundShapes** – Foreground shapes to draw. Possible values: See “Background and foreground shapes.” Array. Default: `[]`.
- **customEvents** – Custom events to send. Possible values: See “Custom events.” Array. Default: `[]`.

### <a name="custom-events"></a>Custom events

When enabled in options, Chorister.js sends [custom events](https://developer.mozilla.org/en-US/docs/Web/Events/Creating_and_triggering_events) to the score container:

- **ch:tap** – Sent when the user taps on an item in the score.
- **ch:hover** – Sent when the user hovers over an element in the score (with a mouse or trackpad).

These events have a `detail` attribute that provides information about what was tapped or hovered. This information can be used to trigger selection or playback of certain parts of the score. Here’s an example:

```javascript
const scoreContainer = document.getElementById('score-container');
scoreContainer.addEventListener('ch:tap', (event) => {
  console.log(event.detail);
});
```

### <a name="elements-and-attributes"></a>Elements and attributes

Several elements and attributes in the SVG score are useful for CSS styling.

#### Verovio-provided classes

Verovio’s native sheet music format is [MEI](https://music-encoding.org). MusicXML and other input formats are first converted to MEI, then rendered to SVG. SVG elements have class names that represent elements in the MEI. For example, an MEI `<note>` element is rendered to SVG `<g class="note">`.

Verovio also adds the `@data-related` attribute to elements that are related to a specific note, such as ledger lines, note heads, accidentals, stems, and dots. These are useful for styling all of the parts of a note together. The value of the attribute is one or more ID(s) of the related note(s).

#### Additional data attributes

Chorister.js adds the following data attributes to elements in the SVG output:

- **@data-ch-chord-position** – Indicates the chord position of each element. Chord position is the relative position of each unique note or rest onset, as written in the sheet music, starting at 0 for the first written note or chord in the sheet music. Added to chord, note, rest, dir, harm, and fermata elements.
- **@data-ch-expanded-chord-position** – Expanded chord position is similar to chord position, but it indicates relative position in the expanded score, or the order that notes are played. If the score has repeats or jumps, elements may have multiple expanded chord positions. Added to chord, note, rest, dir, harm, and fermata elements.
- **@data-ch-lyric-line-id** – Indicates the lyric line ID. Can be used to highlight a specific verse in the score.
- **@data-ch-intro-bracket** – Indicates an intro bracket (⌜ or ⌝). The attribute value is either `start` or `end`.
- **@data-ch-part-id** – Indicates the vocal or instrumental part (if part information is provided). Added to note and rest elements.
- **@data-ch-melody** – Indicates that the note or rest is part of the melody (if part information is provided). Added to note and rest elements.
- **@data-ch-section-id** – Indicates the section ID for lyric text. Added to verse and label elements.
- **@data-ch-secondary** – Indicates that the lyric text is secondary, i.e. not part of the melody (if part information is provided). Added to verse elements.
- **@data-ch-chorus** – Indicates that the lyric text is part of a chorus or refrain. Added to verse elements.

#### Background and foreground shapes

Chorister.js supports adding labels and shapes to the foreground or background in the SVG output, using the `drawBackgroundShapes` and `drawForegroundShapes` options. These can be used for hover effects, highlighting what's currently playing, or labeling parts of the score: `ch-staff-label`, `ch-chord-position-label`, `ch-lyric-line-label`, `ch-system-rect`, `ch-measure-rect`, `ch-staff-rect`, `ch-chord-position-line`, `ch-chord-position-rect`, `ch-note-circle`, `ch-lyric-rect`.

## <a name="license"></a>License

- Chorister.js: MIT License.
- [Verovio](https://www.verovio.org/): Used for parsing and rendering sheet music to SVG. [LGPLv3](https://book.verovio.org/introduction/licensing.html) license. Chorister.js dynamically links to Verovio at runtime using JavaScript import.
- [Magenta.js](https://github.com/magenta/magenta-js): Used for loading and processing MIDI. Apache 2.0 license.
