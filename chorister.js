/**
 * Chorister.js
 * https://github.com/samuelbradshaw/chorister-js
 */

'use strict';

function ChScore(containerSelector) {
  this._scoreData = null;
  this._currentOptions = null;
  this._vrvToolkit = null;
  
  this._container = document.querySelector(containerSelector);
  if (!this._container) {
    console.error(`Couldn't find a valid score container that matches "${containerSelector}".`);
    return false;
  }
  
  // Remove the previous score if the container already has one
  if (this._container.score) this.removeScore();
  
  // Set up stylesheets
  this._stylesheets = {};
  const generalStylesheet = this._addStylesheet('general');
  generalStylesheet.replaceSync(`
    .ch-staff-label,
    .ch-chord-position-label,
    .ch-lyric-line-label {
      opacity: 1;
    }
    .ch-system-rect,
    .ch-measure-rect,
    .ch-staff-rect,
    .ch-chord-position-line,
    .ch-chord-position-rect,
    .ch-note-circle,
    .ch-lyric-rect {
      opacity: 0;
    }
    @media print {
      ${containerSelector} > * {
        display: block;
        margin-inline: auto;
      }
      ${containerSelector} > svg {
        margin-top: 4mm;
      }
      #lyrics-below {
        width: 172mm; /* Same width as SVG when printing */
        text-align: left;
      }
      svg.definition-scale {
        color: black !important;
        fill: black !important;
        stroke: black !important;
      }
      g.ch-shapes {
        display: none;
      }
    }
  `);
  
  // -------- EVENT LISTENERS --------
  
  // Abort controller can be used to cancel event listeners if the score is removed
  this._controller = new AbortController;
  
  // Print
  window.addEventListener('beforeprint', (event) => {
    // TODO: Add blank space at the top of each page (except for the first page), so that systems on subsequent pages aren't higher than the title when viewing them side-by-side
    this.setOptions(this._currentOptions, true, 'print');
  }, { signal: this._controller.signal })
  window.addEventListener('afterprint', (event) => {
    this.setOptions(this._currentOptions, true, 'screen');
  }, { signal: this._controller.signal })
  
  // Score tap
  const respondToClick = () => {
    if (!this._currentOptions.customEvents.includes('ch:tap')) return;
    const pointData = this._getPointData(event.clientX, event.clientY);
    this._container.dispatchEvent(new CustomEvent('ch:tap', { detail: structuredClone(pointData) }));
  }
  this._container.addEventListener('click', respondToClick, { signal: this._controller.signal });
  
  // Score hover
  this._hoverState = {};
  const respondToMouseMove = (event, ignoreThrottle = false) => {
    if (!this._currentOptions.customEvents.includes('ch:hover')) return;
    if (!ignoreThrottle && this._isThrottled('mousemove', 100)) return;
    const pointData = this._getPointData(event.clientX, event.clientY);
    const pointDataValues = Object.entries(pointData).map(e => (e ?? '').toString()).join(';');
    const hoverStateValues = Object.entries(this._hoverState).map(e => (e ?? '').toString()).join(';');
    if (pointDataValues === hoverStateValues) return;
    this._hoverState = pointData;
    this._container.dispatchEvent(new CustomEvent('ch:hover', { detail: structuredClone(this._hoverState) }));
  }
  this._container.addEventListener('mousemove', (event) => respondToMouseMove(event), { signal: this._controller.signal });
  this._container.addEventListener('mouseleave', (event) => respondToMouseMove(event, true), { signal: this._controller.signal });
  
  // Score container resize
  this._resizeObserver = null;
  this._container.dataset.width = Math.round(this._container.clientWidth - parseInt(window.getComputedStyle(this._container).getPropertyValue('padding-left')) - parseInt(window.getComputedStyle(this._container).getPropertyValue('padding-right')));
  this._resizeObserver = new ResizeObserver(this._debounce((entries) => {
    for (const entry of entries) {
      const container = entry.target;
      const width = Math.round(entry.contentBoxSize[0].inlineSize);
      if (this._scoreData && width !== parseInt(container.dataset.width)) {
        this.setOptions(this._currentOptions, true);
        container.dataset.width = width;
      }
    }
  }, 200));
  this._resizeObserver.observe(this._container);
  
  
  // -------- FINISH INITIALIZATION --------
  
  this._chScores.push(this);
  this._container.score = this;
  this._container.dataset.status = 'ready';
}

// Load score
ChScore.prototype.load = async function (scoreType, { scoreId = null, scoreUrl = null, midiUrl = null, lyricsUrl = null, scoreContent = null, midiNoteSequence = null, lyricsText = null, parts = null, partsTemplate = null, sections = null, chordSets = null, fermatas = null }, options = this._defaultOptions) {
  if (!scoreType || !(scoreUrl || scoreContent)) {
    console.error(`Score data is incomplete: scoreType and scoreUrl (or scoreContent) are required. Loading default score.`);
    scoreType = this._defaultInputData.scoreType;
    scoreContent = this._defaultInputData.scoreContent;
  }
  
  const safeFetch = async (...args) => {
    try {
      const response = await fetch(...args);
      if (response.ok) {
        return response;
      } else {
        throw new Error(`Failed to fetch URL. HTTP error: ${response.status}.`);
      }
    } catch (err) {
      if (err instanceof TypeError) { // CORS error, etc.
        throw new Error('Failed to fetch URL. See console for details.');
      } else {
        throw err;
      }
    }
  }
  
  // Wait for dependencies and fetch remote resources
  let midiArray;
  await Promise.all([
    this._chDependenciesLoaded,
    (async () => {
      if (scoreUrl && !scoreContent) {
        const response = await safeFetch(scoreUrl);
        scoreContent = await (scoreType === 'mxl' ? response.arrayBuffer() : response.text());
      }
    })(),
    (async () => {
      if (midiUrl && !midiNoteSequence) {
        const response = await safeFetch(midiUrl);
        midiArray = await response.arrayBuffer();
      }
    })(),
    (async () => {
      if (lyricsUrl && !lyricsText) {
        const response = await safeFetch(lyricsUrl);
        lyricsText = await response.text();
      }
    })(),
  ]);
  
  // Load score into Verovio
  this._vrvToolkit = new verovio.toolkit();
  this.setOptions(options, false);
  if (scoreContent instanceof ArrayBuffer) {
    // MXL (ArrayBuffer)
    this._vrvToolkit.loadZipDataBuffer(scoreContent);
  } else {
    // MusicXML, MEI, ABC, Humdrum, or PAE string
    if (scoreType === 'abc') {
      // Clean up leading spaces on each line
      scoreContent = scoreContent.replace(/^\s+/gm, '');
    }
    this._vrvToolkit.loadData(scoreContent);
  }
  
  // Get MIDI from Verovio if needed
  let midiType;
  if (!midiNoteSequence && !midiArray) {
    midiArray = Uint8Array.from(atob(this._vrvToolkit.renderToMIDI()), c => c.charCodeAt(0));
    midiType = 'verovio';
  }
  
  // Create scoreData object
  this._scoreData = {
    scoreId: scoreId,
    meiStringOriginal: this._vrvToolkit.getMEI(),
    midiNoteSequence: midiNoteSequence ?? core.midiToSequenceProto(midiArray),
    midiType: midiType ?? null,
    lyricsText: lyricsText || null,
    parts: parts ?? [],
    partsById: null,
    partsTemplate: partsTemplate ?? null,
    sections: sections ?? [],
    sectionsById: null,
    chordSets: chordSets ?? [],
    chordSetsById: null,
    fermatas: fermatas ?? [],
  };
  
  // Process and render MEI and MIDI
  this._parseAndAnnotateMei();
  this.drawScore();
  this._loadMidi();
  
  this._container.dataset.status = 'loaded';
  return this._scoreData;
}

// Update one or more of the initialized options
ChScore.prototype.setOptions = function (optionsToUpdate, redraw = true, mediaType = 'screen') {
  this._currentOptions = this._currentOptions ?? {};
  for (const key of Object.keys(this._defaultOptions)) {
    this._currentOptions[key] = this._currentOptions[key] ?? this._defaultOptions[key];
  }
  const updatedOptionKeys = [];
  const oldOptions = structuredClone(this._currentOptions);
  for (const key of Object.keys(optionsToUpdate)) {
    if (oldOptions[key] !== optionsToUpdate[key]) updatedOptionKeys.push(key);
    this._currentOptions[key] = optionsToUpdate[key];
  }
  
  // Set Verovio options
  const verovioOptions = structuredClone(this._defaultVerovioOptions);
  
  if (mediaType === 'print') {
    if (!this._currentOptions.showChordSetImages) verovioOptions.breaks = 'line';
    verovioOptions.mmOutput = true;
    verovioOptions.scale = 100;
    verovioOptions.pageWidth = 172 * 10; // 172mm (A4-210mm paper size, minus 19mm margin). TODO: See how this looks in print
    verovioOptions.pageHeight = 100; // If the page height were tall, for example 10000px, the whole song could be rendered as a single Verovio "page" (SVG element), which works well for most use cases. However, using a short height like 100px forces each system to be an independent SVG element, which is desirable when printing to a fixed paper size, because it allows a system to wrap to the next page instead of getting cut off in the middle. A downside of each system being its own SVG element is that the space between systems isn't consistent by default; however, this can be fixed by adding padding between systems after the SVG is rendered.
  } else if (mediaType === 'screen') {
    verovioOptions.scale = parseInt(this._currentOptions.zoomPercent);
    verovioOptions.pageWidth = this._container.offsetWidth * 100 / this._currentOptions.zoomPercent;
  }
  
  const shapeClassNames = (this._currentOptions.drawBackgroundShapes || []).concat(this._currentOptions.drawForegroundShapes || []);
  if (shapeClassNames.length > 0) {
    if (shapeClassNames.includes('ch-chord-position-label')) {
      verovioOptions.spacingSystem = 12;
      verovioOptions.pageMarginBottom = 100;
    }
    if (shapeClassNames.includes('ch-lyric-line-label')) {
      verovioOptions.pageMarginLeft = Math.max(verovioOptions.pageMarginLeft, 90);
    }
    if (shapeClassNames.includes('ch-staff-label')) {
      verovioOptions.pageMarginLeft = Math.max(verovioOptions.pageMarginLeft, 150);
    }
  }
  
  if (this._scoreData?.hasChordSets && this._currentOptions.showChordSet && this._currentOptions.showChordSetImages) {
    verovioOptions.spacingLinear = 1.0;
    verovioOptions.spacingNonLinear = 0.5;
    verovioOptions.spacingSystem = 26;
    verovioOptions.pageMarginTop = 220;
    if (this._currentOptions.showMelodyOnly) verovioOptions.spacingSystem += 5;
  }
  
  if (this._currentOptions.keySignatureId) {
    const keySignatureInfo = this.getKeySignatureInfo();
    const nearbyKeyIndex = keySignatureInfo.nearbyKeySignatures.findIndex(ks => ks.keySignatureId === this._currentOptions.keySignatureId);
    const nearbyKeyInfo = keySignatureInfo.nearbyKeySignatures[nearbyKeyIndex];
    const directionOperator = nearbyKeyIndex < 7 ? '-' : nearbyKeyIndex > 7 ? '+' : '';
    verovioOptions.transpose = directionOperator + nearbyKeyInfo.meiPnameAccid;
  }
  
  if (this._currentOptions.showMeasureNumbers) {
    verovioOptions.pageMarginLeft = Math.max(verovioOptions.pageMarginLeft, 30);
    verovioOptions.pageMarginRight = Math.max(verovioOptions.pageMarginRight, 30);
  }
  
  if (this._currentOptions.showMelodyOnly) {
    verovioOptions.spacingSystem += 5;
    verovioOptions.pageMarginBottom = Math.max(verovioOptions.pageMarginBottom, 50);
  }
  
  this._vrvToolkit.resetOptions();
  this._vrvToolkit.setOptions(verovioOptions);
  
  // Reload score, if it was loaded previously
  if (this._vrvToolkit.getPageCount() > 0) {
    if (updatedOptionKeys.some(key => ['showMelodyOnly', 'showChordSet', 'showChordSetImages', 'showFingeringMarks', 'showMeasureNumbers', 'hiddenSectionIds', 'expandScore'].includes(key))) {
      this._updateMei();
    }
    
    // Some options require loading the data into Verovio again
    // See https://github.com/rism-digital/verovio/discussions/4142
    if (verovioOptions.transpose || verovioOptions.expand || verovioOptions.expandNever || verovioOptions.expandAlways) {
      this._vrvToolkit.loadData(this._scoreData.meiString);
    } else {
      this._vrvToolkit.redoLayout();
    }
  }
  
  if (redraw) this.drawScore();
}

// Remove this ChScore instance
ChScore.prototype.removeScore = function () {
  this._removeStylesheets();
  this._resizeObserver?.disconnect()
  this._controller?.abort();
  this._container.innerHTML = '';
  this._container.removeAttribute('data-status');
  this._container.removeAttribute('data-width');
  this._container.score = undefined;
  this._chScores = this._chScores.filter(chScore => chScore.scoreContainer !== this._container);
}


// Get all of the initialized options
ChScore.prototype.getOptions = function () {
  return this._currentOptions;
}

// Get score data
ChScore.prototype.getScoreData = function () {
  return this._scoreData;
}

ChScore.prototype.getScoreContainer = function () {
  return this._container;
}

ChScore.prototype.drawScore = function () {
  // Render to SVG
  const numPages = this._vrvToolkit.getPageCount();
  this._container.innerHTML = '';
  for (let p = 1; p <= numPages; p++) {
    let svg = this._vrvToolkit.renderToSVG(p);
    svg = this._updateSvg(svg);
    this._container.insertAdjacentHTML('beforeend', svg);
  }
  
  // Add additional lyrics below the music
  const lyricsBelowContainer = document.createElement('div');
  lyricsBelowContainer.id = 'lyrics-below';
  for (const section of this._scoreData.sections) {
    if ((this._currentOptions.hiddenSectionIds ?? []).includes(section.sectionId) || section.placement !== 'below') {
      continue;
    }
    const lyricContainer = document.createElement('p');
    lyricContainer.dataset.chSectionId = section.sectionId;
    const lyricLines = section.annotatedLyrics.replace(/\||•|_|◠|◡/g, '').trim().split('\n');
    for (let ln = 0; ln < lyricLines.length; ln++) {
      const lyricLineContainer = document.createElement('div');
      let lineHtml = '';
      if (section.marker && ln === 0) lineHtml += `<span class="label">${section.marker}. </span>`;
      lineHtml += lyricLines[ln];
      lyricLineContainer.innerHTML = lineHtml;
      lyricContainer.append(lyricLineContainer);
    }
    lyricsBelowContainer.append(lyricContainer);
  }
  this._container.append(lyricsBelowContainer);
}

ChScore.prototype._loadMidi = function () {
  if (!this._scoreData.midiNoteSequence) {
    // If score was expanded, load a version of the score without the introduction before generating MIDI
    if (this._currentOptions.expandScore) this._vrvToolkit.loadData(this._scoreData.meiStringComplete);
    const midiArray = Uint8Array.from(atob(this._vrvToolkit.renderToMIDI()), c => c.charCodeAt(0));
    this._scoreData.midiNoteSequence = core.midiToSequenceProto(midiArray);
    this._scoreData.midiType = 'verovio';
    return this._loadMidi();
  }
  
  let midiNoteStartTimes;
  let midiNoteSequence = this._scoreData.midiNoteSequence;
  
  // Sort MIDI notes for easier alignment with score notes
  // Also remove duplicate notes (example: songs in 1985 Hymns have both piano notes and SATB notes)
  const filteredNotes = [];
  const uniqueNoteKeys = new Set();
  const uniqueStartTimes = new Set();
  for (const note of midiNoteSequence.notes) {
    const key = `${note.startTime}_${note.endTime}_${note.pitch}`;
    if (!uniqueNoteKeys.has(key)) {
      filteredNotes.push(note);
      uniqueNoteKeys.add(key);
      uniqueStartTimes.add(note.startTime);
    }
  }
  midiNoteSequence.notes = filteredNotes.sort((a, b) => a.startTime - b.startTime || a.pitch - b.pitch || (a.endTime - a.startTime) - (b.endTime - b.startTime));
  midiNoteStartTimes = [...uniqueStartTimes].sort((a, b) => a - b);
  
  // Check MIDI for errors
  if (midiNoteStartTimes.length === this._scoreData.audibleExpandedChordPositions.length) {
    this._scoreData.midiType = 'complete';
  } else if (midiNoteStartTimes.length === this._scoreData.audibleChordPositions.length) {
    this._scoreData.midiType = 'minimal';
  } else {
    if (this._scoreData.midiType === 'verovio') {
      console.error(`Error: Failed to load Verovio-generated MIDI. MIDI chord positions: ${midiNoteStartTimes.length}; MEI audible chord positions: ${this._scoreData.audibleChordPositions.length}; MEI expanded audible chord positions: ${this._scoreData.audibleExpandedChordPositions.length}.`);
      return;
    } else {
      console.warn(`Warning: Chord position mismatch. MIDI chord positions: ${midiNoteStartTimes.length}; MEI audible chord positions: ${this._scoreData.audibleChordPositions.length}; MEI expanded audible chord positions: ${this._scoreData.audibleExpandedChordPositions.length}. Falling back to Verovio-generated MIDI.`);
      this._scoreData.midiNoteSequence = null;
      return this._loadMidi();
    }
  }
  
  // Sort notes into chord positions
  let previousAudibleChordPositionInfo;
  for (const midiNote of midiNoteSequence.notes) {
    const startTimeIndex = midiNoteStartTimes.indexOf(midiNote.startTime);
    let chordPosition = startTimeIndex;
    if (this._scoreData.midiType === 'minimal') {
      chordPosition = this._scoreData.audibleChordPositions[startTimeIndex];
    } else if (this._scoreData.midiType === 'complete') {
      midiNote.expandedChordPosition = this._scoreData.audibleExpandedChordPositions[startTimeIndex];
      const expandedChordPositionInfo = this._scoreData.expandedChordPositions[midiNote.expandedChordPosition];
      chordPosition = expandedChordPositionInfo.chordPositionInfo.chordPosition;
    }
    const chordPositionInfo = this._scoreData.chordPositions[chordPosition];
    if (chordPositionInfo.chordPosition !== previousAudibleChordPositionInfo?.chordPosition) {
      chordPositionInfo.midiStartTime = midiNote.startTime;
      chordPositionInfo.midiQpm = this._getQpmAtTime(chordPositionInfo.midiStartTime, midiNoteSequence.tempos);
      
      // Update previous chord positions
      if (previousAudibleChordPositionInfo) {
        previousAudibleChordPositionInfo.midiEndTime = midiNote.startTime;
        previousAudibleChordPositionInfo.midiDuration = previousAudibleChordPositionInfo.midiEndTime - previousAudibleChordPositionInfo.midiStartTime;
        const previousQpm = previousAudibleChordPositionInfo.midiQpm;
        const previousChordPositionInfo = this._scoreData.chordPositions[chordPosition - 1];
        if (previousChordPositionInfo && previousChordPositionInfo.midiStartTime === null) {
          // Previous chord position didn't have notes
          const restDuration = this._getMidiDuration(previousChordPositionInfo.durationQ, previousQpm);
          previousChordPositionInfo.midiQpm = previousQpm;
          previousChordPositionInfo.midiStartTime = chordPositionInfo.midiStartTime - restDuration;
          previousChordPositionInfo.midiEndTime = chordPositionInfo.midiStartTime;
          previousChordPositionInfo.midiDuration = restDuration;
          previousAudibleChordPositionInfo.midiEndTime -= restDuration;
          previousAudibleChordPositionInfo.midiDuration -= restDuration;
        }
      }
    }
    chordPositionInfo.midiEndTime = Math.max(chordPositionInfo.midiEndTime, midiNote.endTime);
    if (!Object.hasOwn(chordPositionInfo.midiNotesByPitch, midiNote.pitch)) {
      chordPositionInfo.midiNotesByPitch[midiNote.pitch] = [];
    }
    chordPositionInfo.midiNotesByPitch[midiNote.pitch].push(midiNote);
    previousAudibleChordPositionInfo = chordPositionInfo;
  }
  previousAudibleChordPositionInfo.midiEndTime = midiNoteSequence.totalTime;
  previousAudibleChordPositionInfo.midiDuration = previousAudibleChordPositionInfo.midiEndTime - previousAudibleChordPositionInfo.midiStartTime;
  
  // Adjust duration of notes with fermatas
  const fermataAdjustedChordPositions = [];
  for (const fermata of this._scoreData.fermatas) {
    if (fermata.durationFactor <= 1 || fermataAdjustedChordPositions.includes(fermata.chordPosition)) continue;
    const fermataElement = this._scoreData.meiParsed.querySelectorAll(`fermata[ch-chord-position="${fermata.chordPosition}"]`);
    if (fermataElement) {
      fermataAdjustedChordPositions.push(fermata.chordPosition);
      const chordPositionInfo = this._scoreData.chordPositions[fermata.chordPosition];
      
      // Get the previous chord position without a fermata to compare tempos. Example song with two fermata'ed chord positions in a row: Love at Home (1985 Hymns).
      let previousCpWithoutFermata = fermata.chordPosition - 1;
      while (fermataAdjustedChordPositions.includes(previousCpWithoutFermata) && previousCpWithoutFermata >= 0) {
        previousCpWithoutFermata -= 1;
      }
      if (previousCpWithoutFermata >= 0 && chordPositionInfo.midiQpm < this._scoreData.chordPositions[previousCpWithoutFermata].midiQpm * 0.7) {
        // Significant tempo drop – fermata is likely already encoded in MIDI
        continue;
      } else {
        const durationOffset = (chordPositionInfo.midiDuration * fermata.durationFactor) - chordPositionInfo.midiDuration
        chordPositionInfo.midiDuration = chordPositionInfo.midiDuration + durationOffset;
        chordPositionInfo.midiEndTime = chordPositionInfo.midiEndTime + durationOffset;
        for (const midiNotes of Object.values(chordPositionInfo.midiNotesByPitch)) {
          for (const midiNote of midiNotes) {
            midiNote.endTime = midiNote.endTime + durationOffset;
          }
        }
      }
    }
  }
  
  // Expand MIDI based on expanded chord positions, and align MIDI notes to MEI notes
  const allPartIds = Object.keys(this._scoreData.partsById);
  let startTimeCounter = 0;
  const expandedMidiNotes = [];
  for (const [expandedChordPosition, expandedChordPositionInfo] of this._scoreData.expandedChordPositions.entries()) {
    const sectionId = expandedChordPositionInfo.sectionId;
    const sectionInfo = this._scoreData.sectionsById[sectionId];
    const chordPositionInfo = expandedChordPositionInfo.chordPositionInfo;
    expandedChordPositionInfo.midiStartTime = startTimeCounter;
    
    const createMidiNote = (referenceMidiNotes, meiNotes, startTime, duration) => {
      const referenceNoteVelocities = referenceMidiNotes.map(mn => mn.velocity);
      const averageVelocity = Math.round(referenceNoteVelocities.reduce((accumulator, v) => accumulator + v, 0) / referenceNoteVelocities.length);
      
      const channels = [];
      const allPartIds = Array.from(Object.keys(this._scoreData.partsById));
      for (const partId of meiNotes[0].partIds) {
        const channel = allPartIds.indexOf(partId) ?? 0;
        if (!channels.includes(channel)) channels.push(channel);
      }
      if (channels.length === 0) channels.push(0);
      return {
        startTime: startTime,
        endTime: startTime + duration,
        instrument: channels[0],
        program: 0,
        isDrum: false,
        pitch: meiNotes[0].pitch,
        velocity: averageVelocity,
        channels: channels,
        meiNotes: meiNotes,
      }
    }
    
    const notesAndRests = expandedChordPositionInfo.chordPositionInfo.notesAndRests;
    const chordPosition = expandedChordPositionInfo.chordPositionInfo.chordPosition;
    for (const note of notesAndRests) {
      // Skip notes on staves that don't apply to the current verse.
      // Example: "I Am a Child of God" (1989 Children’s Songbook), staff 1 (descant) should only be used with verse 3.
      if (!expandedChordPositionInfo.staffNumbers.includes(note.staffNumber)) continue;
      
      // Skip notes with a dash for lyrics in the current verse
      // Examples: "The Morning Breaks" (1985 Hymns, 1); "For All the Saints" (1985 Hymns, 82); "Oh, Come, All Ye Faithful" (1985 Hymns, 202); "Carry On" (1985 Hymns, 255)
      if (expandedChordPositionInfo.lyricIsSkipSymbol) continue;
      
      // Skip silent notes and rests
      // Examples: Tied notes in chorus of "It Is Well with My Soul"; mid-verse rests in "The Morning Breaks" (1985 Hymns) and "True to the Faith" (1985 Hymns)
      if (!note.isAudible) continue;
      
      // TODO: If multiple notes have the same pitch, align based on duration and pitch. Example: "hand," at the end of True to the Faith (1985 Hymns), there's a quarter note and half note with the same pitch. This causes an issue when animating the notes (both notes are held for the longer duration). Potential issue to figure out: MIDI notes generated by a MIDI keyboard aren't always an exact length (could be a fermata, or the pianist wasn't exact about when they lifted their finger).
      if (!Object.hasOwn(chordPositionInfo.midiNotesByPitch, note.pitch)) {
        console.warn(`Warning: Failed to align note #${note.elementId}`);
        continue;
      }
              
      const referenceMidiNotes = chordPositionInfo.midiNotesByPitch[note.pitch].filter(mn => mn.expandedChordPosition === expandedChordPosition || mn.expandedChordPosition == null);
      const referenceDuration = Math.max(...referenceMidiNotes.map(mn => mn.endTime - mn.startTime));
      
      // Check if note has tied note with lyrics
      if (note.tiedNoteId != null) {
        const tiedNote = this._scoreData.notesAndRestsById[note.tiedNoteId];
        const tiedExpandedChordPositions = this._scoreData.chordPositions[tiedNote.chordPosition].expandedChordPositions;
        // Ignore tied notes from other verses. Example: "I Know That My Savior Loves Me" (HHC), verse 2, has a tied note that goes into the first ending
        if (!Object.hasOwn(tiedExpandedChordPositions, sectionId)) continue;
        const tiedExpandedChordPosition = tiedExpandedChordPositions[sectionId][0];
        const tiedExpandedChordPositionInfo = this._scoreData.expandedChordPositions[tiedExpandedChordPosition];
        if (tiedExpandedChordPositionInfo) {
          // TODO: In the chorus of "It Is Well with My Soul", the tied note's expanded chord position has lyrics, causing the tied note to play as a separate MIDI note. Checking if the note itself has lyrics (tiedNote.lyricSyllables.length > 0) instead of the expanded chord position would fix this, but it breaks other cases, such as at the beginning of verse 5 of "The Morning Breaks." This is because in "The Morning Breaks," the lyrics are sung in all verses, but are only attached to the chord in the top staff. This could be resolved if there were a way to attach the lyrics to all the notes that are sung, instead of just the note/chord the MEI <verse> element is attached to.
          if (tiedExpandedChordPositionInfo.lyricSyllables.length > 0 && !tiedExpandedChordPositionInfo.lyricIsSkipSymbol) {
            // Create two MIDI notes with two MEI notes
            const shortenedMidiNote = createMidiNote(referenceMidiNotes, [note], startTimeCounter, referenceDuration - tiedExpandedChordPositionInfo.chordPositionInfo.midiDuration);
            expandedChordPositionInfo.midiNotes.push(shortenedMidiNote);
            if (!note.expandedChordPositions.includes(expandedChordPosition)) note.expandedChordPositions.push(expandedChordPosition);
            const tiedMidiNote = createMidiNote(referenceMidiNotes, [tiedNote], startTimeCounter + chordPositionInfo.midiDuration, referenceDuration - chordPositionInfo.midiDuration);
            tiedExpandedChordPositionInfo.midiNotes.push(tiedMidiNote);
            if (!tiedNote.expandedChordPositions.includes(tiedExpandedChordPosition)) tiedNote.expandedChordPositions.push(tiedExpandedChordPosition);
          } else {
            // Create one MIDI note with two MEI notes
            const newMidiNote = createMidiNote(referenceMidiNotes, [note, tiedNote], startTimeCounter, referenceDuration);
            expandedChordPositionInfo.midiNotes.push(newMidiNote);
            if (!note.expandedChordPositions.includes(expandedChordPosition)) note.expandedChordPositions.push(expandedChordPosition);
          }
        }
      } else {
        // Create one MIDI note with one MEI note
        const newMidiNote = createMidiNote(referenceMidiNotes, [note], startTimeCounter, referenceDuration);
        expandedChordPositionInfo.midiNotes.push(newMidiNote);
        if (!note.expandedChordPositions.includes(expandedChordPosition)) note.expandedChordPositions.push(expandedChordPosition);
      }
    }
    
    expandedMidiNotes.push(...expandedChordPositionInfo.midiNotes);
    const pauseAfter = (expandedChordPosition === sectionInfo.expandedChordPositionEnd && sectionInfo.pauseAfter) ? 0.25 : 0;
    startTimeCounter += chordPositionInfo.midiDuration + pauseAfter;
    expandedChordPositionInfo.midiEndTime = startTimeCounter;
  }
  midiNoteSequence.notes = expandedMidiNotes;
  midiNoteSequence.totalTime = startTimeCounter;
  
  
  // Convert MIDI QPM (quarter notes per minute) to metronome BPM
  function convertQpmToMetronomeBpm(qpm, timeSignatureArray) {
    let metronomeBpm = qpm;
    const timeSignature = timeSignatureArray.join('/');
    
    // Convert MIDI BPM to metronome BPM based on the time signature
    if (['1/1', '2/1', '3/1', '4/1', '5/1'].includes(timeSignature)) {
      // Simple meter (beat every whole note)
      metronomeBpm = qpm / 4;
    } else if (['1/2', '2/2', '3/2', '4/2', '5/2'].includes(timeSignature)) {
      // Simple meter (beat every half note)
      metronomeBpm = qpm / 2;
    } else if (['1/4', '2/4', '3/4', '4/4', '5/4'].includes(timeSignature)) {
      // Simple meter (beat every quarter note)
      metronomeBpm = qpm * 1;
    } else if (['1/8', '2/8', '3/8', '4/8', '5/8', '7/8', '8/8', '10/8', '11/8', '13/8', '14/8', '15/8'].includes(timeSignature)) {
      // Simple meter (beat every eighth note)
      metronomeBpm = qpm * 2;
    } else if (['1/16', '2/16', '3/16', '4/16', '5/16', '7/16', '8/16', '10/16', '11/16', '13/16', '14/16', '15/16'].includes(timeSignature)) {
      // Simple meter (beat every sixteenth note)
      metronomeBpm = qpm * 4;
    } else if (['6/2', '9/2', '12/2', '15/2', '18/2', '21/2', '24/2'].includes(timeSignature)) {
      // Compound meter (beat every 3 half notes)
      metronomeBpm = qpm / 2 / 3;
    } else if (['6/4', '9/4', '12/4', '15/4', '18/4', '21/4', '24/4'].includes(timeSignature)) {
      // Compound meter (beat every 3 quarter notes)
      metronomeBpm = qpm * 1 / 3;
    } else if (['6/8', '9/8', '12/8', '15/8', '18/8', '21/8', '24/8'].includes(timeSignature)) {
      // Compound meter (beat every 3 eighth notes)
      metronomeBpm = qpm * 2 / 3;
    } else if (['6/16', '9/16', '12/16', '15/16', '18/16', '21/16', '24/16'].includes(timeSignature)) {
      // Compound meter (beat every 3 sixteenth notes)
      metronomeBpm = qpm * 4 / 3;
    } else {
      // Beat every quarter note
      metronomeBpm = qpm;
    }
    
    return metronomeBpm;
  }
  
  this._scoreData.metronomeBeats = [];
  let beatNumber;
  let startQ = this._scoreData.expandedChordPositions[0].startQ;
  const totalQ = this._scoreData.expandedChordPositions.at(-1).endQ;
  while (startQ < totalQ) {
    const expandedChordPositionInfo = this._binaryFind(this._scoreData.expandedChordPositions, startQ, { key: 'startQ', findType: 'last-lte' });
    const chordPositionInfo = expandedChordPositionInfo.chordPositionInfo;
    const quartersPerMinute = chordPositionInfo.midiQpm;
    const measureInfo = this._scoreData.measuresById[chordPositionInfo.measureId];
    const timeSignature = measureInfo.timeSignature;
    const beatsPerMinute = convertQpmToMetronomeBpm(quartersPerMinute, timeSignature);
    const durationQToNextBeat = quartersPerMinute / beatsPerMinute;
    
    // Handle pickup measures that start mid-beat (example: It Is Well with My Soul)
    if (measureInfo.measureType === 'partial-pickup' && measureInfo.durationQ % durationQToNextBeat !== 0) {
      startQ += measureInfo.durationQ;
      continue;
    }
    
    let isDownbeat;
    let startSeconds;
    let beatStartQ;
    const startQDifference = startQ - expandedChordPositionInfo.startQ;
    if (startQDifference < 0.005) {
      isDownbeat = chordPositionInfo.isDownbeat;
      startSeconds = expandedChordPositionInfo.midiStartTime;
      beatStartQ = expandedChordPositionInfo.startQ;
    } else {
      startSeconds = expandedChordPositionInfo.midiStartTime + this._getMidiDuration(startQDifference, quartersPerMinute);
      beatStartQ = expandedChordPositionInfo.startQ + startQDifference;
    }
    
    if (isDownbeat) {
      beatNumber = 1;
    }
    this._scoreData.metronomeBeats.push({
      startQ: beatStartQ,
      isDownbeat: isDownbeat ?? false,
      beatNumber: beatNumber,
      midiBpm: Math.round(beatsPerMinute),
      midiStartTime: startSeconds,
    });
    
    startQ += durationQToNextBeat;
    if (beatNumber) beatNumber += 1;
  }
  
  // Fill in missing beat numbers for pickup measure
  // TODO: As Bread Is Broken doesn't have correct beat numbers, and introduction chord positions are wrong
  if (!this._scoreData.metronomeBeats[0].beatNumber) {
    let numBeatsWithoutBeatNumbers = 0;
    let previousBeatNumber;
    for (const beat of this._scoreData.metronomeBeats) {
      if (!beat.beatNumber) {
        numBeatsWithoutBeatNumbers += 1;
      } else if (beat.beatNumber === 1 && previousBeatNumber >= beat.beatNumber) {
        break;
      }
      previousBeatNumber = beat.beatNumber;
    }
    for (let b = numBeatsWithoutBeatNumbers - 1; b >= 0; b--) {
      this._scoreData.metronomeBeats[b].beatNumber = previousBeatNumber;
      previousBeatNumber -= 1;
    }
  }
  
  // Save changes to MIDI note sequence
  this._scoreData.midiNoteSequence = midiNoteSequence;
  
  // TODO: Download MIDI
//     function createMidiDownloadLink(noteSequence) {
//       noteSequence.notes = noteSequence.notes.filter(note => note.startTime >= 0);
//       const midiByteArray = core.sequenceProtoToMidi(noteSequence);
//       const midiBlob = new Blob([midiByteArray], { type: 'audio/midi' });
//       const midiUrl = URL.createObjectURL(midiBlob);
//       const downloadLink = document.createElement('a');
//       downloadLink.innerHTML = 'Download MIDI';
//       downloadLink.download = 'file.midi';
//       downloadLink.href = midiUrl;
//       document.body.append(downloadLink);
//     }
//     createMidiDownloadLink(this._scoreData.midiNoteSequence);
  
  console.info('MIDI ready');
}

ChScore.prototype._parseAndAnnotateMei = function () {
  this._scoreData.meiParsed = (new DOMParser()).parseFromString(this._scoreData.meiStringOriginal, 'text/xml');
  
  // Replace page breaks with system breaks
  // When printing, Verovio page height options are set so that each system is drawn as a separate SVG element. This allows the sheet music to flow between pages more cleanly. However, when Verovio is set to respect encoded page and system breaks, page height options are ignored. Replacing page breaks with system breaks allows the page height options for printing to work as expected.
  const pageBreaks = this._scoreData.meiParsed.querySelectorAll('pb');
  for (const pageBreak of pageBreaks) {
    const systemBreak = document.createElementNS('http://www.music-encoding.org/ns/mei', 'sb');
    Array.from(pageBreak.attributes).forEach(attribute => systemBreak.setAttribute(attribute.name, attribute.value));
    pageBreak.parentNode.replaceChild(systemBreak, pageBreak);
  }
  
  // Normalize layers (layers in each staff should be numbered starting at 1). Layer numbers are used when calculating which part a note belongs to. Example of a song that needs normalization: "Our Hearts Are Turning" (SingPraises.net Collection) (MusicXML exported from MuseScore; the second staff has layer numbers 5 and 6).
  const hasSuspiciousLayerNumbers = this._scoreData.meiParsed.querySelector('layer:not([n="1"], [n="2"])');
  if (hasSuspiciousLayerNumbers) {
    for (const staff of this._scoreData.meiParsed.querySelectorAll('staffDef')) {
      const staffNumber = parseInt(staff.getAttribute('n'));
      const layersByNumber = {}
      for (const layer of this._scoreData.meiParsed.querySelectorAll(`staff[n="${staffNumber}"] layer`)) {
        const layerNumber = parseInt(layer.getAttribute('n'));
        if (!Object.hasOwn(layersByNumber, layerNumber)) layersByNumber[layerNumber] = [];
        layersByNumber[layerNumber].push(layer);
      }
      const staffLayerNumbers = Object.keys(layersByNumber).sort();
      for (let sn = 0; sn < staffLayerNumbers.length; sn++) {
        if (staffLayerNumbers[sn] !== sn + 1) {
          for (const layer of layersByNumber[staffLayerNumbers[sn]]) layer.setAttribute('n', sn + 1);
        }
      }
    }
  }
  
  // Get tied notes (tied notes are combined to a single note in MIDI)
  const tiedNotes = {}
  for (const tie of this._scoreData.meiParsed.querySelectorAll('tie')) {
    const startNoteId = (tie.getAttribute('startid') ?? '').substring(1);
    const endNoteId = (tie.getAttribute('endid') ?? '').substring(1);
    if (startNoteId && endNoteId) tiedNotes[startNoteId] = endNoteId;
  }
  
  // Change cue notes to regular notes so they appear at regular size
  for (const meiElement of this._scoreData.meiParsed.querySelectorAll('[cue="true"]')) meiElement.removeAttribute('cue');
  
  // Gather information about each note and rest
  this._scoreData.notesAndRestsById = {}
  const notesAndRests = this._scoreData.meiParsed.querySelectorAll('note, rest');
  for (const meiElement of notesAndRests) {        
    const elementId = meiElement.getAttribute('xml:id');
    const meiChordElement = meiElement.closest('chord') ?? null;
    const meiBeamElement = meiElement.closest('beam') ?? null;
    const meiLayerElement = meiElement.closest('layer');
    const meiStaffElement = meiElement.closest('staff');
    const meiMeasureElement = meiElement.closest('measure');
    const isTiedNote = Object.values(tiedNotes).includes(elementId);
    const isRest = meiElement.tagName.toLowerCase() === 'rest';
    const isCue = meiElement.getAttribute('cue') === 'true';
    // TODO: This only gets lyric text attached to the current note (or note chord) in the MEI; but the same lyrics might be sung on other simultaneous notes (such as the TB notes in an SATB chord). Lyrics on those notes aren't currently handled.
    const lyricSyllableElements = (meiChordElement ?? meiElement).querySelectorAll('syl') ?? [];
    const lyricSyllables = Array.from(lyricSyllableElements).map(syl => syl.textContent);
    
    this._scoreData.notesAndRestsById[elementId] = {
      elementId: elementId,
      meiElement: meiElement,
      meiChordElement: meiChordElement,
      meiBeamElement: meiBeamElement,
      meiMeasureElement: meiMeasureElement,
      pitch: this._vrvToolkit.getMIDIValuesForElement(elementId).pitch,
      lyricSyllables: lyricSyllables,
      staffNumber: parseInt(meiStaffElement.getAttribute('n')),
      layerNumber: parseInt(meiLayerElement.getAttribute('n')),
      tiedNoteId: tiedNotes[elementId] ?? null,
      isTiedNote: isTiedNote,
      isRest: isRest,
      isCue: isCue,
      isGrace: meiElement.getAttribute('grace') != null,
      isAudible: !(isRest || isCue || isTiedNote),
      partIds: [], // Added later
      expandedChordPositions: [], // Added later
      isMelody: null, // Added later
      startQ: null, // Added later. Q = time in quarter notes.
      endQ: null, // Added later
      durationQ: null, // Added later
      chordPosition: null, // Added later
    }
  }
  
  // Get measure info
  this._scoreData.measures = []
  this._scoreData.measuresById = {}
  let systemCounter = 0;
  let ticksPerQuarter = 0;
  let timeSignature = [0, 0];
  const numMeasures = this._scoreData.meiParsed.querySelectorAll('measure').length;
  for (const element of this._scoreData.meiParsed.querySelectorAll('scoreDef, staffDef, meterSig, sb, measure')) {
    if (element.tagName === 'measure') {
      const measure = element;
      const measureId = measure.getAttribute('xml:id');
      this._scoreData.measuresById[measureId] = {
        measureId: measureId,
        measureType: null, // Added later (after durationQ is known)
        timeSignature: timeSignature,
        isFirstMeasure: (this._scoreData.measures.length === 0),
        isLastMeasure: (this._scoreData.measures.length === numMeasures - 1),
        rightBarLine: measure.getAttribute('right') ?? 'single',
        systemNumber: systemCounter,
        startQ: null, // Added later
        endQ: null, // Added later
        durationQ: null, // Added later
        firstChordPosition: null, // Added later
      }
      this._scoreData.measures.push(this._scoreData.measuresById[measureId]);
    } else if (element.tagName === 'sb') {
      systemCounter += 1;
    } else {
      // Time signature change
      timeSignature[0] = parseInt(element.getAttribute('count') ?? element.getAttribute('meter.count') ?? timeSignature[0]);
      timeSignature[1] = parseInt(element.getAttribute('unit') ?? element.getAttribute('meter.unit') ?? timeSignature[1]);
    }
  }
  
  // Get measure type: full, partial-pickup, partial-pickdown, partial-start, partial-end
  function getMeasureType(measureInfo) {
    const completeDurationQ = measureInfo.timeSignature[0] * (4 / measureInfo.timeSignature[1]);
    let measureType = 'full';
    if (measureInfo.durationQ != completeDurationQ) {
      if (measureInfo.isFirstMeasure) {
        measureType = 'partial-pickup';
      } else if (measureInfo.isLastMeasure) {
        measureType = 'partial-pickdown';
      } else if (measureInfo.rightBarLine === 'invis') {
        measureType = 'partial-start';
      } else {
        measureType = 'partial-end';
      }
    }
    return measureType;
  }
      
  function getStaffPartIds(staffNumber, chordPosition, parts) {
    const partIdsDict = { 1: [], 2: [], 3: [], 4: [] };
    const fullPartIds = [];
    const melodyPartIds = [];
    let autoPlacementCounter = 1;
    
    for (const part of parts) {
      const partId = part.partId;
      let chordPositionRefInfo = null;
      const reversedChordPositions = Object.keys(part.chordPositionRefs).slice().reverse();
      for (const previousChordPosition of reversedChordPositions) {
        if (previousChordPosition <= chordPosition) {
          chordPositionRefInfo = part.chordPositionRefs[previousChordPosition];
          break;
        }
      }
      if (!chordPositionRefInfo || !chordPositionRefInfo.staffNumbers.includes(staffNumber)) {
        continue;
      }
      
      if ([1, 2, 3, 4].includes(part.placement)) {
        partIdsDict[part.placement].push(partId);
      } else if (part.placement === 'full') {
        fullPartIds.push(partId);
      } else if (part.placement === 'auto') {
        if (['instrumental', 'accompaniment'].includes(partId)) {
          fullPartIds.push(partId);
        } else {
          partIdsDict[autoPlacementCounter].push(partId);
          autoPlacementCounter += 1;
        }
      }        
      if (chordPositionRefInfo.isMelody) melodyPartIds.push(partId);
    }
    
    for (const fullPartId of fullPartIds) {
      for (const key in partIdsDict) partIdsDict[key].push(fullPartId);
    }
    
    // Convert part IDs dict to a list of lists, and remove empty lists at the end
    let partIds = Object.values(partIdsDict);
    while (partIds.length > 1 && partIds[partIds.length - 1].length === 0) partIds.pop();      
    return [partIds, melodyPartIds];
  }
  
  const vrvTimemap = this._vrvToolkit.renderToTimemap({ includeRests: true, includeMeasures: true, });
  this._scoreData.staffNumbers = Array.from(this._scoreData.meiParsed.querySelectorAll('staffDef')).map(sf => parseInt(sf.getAttribute('n')));
  this._scoreData.hasLyrics = this._scoreData.meiParsed.querySelector('verse') !== null;
  this._scoreData.numChordPositions = vrvTimemap.filter(entry => (entry.on ?? entry.restsOn ?? []).length > 0).length;
  this._normalizeParts();
  
  // Get chord position, note, rest, and measure info from Verovio timemap
  // Add attributes to chords, notes, and rests: @ch-chord-position, @ch-part-id, @ch-melody
  // Verovio timemap should include regular notes, tied notes, cue notes, and rests (may also include grace notes – need to test)
  this._scoreData.chordPositions = []
  this._scoreData.audibleChordPositions = [];
  let chordPositionCounter = 0;
  let previousSectionElement;
  let previousMeasureInfo;
  let previousChordPositionInfo;
  for (const entry of vrvTimemap) {
    const onIds = (entry.on ?? []).concat(entry.restsOn ?? []);
    const offIds = (entry.off ?? []).concat(entry.restsOff ?? []);
    if (entry.measureOn) {
      this._scoreData.measuresById[entry.measureOn].startQ = entry.qstamp;
      // Only set chord position if measure has notes. Empty measure example: last measure in "We Welcome You" (1989 CSB)
      if (onIds.length > 0) this._scoreData.measuresById[entry.measureOn].firstChordPosition = chordPositionCounter;
      previousSectionElement = this._scoreData.meiParsed.querySelector(`[*|id="${entry.measureOn}"]`).closest('section, ending');
      if (!previousSectionElement.hasAttribute('ch-chord-position')) previousSectionElement.setAttribute('ch-chord-position', '')
      if (previousMeasureInfo) {
        previousMeasureInfo.endQ = entry.qstamp;
        previousMeasureInfo.durationQ = previousMeasureInfo.endQ - previousMeasureInfo.startQ;
        previousMeasureInfo.measureType = getMeasureType(previousMeasureInfo);
        this._scoreData.chordPositions[previousMeasureInfo.firstChordPosition].isDownbeat = !['partial-end', 'partial-pickup'].includes(previousMeasureInfo.measureType);
      }
      previousMeasureInfo = this._scoreData.measuresById[entry.measureOn];
    }
    if (onIds.length > 0) {
      const notesAndRests = [];
      let chordPositionIsAudible = false;
      previousSectionElement.setAttribute('ch-chord-position', previousSectionElement.getAttribute('ch-chord-position') + ` ${chordPositionCounter}`);
      for (const elementId of onIds) {
        const elementInfo = this._scoreData.notesAndRestsById[elementId];
        if (!elementInfo) continue;
        elementInfo.chordPosition = chordPositionCounter;
        elementInfo.startQ = entry.qstamp;
        elementInfo.meiElement.setAttribute('ch-chord-position', elementInfo.chordPosition);
        if (elementInfo.meiChordElement) {
          elementInfo.meiChordElement.setAttribute('ch-chord-position', elementInfo.chordPosition);
        }
        if (elementInfo.isAudible) chordPositionIsAudible = true;
        notesAndRests.push(elementInfo);
      }
      
      // Sort notes to make aligning with MIDI notes easier
      notesAndRests.sort((a, b) => a.pitch - b.pitch
        || (a.durationQ + (a.tiedNoteId ? this._scoreData.notesAndRestsById[a.tiedNoteId].durationQ : 0)) - (b.durationQ + (b.tiedNoteId ? this._scoreData.notesAndRestsById[b.tiedNoteId].durationQ : 0))
      );
      
      // Assign notes to parts
      // Order of notes is reversed to align with parts, which are sorted highest to lowest
      let melodyNote = null;
      const numNotesByChord = {};
      for (const note of notesAndRests.slice().reverse()) {
        let foundMelodyNote = false;
        let positionInChord = null;
        const layerNumber = parseInt(note.meiElement.closest('layer').getAttribute('n'));
        const staffNumber = note.staffNumber;
        
        if (note.meiChordElement) {
          const chordId = note.meiChordElement.getAttribute('xml:id');
          if (!(chordId in numNotesByChord)) {
            numNotesByChord[chordId] = 0;
          }
          positionInChord = numNotesByChord[chordId];
          numNotesByChord[chordId] += 1;
        }
        
        // Calculate staff part index
        // TODO: This doesn't work correctly when a lower part temporarily goes above the upper part. Example: last few Tenor 2 notes in "High On the Mountain Top" (Men's Choir, 1985 Hymns #333).
        // TODO: Logic will fail if there are more than two layers on the staff. However, three or four parts can be on a staff if they're chorded and placed into a maximum of two layers. Example: "Love at Home" (Women, 1985 Hymns #318).
        let staffPartIndex;
        if (layerNumber % 2 !== 0) {
          // Odd layer (stems up) – staff part index should be positive
          staffPartIndex = positionInChord || 0;
        } else {
          // Even layer (stems down) – staff part index should be negative
          if (note.meiChordElement) {
            const numNotesInChord = note.meiChordElement.querySelectorAll('note').length;
            staffPartIndex = positionInChord - numNotesInChord;
          } else {
            staffPartIndex = -1;
          }
        }
        
        const [staffPartIds, melodyPartIds] = getStaffPartIds(staffNumber, chordPositionCounter, this._scoreData.parts);
        note.partIds = staffPartIds.length > Math.abs(staffPartIndex) ? staffPartIds.at(staffPartIndex) : [];
        note.meiElement.setAttribute('ch-part-id', note.partIds.join(' '));
        
        if (melodyPartIds.length && note.partIds.some(partId => melodyPartIds.includes(partId)) && !foundMelodyNote) {
          note.meiElement.setAttribute('ch-melody', '');
          note.isMelody = true;
          melodyNote = note;
          foundMelodyNote = true;
        } else {
          note.isMelody = false;
        }
      }
      
      if (chordPositionIsAudible) this._scoreData.audibleChordPositions.push(chordPositionCounter);
      const chordPositionInfo = {
        chordPosition: chordPositionCounter,
        startQ: entry.qstamp,
        endQ: null, // Added later
        durationQ: null, // Added later
        measureId: previousMeasureInfo.measureId,
        notesAndRests: notesAndRests,
        melodyNote: melodyNote,
        isAudible: chordPositionIsAudible,
        isDownbeat: false, // Added later
        midiQpm: null, // Added later
        midiNotesByPitch: {}, // Added later
        midiStartTime: null, // Added later
        midiEndTime: null, // Added later
        midiDuration: null, // Added later
        expandedChordPositions: {}, // Added later
        isSingleLine: null, // Added later
      }
      this._scoreData.chordPositions.push(chordPositionInfo);
      if (previousChordPositionInfo) {
        previousChordPositionInfo.endQ = entry.qstamp;
        previousChordPositionInfo.durationQ = previousChordPositionInfo.endQ - previousChordPositionInfo.startQ;
      }
      previousChordPositionInfo = chordPositionInfo;
      chordPositionCounter += 1;
    }
    for (const elementId of offIds) {
      const elementInfo = this._scoreData.notesAndRestsById[elementId];
      if (!elementInfo) continue;
      elementInfo.endQ = entry.qstamp;
      elementInfo.durationQ = elementInfo.endQ - elementInfo.startQ;
    }
  }
  previousMeasureInfo.endQ = vrvTimemap.at(-1).qstamp;
  previousMeasureInfo.durationQ = previousMeasureInfo.endQ - previousMeasureInfo.startQ;
  previousMeasureInfo.measureType = getMeasureType(previousMeasureInfo);
  if (previousMeasureInfo.firstChordPosition != null) { // Will be null if the measure is empty
    this._scoreData.chordPositions[previousMeasureInfo.firstChordPosition].isDownbeat = !['partial-end', 'partial-pickup'].includes(previousMeasureInfo.measureType);
  }
  previousChordPositionInfo.endQ = vrvTimemap.at(-1).qstamp;
  previousChordPositionInfo.durationQ = previousChordPositionInfo.endQ - previousChordPositionInfo.startQ;
  
  // Add attributes to verse elements: @ch-lyric-line-id, @ch-secondary
  for (const verse of this._scoreData.meiParsed.querySelectorAll('verse')) {
    if (verse.textContent.trim() === '') {
      // Remove empty verse elements
      verse.remove();
      continue;
    }
    const staffNumber = verse.closest('staff').getAttribute('n');
    const lineNumber = verse.getAttribute('n');
    verse.setAttribute('ch-lyric-line-id', `${staffNumber}.${lineNumber}`);
    // Mark secondary lyrics (examples: "It Is Well with My Soul"; "Were You There?")
    const parentNoteOrChord = verse.closest('[ch-chord-position]');
    if (!parentNoteOrChord.hasAttribute('ch-melody') && !parentNoteOrChord.querySelector('[ch-melody]')) {
      verse.setAttribute('ch-secondary', '');
    }
  }
      
  // Improve appearance of dir elements
  // Add attributes to intro brackets: @ch-intro-bracket
  // Add attributes to dir, harm, and fermata: @ch-chord-position
  let currentMeasureId = null;
  const chordPositionQstamps = this._scoreData.chordPositions.map(cpInfo => cpInfo.startQ).concat([this._scoreData.chordPositions.at(-1).endQ]);
  for (const element of this._scoreData.meiParsed.querySelectorAll('measure, dir, harm, fermata')) {
    if (element.tagName === 'measure') {
      currentMeasureId = element.getAttribute('xml:id');
    } else {
      let qstamp;
      let chordPosition;
      const tstamp = parseFloat(element.getAttribute('tstamp'));
      const startid = element.getAttribute('startid')?.substring(1);
      const measureInfo = this._scoreData.measuresById[currentMeasureId];
      if (tstamp) {
        // Convert tstamp (1-based position in time signature denominator notes, relative to measure) to qstamp (0-based position in quarter notes, relative to song)
        const quartersPerBeat = 4 / measureInfo.timeSignature[1];
        qstamp = Math.min(measureInfo.endQ, measureInfo.startQ + ((tstamp - 1) * quartersPerBeat));
        chordPosition = this._bisectLeft(chordPositionQstamps, qstamp);
      } else if (startid) {
        const refNote = this._scoreData.meiParsed.querySelector(`[*|id="${startid}"]`);
        chordPosition = parseInt(refNote.getAttribute('ch-chord-position'));
        qstamp = this._scoreData.chordPositions[chordPosition].startQ;
      }
      
      // Set chord position
      element.setAttribute('ch-chord-position', chordPosition);
      
      // Clean up formatted text
      for (const rend of element.querySelectorAll('rend')) {
        const rendText = rend.textContent.trim();
        rend.removeAttribute('fontfam');
        if (rendText === '𝄌') { // Improve appearance of coda symbol
          rend.setAttribute('fontstyle', 'normal');
          rend.setAttribute('glyph.auth', 'smufl');
        }
      }
      
      // Mark intro brackets
      const elementText = element.textContent.trim();
      if (elementText === '⌜') {
        element.setAttribute('ch-intro-bracket', 'start');
      } else if (elementText === '⌝') {
        element.setAttribute('ch-intro-bracket', 'end');
      }          
      
      // If qstamp is at the end of the measure, right-align it to prevent it from sticking out too far
      // See https://github.com/rism-digital/verovio/issues/4239
      if (qstamp === measureInfo.endQ) {
        const halignRend = this._scoreData.meiParsed.createElement('rend');
        halignRend.setAttribute('halign', 'right');
        while (element.firstChild) halignRend.appendChild(element.firstChild);
        element.appendChild(halignRend);
      }
      
    }
  }
  
  this._scoreData.hasPartInfo = this._scoreData.meiParsed.querySelector('[ch-part-id]') !== null;
  this._scoreData.hasMelodyInfo = this._scoreData.meiParsed.querySelector('[ch-melody]') !== null;
  this._scoreData.hasExpansion = this._scoreData.meiParsed.querySelector('expansion[plist]') != null;
  this._normalizeSections(); // After parts and intro brackets are available
  this._normalizeChordSets(); // After <harm> elements have chord positions
  
  // Get key signature info
  // On scores converted from MXL, use <keySig> attributes (sig, pname, accid, mode)
  // On scores converted from ABC, use <scoreDef> attributes (key.sig, key.pname, key.accid, key.mode)
  const keySignatureElement = this._scoreData.meiParsed.querySelector('keySig');
  const scoreDefElement = this._scoreData.meiParsed.querySelector('scoreDef');
  const meiSig = keySignatureElement?.getAttribute('sig') ?? scoreDefElement?.getAttribute('key.sig') ?? null;
  const meiPname = keySignatureElement?.getAttribute('pname') ?? scoreDefElement?.getAttribute('key.pname') ?? null;
  const meiAccid = keySignatureElement?.getAttribute('accid') ?? scoreDefElement?.getAttribute('key.accid') ?? null;
  const meiPnameAccid = meiPname ? (meiPname + (['f', 's'].includes(meiAccid) ? meiAccid : '')) : null;
  const tonality = keySignatureElement?.getAttribute('mode') ?? scoreDefElement?.getAttribute('key.mode') ?? 'major';
  const keySignatures = this._getKeySignatures(tonality);
  const [defaultKeySignatureId, defaultKeySignatureInfo] = Object.entries(keySignatures).find(ks => (ks[1].meiSig === meiSig || ks[1].meiPnameAccid === meiPnameAccid));
  
  // Get nearby key signatures
  const nearbyKeySignatureIds = Object.keys(keySignatures);
  const midpointIndex = (nearbyKeySignatureIds.length - 1) / 2;
  const keyIndex = nearbyKeySignatureIds.indexOf(defaultKeySignatureId);
  if (keyIndex < midpointIndex) {
    const itemsToMove = nearbyKeySignatureIds.splice(keyIndex - midpointIndex);
    nearbyKeySignatureIds.unshift(...itemsToMove);
  } else if (keyIndex > midpointIndex) {
    const itemsToMove = nearbyKeySignatureIds.splice(0, keyIndex - midpointIndex);
    nearbyKeySignatureIds.push(...itemsToMove);
  }
  const nearbyKeySignatures = [];
  for (let nk = 0; nk < nearbyKeySignatureIds.length; nk++) {
    const keySignatureId = nearbyKeySignatureIds[nk];
    const keySignatureInfo = keySignatures[keySignatureId];
    let midiPitchOffset = keySignatureInfo.midiPitch - defaultKeySignatureInfo.midiPitch;
    if (nk > 7 && midiPitchOffset < 0) {
      midiPitchOffset += 12;
    } else if (nk < 7 && midiPitchOffset > 0) {
      midiPitchOffset -= 12;
    }
    nearbyKeySignatures.push({
      keySignatureId: keySignatureId,
      midiPitchOffset: midiPitchOffset,
      ...keySignatureInfo,
    });
  }
  this._scoreData.keySignatureInfo = {
    keySignatureId: defaultKeySignatureId,
    nearbyKeySignatures: nearbyKeySignatures,
    ...defaultKeySignatureInfo,
  }
  
  // Get expanded chord positions (expand verses, repeats, codas, etc. based on score map)
  // Add attributes to verse elements: @ch-section-id, @ch-chorus
  this._scoreData.expandedChordPositions = [];
  this._scoreData.audibleExpandedChordPositions = [];
  let expandedChordPositionCounter = 0;
  let expandedChordPositionQStartCounter = 0;
  for (const sectionInfo of this._scoreData.sections) {
    for (const chordPositionRange of sectionInfo.chordPositionRanges) {
      if (!chordPositionRange.end) chordPositionRange.end = chordPositionCounter;
      const staffNumbers = chordPositionRange.staffNumbers ?? this._scoreData.staffNumbers;
      for (let chordPosition = chordPositionRange.start; chordPosition < chordPositionRange.end; chordPosition++) {
        if (!this._scoreData.chordPositions[chordPosition]) {
          continue;
        }
        
        const lyricSelectors = [];
        if (chordPositionRange.lyricLineIds) {
          for (const lyricLineId of chordPositionRange.lyricLineIds) {
            lyricSelectors.push(`[ch-chord-position="${chordPosition}"] verse[ch-lyric-line-id="${lyricLineId}"]`);
          }
        }
        
        const lyricLabels = [];
        const lyricSyllables = [];
        if (lyricSelectors.length > 0) {
          const lyricElements = this._scoreData.meiParsed.querySelectorAll(lyricSelectors.join(', '))
          for (const lyricElement of lyricElements) {
            // Add attribute: verse@ch-section-id
            const sectionIdsString = lyricElement.getAttribute('ch-section-id') ?? '';
            const newSectionIdsString = `${sectionIdsString} ${sectionInfo.sectionId}`.trim();
            lyricElement.setAttribute('ch-section-id', newSectionIdsString);
            
            // Add attribute: verse@ch-chorus
            if (sectionInfo.type === 'chorus' || lyricElement.getAttribute('label') === 'chorus') {
              lyricElement.setAttribute('ch-chorus', '');
              lyricElement.removeAttribute('label');
            }
            
            for (const label of lyricElement.querySelectorAll('label')) {
              const text = label.textContent.trim();
              if (text) lyricLabels.push(text);
            }
            for (const syl of lyricElement.querySelectorAll('syl')) {
              const text = syl.textContent.trim();
              if (text) lyricSyllables.push(text);
            }
          }
        }
        
        // Get expanded chord position info
        const expandedChordPositionInfo = {
          chordPositionInfo: this._scoreData.chordPositions[chordPosition],
          startQ: expandedChordPositionQStartCounter,
          endQ: expandedChordPositionQStartCounter + this._scoreData.chordPositions[chordPosition].durationQ,
          sectionId: sectionInfo.sectionId,
          staffNumbers: staffNumbers,
          lyricLabels: lyricLabels,
          lyricSyllables: lyricSyllables,
          lyricIsSkipSymbol: lyricSyllables.join() === '—',
          midiNotes: [], // Added later
          midiStartTime: null, // Added later
          midiEndTime: null, // Added later
        }
        this._scoreData.expandedChordPositions.push(expandedChordPositionInfo);
        if (this._scoreData.chordPositions[chordPosition].isAudible) {
          this._scoreData.audibleExpandedChordPositions.push(expandedChordPositionCounter);
        }
        
        // Add expanded chord position info to chord position info
        if (!this._scoreData.chordPositions[chordPosition].expandedChordPositions) {
          this._scoreData.chordPositions[chordPosition].expandedChordPositions = {};
        }
        if (!this._scoreData.chordPositions[chordPosition].expandedChordPositions[sectionInfo.sectionId]) {
          this._scoreData.chordPositions[chordPosition].expandedChordPositions[sectionInfo.sectionId] = [];
        }
        this._scoreData.chordPositions[chordPosition].expandedChordPositions[sectionInfo.sectionId].push(expandedChordPositionCounter);
        
        // Add expanded chord positions to section info
        if (sectionInfo.expandedChordPositionStart == null) {
          sectionInfo.expandedChordPositionStart = expandedChordPositionCounter;
        }
        sectionInfo.expandedChordPositionEnd = expandedChordPositionCounter;
        
        expandedChordPositionCounter += 1;
        expandedChordPositionQStartCounter += this._scoreData.chordPositions[chordPosition].durationQ;
      }
    }
  }
  
  // Improve appearance of secondary chorus lines (shift to line 2)
  // Example: "It Is Well with My Soul"
  for (const staffNumber of this._scoreData.staffNumbers) {
    const hasMultipleChorusLines = this._scoreData.meiParsed.querySelector(`staff[n="${staffNumber}"] [ch-chorus][n="2"]`);
    if (!hasMultipleChorusLines) {
      for (const lyricElement of this._scoreData.meiParsed.querySelectorAll(`staff[n="${staffNumber}"] [ch-chorus][ch-secondary]`)) {
        lyricElement.setAttribute('n', 2);
      }
    }
  }
  
  // Improve appearance of tempo and mood
  const tempoElements = this._scoreData.meiParsed.querySelectorAll('tempo');
  for (const tempoElement of tempoElements) {
    for (const tempoRend of tempoElement.querySelectorAll('rend')) {
      // Add space around SMuFL glyphs (tempo note)
      if (tempoRend.getAttribute('glyph.auth') === 'smufl') {
        tempoRend.insertAdjacentText('beforebegin', '\u00A0');
      // Normalize whitespace around mood (example: various songs in 1985 Hymns)
      } else if (tempoRend.getAttribute('xml:space') === 'preserve') {
        tempoRend.removeAttribute('xml:space');
        tempoRend.textContent = tempoRend.textContent.trim();
      }
    }
  }
  
  // Check for various features
  this._scoreData.hasIntroBrackets = this._scoreData.meiParsed.querySelector('[ch-intro-bracket]') !== null;
  this._scoreData.hasChordSets = this._scoreData.chordSets.length > 0;
  this._scoreData.hasFingeringMarks = this._scoreData.meiParsed.querySelector('fing') !== null;
  this._scoreData.hasLyricSectionIds = this._scoreData.meiParsed.querySelector('[ch-section-id]') !== null;
  
  // Normalize slurs by attaching them to chords when possible
  // This allows slurs to remain visible if notes are removed from the chord (such as when showing/hiding parts). This also makes the start and end points more precise (for example, in "The Morning Breaks" (1985 Hymns), without this change, the slur above "shadows" starts at the top of the note stem instead of close to the notehead).
  for (const slur of this._scoreData.meiParsed.querySelectorAll('slur')) {
    const measure = slur.parentElement;
    const startId = slur.getAttribute('startid').substring(1);
    const endId = slur.getAttribute('endid').substring(1);
    const startElement = measure.querySelector(`[*|id="${startId}"]`);
    const endElement = measure.querySelector(`[*|id="${endId}"]`);
    if (startElement && startElement.parentElement.tagName.toLowerCase() === 'chord') {
      slur.setAttribute('startid', '#' + startElement.parentElement.getAttribute('xml:id'));
    }
    if (endElement && endElement.parentElement.tagName.toLowerCase() === 'chord') {
      slur.setAttribute('endid', '#' + endElement.parentElement.getAttribute('xml:id'));
    }
  }
  
  // Remove unneeded elements and attributes
  for (const element of this._scoreData.meiParsed.querySelectorAll('staffGrp label, staffGrp labelAbbr, encodingDesc, workDesc, revisionDesc, pgHead, pgFoot, dir:has(lb)')) {
    element.remove();
  }
  const fileDesc = this._scoreData.meiParsed.querySelector('fileDesc');
  if (fileDesc) fileDesc.textContent = '';
  for (const element of this._scoreData.meiParsed.querySelectorAll('staffGrp[bar\\.thru]')) {
    element.removeAttribute('bar.thru');
  }
  for (const element of this._scoreData.meiParsed.querySelectorAll('[dur\\.ppq]')) {
    element.removeAttribute('dur.ppq');
  }
  
  // Save the complete MEI string
  this._scoreData.meiStringComplete = (new XMLSerializer()).serializeToString(this._scoreData.meiParsed);
  this._updateMei();
}

// Clean up and add metadata to MEI document based on rendering options
ChScore.prototype._updateMei = function () {
  this._scoreData.meiParsed = (new DOMParser()).parseFromString(this._scoreData.meiStringComplete, 'text/xml');
  
  // Set chord set visibility
  // Add attributes to chord symbols: @ch-superscript
  if (this._scoreData.hasChordSets) {
    const harms = this._scoreData.meiParsed.querySelectorAll('harm');
    for (const harm of harms) harm.remove();
    const chordSet = this._scoreData.chordSetsById[this._currentOptions.showChordSet];
    if (chordSet) {
      if (!chordSet.chordInfoList || chordSet.chordInfoList.length === 0) {
        chordSet.chordInfoList = [];
        for (const [chordPosition, chordInfo] of Object.entries(chordSet.chordPositionRefs)) {
          const note = this._scoreData.meiParsed.querySelector(`note[ch-chord-position="${chordPosition}"]`);
          if (!note) continue;
          const noteInfo = this._scoreData.notesAndRestsById[note.getAttribute('xml:id')];
          const measure = note.closest('measure');
          const measureInfo = this._scoreData.measuresById[measure.getAttribute('xml:id')];
          const noteTstamp = this._qstampToTstamp(noteInfo['startQ'], measureInfo['startQ'], measureInfo['timeSignature'][1]);
          chordInfo.measureId = measure.getAttribute('xml:id');
          chordInfo.tstamp = noteTstamp;
          chordInfo.chordPosition = chordPosition;
          chordSet.chordInfoList.push(chordInfo);
        }
      }
      for (const chordInfo of chordSet.chordInfoList) {
        const harm = document.createElement('harm');
        harm.setAttribute('staff', '1');
        let text = chordInfo.text ?? '';
        text = text.replaceAll(/♭|b/g, '\u200A<rend glyph.auth="smufl">♭</rend>\u200A');
        text = text.replaceAll(/♯|#/g, '\u200A<rend glyph.auth="smufl">♯</rend>\u200A');
        text = text.replace(/\d+/g, '<rend ch-superscript="">$&</rend>');
        if (chordInfo.prefix) text = chordInfo.prefix + ' ' + text;
        harm.innerHTML = text;
        harm.setAttribute('tstamp', chordInfo.tstamp);
        harm.setAttribute('ch-chord-position', chordInfo.chordPosition);
        this._scoreData.meiParsed.querySelector(`measure[*|id="${chordInfo.measureId}"]`).append(harm);
        // <harm> elements can be positioned using a note ID (commented line below) or tstamp. tstamp requires more calculation, but it remains stable when notes are hidden (for example, when showing the melody only).
        // harm.setAttribute('startid', '#' + note.getAttribute('xml:id'));
      }
    }
  }
  
  // Set fingering mark visibility
  if (this._scoreData.hasFingeringMarks && !this._currentOptions.showFingeringMarks) {
    for (const fingeringMark of this._scoreData.meiParsed.querySelectorAll('fing')) {
      fingeringMark.remove();
    }
  }
  
  // Set measure number visibility
  const scoreDef = this._scoreData.meiParsed.querySelector('scoreDef');
  scoreDef.setAttribute('mnum.visible', !!this._currentOptions.showMeasureNumbers);
  
  // Show melody only
  // Edge cases for testing: "I Am a Child of God" (1989 Children’s Songbook); "The Morning Breaks" (1985 Hymns)
  // TODO: Fix cases where the melody includes a part without lyrics attached. Known cases in 1985 Hymns: "The Lord Is My Shepherd" (#108, #316) (melody starts on Alto, then Soprano); "High on the Mountain Top" (#333) (melody starts on Tenor, then Bass); "I Need Thee Every Hour" (#334) (melody on Tenor 2); "Brightly Beams Our Father’s Mercy" (#335) (melody on Tenor 2); "School Thy Feelings" (#336) (melody starts on Tenor 2, then Tenor 1, then Tenor 2). For now, I marked the part with lyrics as the melody on those hymns.
  // TODO: Allow filtering to any part(s). Challenges: If layer/voice 1 in a staff is removed, the layer that remains may have empty spaces that need to be filled in with notes or rests copied from layer 1. Also, lyrics need to be attached to a part that remains visible.
  // See https://github.com/music-encoding/music-encoding/issues/1709
  if (this._currentOptions.showMelodyOnly && this._scoreData.hasMelodyInfo) {
    const deletedElementIds = [];
    // Remove non-melody notes and rests
    for (const element of this._scoreData.meiParsed.querySelectorAll(`note:not([ch-melody]), rest:not([ch-melody]), mRest`)) {
      deletedElementIds.push(element.getAttribute('xml:id'));
      element.remove();
    }
    // Move melody notes to a single staff and layer (preferring treble clef staff if any melody notes are on one)
    const trebleClefStaffNumbers = Array.from(this._scoreData.meiParsed.querySelectorAll('clef[shape="G"]')).map(cf => parseInt(cf.closest('staffDef').getAttribute('n')));
    const trebleClefStaffNumbersSelector = trebleClefStaffNumbers.map(sn => `[n="${sn}"]`).join(',');
    let melodyStaffNumber = this._scoreData.meiParsed.querySelector(`staff:is(${trebleClefStaffNumbersSelector}) [ch-melody]`)?.closest('staff')?.getAttribute('n') ?? null;
    for (const [chordPosition, chordPositionInfo] of this._scoreData.chordPositions.entries()) {
      if (!chordPositionInfo.melodyNote) continue;
      if (!melodyStaffNumber) melodyStaffNumber = chordPositionInfo.melodyNote.staffNumber;
      // Melody element may be a note, rest, or chord
      const melodyElement = this._scoreData.meiParsed.querySelector(`[ch-chord-position="${chordPosition}"]:is(chord, note, rest)`);
      const measureElement = melodyElement.closest('measure');
      melodyElement.removeAttribute('stem.dir');
      const lyrics = measureElement.querySelectorAll(`[ch-chord-position="${chordPosition}"]:is(chord, note) verse`);
      for (const lyric of lyrics) melodyElement.appendChild(lyric);
      const layer1 = measureElement.querySelector(`staff[n="${melodyStaffNumber}"] layer[n="1"]`);
      layer1.appendChild(melodyElement.closest('beam') ?? melodyElement);
    }
    // Remove orphaned chords, beams, layers, and staves
    for (const element of this._scoreData.meiParsed.querySelectorAll('chord, beam')) {
      if (!element.querySelector('note, rest')) {
        deletedElementIds.push(element.getAttribute('xml:id'));
        element.remove();
      }
    }
    for (const element of this._scoreData.meiParsed.querySelectorAll(`layer:not([n="1"]), staff:not([n="${melodyStaffNumber}"])`)) {
      deletedElementIds.push(element.getAttribute('xml:id'));
      element.remove();
    }
    // Clean up spanning elements
    const uniqueSlurs = new Set();
    for (const spanningElement of this._scoreData.meiParsed.querySelectorAll('[startid], [endid]')) {
      const startId = spanningElement.getAttribute('startid').substring(1);
      const endId = spanningElement.getAttribute('startid').substring(1);
      if (deletedElementIds.includes(startId) || deletedElementIds.includes(endId)) {
        spanningElement.remove();
        continue;
      } else if (spanningElement.tagName.toLowerCase() === 'slur') {
        const start_end = `${startId}_${endId}`;
        if (uniqueSlurs.has(start_end)) {
          spanningElement.remove();
          continue;
        }
        uniqueSlurs.add(start_end);
      }
      spanningElement.removeAttribute('curvedir');
    }
  }
  
  // Identify visible section IDs and chord positions
  const sectionIdsToKeep = new Set();
  const chordPositionsToKeep = new Set();
  const expandedChordPositionsToKeep = new Set();
  let ecpCounter = 0;
  if (this._currentOptions.hiddenSectionIds && this._currentOptions.hiddenSectionIds.length > 0) {
    for (const sectionInfo of this._scoreData.sections) {
      const sectionChordPositions = [];
      const sectionExpandedChordPositions = [];
      for (const chordPositionRange of sectionInfo.chordPositionRanges) {
        for (let cp = chordPositionRange.start; cp < chordPositionRange.end; cp++) {
          if (!this._currentOptions.hiddenSectionIds.includes(sectionInfo.sectionId)) {
            chordPositionsToKeep.add(cp);
            expandedChordPositionsToKeep.add(ecpCounter);
          }
          ecpCounter += 1;
        }
      }
      if (!this._currentOptions.hiddenSectionIds.includes(sectionInfo.sectionId)) {
        sectionIdsToKeep.add(sectionInfo.sectionId);
      }
    }
  }
  
  // Expand score
  const expansion = this._scoreData.meiParsed.querySelector('expansion[plist]');
  if (this._currentOptions.expandScore) {
    
    // Expand introduction
    this._scoreData.meiParsed = this._extractPianoIntroduction(this._scoreData.meiParsed);
    
    // Expand sections, endings, codas, etc.
    // TODO: Look into using Verovio's built-in expansion option (get expanded MEI, then edit to clean up endings, barlines, lyrics, etc.). Potential benefits would be automatic handling for cross-section ties (potentially – need to test), automatic generation of unique IDs, etc. The downside is less control over the output.
    const sectionIds = expansion.getAttribute('plist').split(' ').map(ref => ref.substring(1));
    if (this._currentOptions.expandScore === 'full-score' && this._scoreData.hasExpansion) {
      const singleLineSectionIds = [];
      
      // Gather section contents
      // TODO: No need to get previous element siblings if this is fixed in Verovio code. Example: "This Is the Christ" (Hymns—For Home and Church)
      // https://github.com/rism-digital/verovio/pull/4250
      const parentSection = expansion.parentElement;
      const sectionsById = {};
      const sectionIdCounter = {};
      for (const section of parentSection.querySelectorAll('section, ending')) {
        const sectionId = section.getAttribute('xml:id');
        
        // Check if section element has multiple simultaneous lyric lines
        if (!section.querySelector(':is(note[ch-melody], chord:has([ch-melody])) verse:nth-of-type(2)')) {
          singleLineSectionIds.push(sectionId);
        }
        
        sectionsById[sectionId] = [];
        sectionIdCounter[sectionId] = 0;
        let previousElement = section.previousElementSibling;
        while (previousElement && !['section', 'ending', 'expansion'].includes(previousElement.tagName)) {
          sectionsById[sectionId].push(previousElement);
          previousElement = previousElement.previousElementSibling;
        }
        sectionsById[sectionId].push(section);
        for (const element of sectionsById[sectionId]) element.remove();
      }
      
      // Create new section elements
      for (const sectionId of sectionIds) {
        sectionIdCounter[sectionId] += 1;
        for (const element of sectionsById[sectionId]) {
          const newElement = element.cloneNode(true);
          // Make IDs unique by appending '-rend1', '-rend2', etc.
          newElement.setAttribute('xml:id', newElement.getAttribute('xml:id') + `-rend${sectionIdCounter[sectionId]}`);
          for (const el of newElement.querySelectorAll('[*|id]')) {
            const previousId = el.getAttribute('xml:id');
            const newId = `${previousId}-rend${sectionIdCounter[sectionId]}`;
            el.setAttribute('xml:id', newId);
            for (const referencingEl of newElement.querySelectorAll(`[startid="#${previousId}"]`)) {
              referencingEl.setAttribute('startid', `#${newId}`);
            }
            for (const referencingEl of newElement.querySelectorAll(`[endid="#${previousId}"]`)) {
              referencingEl.setAttribute('endid', `#${newId}`);
            }
          }
          parentSection.append(newElement);
        }
      }
      
      // Clean up endings
      for (const ending of this._scoreData.meiParsed.querySelectorAll('ending')) {
        const endingSection = document.createElementNS('http://www.music-encoding.org/ns/mei', 'section');
        endingSection.setAttribute('xml:id', ending.getAttribute('xml:id'));
        endingSection.setAttribute('ch-chord-position', ending.getAttribute('ch-chord-position'));
        ending.before(endingSection);
        while (ending.firstChild) {
          endingSection.append(ending.firstChild);
        }
        ending.remove();
      }
      
      // Clean up directions
      for (const dir of this._scoreData.meiParsed.querySelectorAll('repeatMark, coda, segno, dir[type="coda"], dir[type="tocoda"], dir[type="segno"], dir[type="dalsegno"], dir[type="dacapo"], dir[type="fine"]')) {
        dir.remove();
      }
      
      // Clean up barlines
      for (const measure of this._scoreData.meiParsed.querySelectorAll('section measure:first-of-type')) {
        const leftBarline = measure.getAttribute('left');
        if (leftBarline != 'invis') measure.removeAttribute('left');
      }
      const endSectionMeasures = this._scoreData.meiParsed.querySelectorAll('section measure:last-of-type');
      for (let m = 0; m < endSectionMeasures.length; m++) {
        const measure = endSectionMeasures[m];
        const rightBarline = measure.getAttribute('right');
        if (rightBarline != 'invis') measure.removeAttribute('right');
        // TODO: Use double barline at the beginning of each verse or chorus, but not at the beginning of each section element (for example, in Gethsemane, the following line adds too many double barlines)
//           if (rightBarline != 'invis') measure.setAttribute('right', 'dbl');
        if (m === endSectionMeasures.length - 1) measure.setAttribute('right', 'end');
      }
      
      // Add expanded chord positions and clean up lyrics
      let ecpCounter = 0;
      let currentSectionIndex = -1;
      let currentSectionChordPositions = null;
      let currentExpandedChordPositions = null;
      const lyricLineCounters = {};
      const sectionElements = this._scoreData.meiParsed.querySelectorAll('section[type="introduction"], section:not([type="introduction"]) > section');
      for (const sectionInfo of this._scoreData.sections) {
        for (const chordPositionRange of sectionInfo.chordPositionRanges) {
          for (let chordPosition = chordPositionRange.start; chordPosition < chordPositionRange.end; chordPosition++) {
            // Move to next section if needed
            const firstElement = sectionElements[currentSectionIndex]?.querySelector(`[ch-chord-position="${chordPosition}"]`);
            if (currentSectionChordPositions == null || !currentSectionChordPositions.includes(chordPosition) || firstElement?.hasAttribute('ch-expanded-chord-position')) {
              if (currentExpandedChordPositions) {
                sectionElements[currentSectionIndex].setAttribute('ch-expanded-chord-position', currentExpandedChordPositions.join(' '));
              }
              currentSectionIndex++;
              currentSectionChordPositions = sectionElements[currentSectionIndex].getAttribute('ch-chord-position').trim().split(' ').map(cp => parseInt(cp));
              currentExpandedChordPositions = [];
            }
            currentExpandedChordPositions.push(ecpCounter);
            
            // Process chord position elements (add expanded chord positions and remove unneeded lyrics)
            const currentSection = sectionElements[currentSectionIndex];
            
            let originalSectionId, isSingleLine;
            if (sectionInfo.type !== 'introduction') {
              originalSectionId = currentSection.getAttribute('xml:id').split('-rend')[0];
              isSingleLine = this._scoreData.chordPositions[chordPosition].isSingleLine;
              lyricLineCounters[chordPosition] = (lyricLineCounters[chordPosition] ?? 0) + 1;
            }
            for (const element of currentSection.querySelectorAll(`[ch-chord-position="${chordPosition}"]`)) {
              element.setAttribute('ch-expanded-chord-position', ecpCounter);
              const verseElements = element.querySelectorAll('verse');
              if (verseElements.length > 0 && sectionInfo.type !== 'introduction') {
                const keptVerseIndex = (isSingleLine || singleLineSectionIds.includes(originalSectionId)) ? 0 
                  : Array.from(verseElements).findIndex(ve => parseInt(ve.getAttribute('n')) === lyricLineCounters[chordPosition]);
                for (let i = 0; i < verseElements.length; i++) {
                  const verseElement = verseElements[i];
                  if (i === keptVerseIndex) {
                    verseElement.setAttribute('n', 1);
                    verseElement.setAttribute('ch-section-id', sectionInfo.sectionId);
                  } else if (verseElement.hasAttribute('ch-secondary')) {
                    verseElement.setAttribute('n', 2);
                    verseElement.setAttribute('ch-section-id', sectionInfo.sectionId);
                  } else {
                    verseElement.remove();
                  }
                }
              }
            }
            
            ecpCounter++;
          }
        }
      }
      if (sectionElements[currentSectionIndex]) {
        sectionElements[currentSectionIndex].setAttribute('ch-expanded-chord-position', currentExpandedChordPositions.join(' '));
      }
      
    }
  }
  
  // Add expanded chord positions (non-expanded score, or expanded intro only)
  if (this._currentOptions.expandScore !== 'full-score') {
    const introSectionElement = this._scoreData.meiParsed.querySelector('section[type="introduction"]');
    const chordPositionElements = this._scoreData.meiParsed.querySelectorAll(`[ch-chord-position]`);
    for (const chordPositionElement of chordPositionElements) {
      const sectionElement = chordPositionElement.closest('section');
      const elementExpandedChordPositions = [];
      const chordPositions = chordPositionElement.getAttribute('ch-chord-position').trim().split(' ').map(cp => parseInt(cp));
      for (const chordPosition of chordPositions) {
        const chordPositionInfo = this._scoreData.chordPositions[chordPosition];
        if (!chordPositionInfo) continue;
        for (const [sectionId, expandedChordPositions] of Object.entries(chordPositionInfo.expandedChordPositions)) {
          const sectionType = this._scoreData.sectionsById[sectionId].type;
          if (
            !introSectionElement
            || (sectionType === 'introduction' && sectionElement === introSectionElement)
            || (sectionType !== 'introduction' && sectionElement !== introSectionElement)
          ) {
            elementExpandedChordPositions.push(...expandedChordPositions);
          }
        }
        chordPositionElement.setAttribute('ch-expanded-chord-position', elementExpandedChordPositions.join(' '));
      }
    }
  }
  
  // Set section lyrics visibility (non-expanded score)
  if (this._currentOptions.hiddenSectionIds && this._currentOptions.hiddenSectionIds.length > 0 && this._currentOptions.expandScore !== 'full-score') {
    const oldToNewLineNumber = {}
    for (const element of this._scoreData.meiParsed.querySelectorAll('label[ch-section-id], verse[ch-section-id]')) {
      const sectionIds = element.getAttribute('ch-section-id').split(' ');
      const chordPosition = parseInt(element.closest('[ch-chord-position]').getAttribute('ch-chord-position'));
      if (sectionIds.some(sectionId => sectionIdsToKeep.has(sectionId))) {
        const lineNumber = element.getAttribute('n');
        if (!Object.hasOwn(oldToNewLineNumber, lineNumber)) {
          oldToNewLineNumber[lineNumber] = Object.keys(oldToNewLineNumber).length + 1;
        }
        // Renumber visible lyric lines (prevents spacing issues, for example if first verse line is n=2 and first chorus line is n=1)
        if (this._scoreData.chordPositions[chordPosition].isSingleLine) {
          element.setAttribute('n', 1);
        } else if (!element.hasAttribute('ch-chorus')) {
          element.setAttribute('n', oldToNewLineNumber[lineNumber]);
        }
      } else {
        element.remove();
      }
    }
  }
  
  // Remove unneeded section elements
  if (this._currentOptions.hiddenSectionIds && this._currentOptions.hiddenSectionIds.length > 0) {    
    for (const sectionElement of this._scoreData.meiParsed.querySelectorAll('section[ch-expanded-chord-position], ending[ch-expanded-chord-position]')) {
      const sectionElementExpandedChordPositions = new Set(sectionElement.getAttribute('ch-expanded-chord-position').trim().split(' ').map(ecp => parseInt(ecp)));
      if (sectionElementExpandedChordPositions.isDisjointFrom(expandedChordPositionsToKeep)) sectionElement.remove();
    }
  }
  
  // Save changes
  this._scoreData.meiString = (new XMLSerializer()).serializeToString(this._scoreData.meiParsed);
  this._vrvToolkit.loadData(this._scoreData.meiString);
}

ChScore.prototype._updateSvg = function (svg) {
  const svgParsed = (new DOMParser()).parseFromString(svg, 'text/xml');
  const definitionScaleElement = svgParsed.querySelector('.definition-scale');
  const systems = svgParsed.querySelectorAll('g.system');
  const noteheadWidth = 230;
  // Remove CSS styles added by Verovio (:not(:last-child) is to make sure the <style> element with @font-face isn't removed)
  svgParsed.querySelector('style:not(:last-child)')?.remove();
  // TODO: Below may not be needed if https://github.com/rism-digital/verovio/issues/4252 is fixed
  definitionScaleElement.setAttribute('color', 'currentColor');
  definitionScaleElement.setAttribute('fill', 'currentColor');
  definitionScaleElement.setAttribute('stroke', 'currentColor');
  definitionScaleElement.setAttribute('stroke-width', '0');
  definitionScaleElement.setAttribute('font-family', 'Times, serif');
  
  // Remove unwanted font attribute (for example, on tempo text when mmOutput option is set – when printing)
  for (const textElement of definitionScaleElement.querySelectorAll('text[font-family="Times"]')) {
    textElement.removeAttribute('font-family');
    textElement.removeAttribute('font-weight');
  }
  
  // Improve appearance of tempo
  const tempoElements = svgParsed.querySelectorAll('.tempo text');
  for (const tempoElement of tempoElements) {
    tempoElement.firstElementChild.setAttribute('dy', '-60');
    const tempoTspans = tempoElement.querySelectorAll('tspan[font-size]');
    let previousTspanFont;
    for (const tempoTspan of tempoTspans) {
      if (tempoTspan.getAttribute('font-family') === 'Leipzig') { // Tempo music note
        tempoTspan.setAttribute('font-size', '500');
        if (previousTspanFont !== 'Leipzig') {
          tempoTspan.setAttribute('dy', '-50');
        }
      } else { // Tempo text
        tempoTspan.setAttribute('font-size', '350');
        if (previousTspanFont === 'Leipzig') {
          tempoTspan.setAttribute('dy', '50');
        }
      }
      previousTspanFont = tempoTspan.getAttribute('font-family');
    }
  }
  
  // Improve appearance of codas
  for (const toCoda of svgParsed.querySelectorAll('g.tocoda')) {
    const textElement = toCoda.querySelector('text');
    textElement?.setAttribute('text-anchor', 'end');
    const symbolTspan = toCoda.querySelector('tspan[font-family="Leipzig"]');
    if (symbolTspan) symbolTspan.innerHTML = ' ' + symbolTspan.innerHTML;
  }
  
  // Improve appearance of chord symbols
  if (this._scoreData.hasChordSets && this._currentOptions.showChordSet) {
    const chordTexts = svgParsed.querySelectorAll('.harm > text');
    for (const chordText of chordTexts) {
      chordText.setAttribute('text-anchor', 'middle');
      for (const tspan of chordText.querySelectorAll('tspan')) {
        if (tspan.hasAttribute('x')) { // Positioning tspan
          tspan.setAttribute('x', parseInt(tspan.getAttribute('x')) + (noteheadWidth / 2));
        } else if (tspan.hasAttribute('data-ch-superscript')) { // Superscript tspan
          tspan.setAttribute('dy', '-50');
          tspan.nextElementSibling?.setAttribute('dy', '50');
          tspan.querySelector('[font-size]').setAttribute('font-size', '300');
        } else if (tspan.getAttribute('font-family') === 'Leipzig') { // SMuFL tspan
          tspan.setAttribute('font-size', '700');
        }
      }
    }
  }
  
  // Improve appearance of intro brackets
  const introBrackets = Array.from(svgParsed.querySelectorAll('[data-ch-intro-bracket] [font-size]:not([font-size="0px"])'))
  for (const introBracket of introBrackets) {
    introBracket.setAttribute('font-size', '550');
    introBracket.setAttribute('dy', '150');
    if (introBracket.closest('[data-ch-intro-bracket]').getAttribute('data-ch-intro-bracket') === 'start') {
      introBracket.setAttribute('dx', '-180');
    } else {
      introBracket.setAttribute('dx', '100');
    }
    if (this._currentOptions.hiddenSectionIds && this._currentOptions.hiddenSectionIds.includes('introduction')) {
      introBracket.setAttribute('opacity', '0');
    }
  }
  
  // Add data-related attribute to accidentals, noteheads, ties, stems, etc.
  for (const note of svgParsed.querySelectorAll('g.note')) {
    note.querySelector('g.accid')?.setAttribute('data-related', note.id);
    note.querySelector('g.notehead')?.setAttribute('data-related', note.id);
    note.querySelector('g.dots ellipse')?.setAttribute('data-related', note.id);
    note.querySelector('g.stem path')?.setAttribute('data-related', note.id);
    note.querySelector('g.flag')?.setAttribute('data-related', note.id);
  }
  for (const spanningElement of svgParsed.querySelectorAll('g.tie')) {
    spanningElement.querySelector('path')?.setAttribute('data-related', spanningElement.dataset.startid.substring(1));
  }
  for (const chord of svgParsed.querySelectorAll('g.chord')) {
    const noteIds = Array.from(chord.querySelectorAll('g.note')).map(note => note.id);
    const dots = chord.querySelectorAll('g.dots ellipse');
    const stem = chord.querySelector('g.stem path');
    const flag = chord.querySelector('g.flag');
    for (let i = 0; i < dots.length; i++) {
      dots[i].setAttribute('data-related', noteIds[i]);
    }
    if (stem) stem.setAttribute('data-related', noteIds.join(' '));
    if (flag) flag.setAttribute('data-related', noteIds.join(' '));
  }
  
  // Set up background and foreground shape layers
  const pageMarginElement = svgParsed.querySelector('.page-margin');
  const backgroundShapes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  backgroundShapes.classList.add('ch-shapes', 'ch-shapes-background');
  pageMarginElement.prepend(backgroundShapes);
  const foregroundShapes = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  foregroundShapes.classList.add('ch-shapes', 'ch-shapes-foreground');
  pageMarginElement.append(foregroundShapes);
  
  // Assign class names to layers
  const shapeLayersByClassName = {
    'ch-staff-label': [],
    'ch-chord-position-label': [],
    'ch-lyric-line-label': [],
    'ch-system-rect': [],
    'ch-measure-rect': [],
    'ch-staff-rect': [],
    'ch-chord-position-line': [],
    'ch-chord-position-rect': [],
    'ch-note-circle': [],
    'ch-lyric-rect': [],
  }
  for (const className of this._currentOptions.drawBackgroundShapes || []) {
    shapeLayersByClassName[className]?.push(backgroundShapes);
  }
  for (const className of this._currentOptions.drawForegroundShapes || []) {
    shapeLayersByClassName[className]?.push(foregroundShapes);
  }
  
  // Draw background and foreground shapes (except lyric rects, which are drawn below)
  const measureXsById = {};
  for (const system of systems) {
    const measures = Array.from(system.querySelectorAll('.measure'));
    if (measures.length === 0) continue;
    
    // System, measure, and staff positions are determined based on staff lines drawn as SVG paths.
    // Example staff line path: <path d="M0 20 L500 20" stroke-width="13"></path>
    // The "d" attribute says "[M]ove to coordinates [0, 20]; draw [L]ine to coordinates [500, 20]"
    // Each measure has its own staff lines (so we need to look at the lines in the first and last measures)
    
    let systemX1, systemY1, systemX2, systemY2, lastStaffY2;
    systemX2 = parseInt(measures.at(-1).querySelector('.staff > path').getAttribute('d').split(' ')[2].replace('L', ''));
    
    const staves = measures[0].querySelectorAll('.staff');
    for (let sf = 0; sf < staves.length; sf++) {
      const staff = staves[sf];
      const staffNumber = parseInt(staff.dataset.n);
      const staffLines = Array.from(staff.querySelectorAll(':scope > path'));
      const staffY1 = parseInt(staffLines[0].getAttribute('d').split(' ')[1]);
      const staffY2 = parseInt(staffLines.at(-1).getAttribute('d').split(' ')[3]);
      
      if (sf === 0) {
        systemX1 = parseInt(staffLines[0].getAttribute('d').split(' ')[0].replace('M', ''));
        systemY1 = staffY1;
      }
      if (sf === staves.length - 1) {
        systemY2 = staffY2;
        lastStaffY2 = staffY2;
      }
      
      // Draw staff labels
      const staffLabelClassName = 'ch-staff-label';
      for (const shapeLayer of shapeLayersByClassName[staffLabelClassName]) {
        const staffLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        staffLabel.setAttribute('x', systemX1 - 300);
        staffLabel.setAttribute('y', staffY1 + ((staffY2 - staffY1) / 2));
        staffLabel.setAttribute('font-size', 350);
        staffLabel.setAttribute('text-anchor', 'end');
        staffLabel.setAttribute('dominant-baseline', 'central');
        staffLabel.setAttribute('class', staffLabelClassName);
        staffLabel.setAttribute('data-related', `${system.id} ${staff.id}`);
        staffLabel.innerHTML = `Staff ${staffNumber}`;
        shapeLayer.appendChild(staffLabel);
      }
      
      // Draw staff rects
      const staffRectClassName = 'ch-staff-rect';
      const leftExtension = shapeLayersByClassName['ch-chord-position-label'].length > 0 ? 1500 : 0;
      for (const shapeLayer of shapeLayersByClassName[staffRectClassName]) {
        const staffRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        staffRect.setAttribute('x', systemX1 - leftExtension);
        staffRect.setAttribute('y', staffY1);
        staffRect.setAttribute('width', systemX2 - systemX1 + leftExtension);
        staffRect.setAttribute('height', staffY2 - staffY1);
        staffRect.setAttribute('class', staffRectClassName);
        staffRect.setAttribute('data-related', `${system.id} ${staff.id}`);
        staffRect.setAttribute('data-ch-staff-number', staffNumber);
        shapeLayer.appendChild(staffRect);
      }
    }
    
    // If there's only one staff, make sure the system rectangle is tall enough to include the lyrics. This happens when set to melody only.
    if (staves.length < 2) {
      const systemLyricsBottom = Math.max(0, ...Array.from(system.querySelectorAll('.verse text')).map(lyric => parseInt(lyric.getAttribute('y'))));
      systemY2 = Math.max(systemY2, systemLyricsBottom + 500) ?? 0;
    }
    
    // Draw system rects
    const systemRectClassName = 'ch-system-rect';
    for (const shapeLayer of shapeLayersByClassName[systemRectClassName]) {
      const systemRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      systemRect.setAttribute('x', systemX1);
      systemRect.setAttribute('y', systemY1);
      systemRect.setAttribute('width', systemX2 - systemX1);
      systemRect.setAttribute('height', systemY2 - systemY1);
      systemRect.setAttribute('class', systemRectClassName);
      systemRect.setAttribute('data-related', system.id);
      shapeLayer.appendChild(systemRect);
    }
    
    // Skip systems without measures (sometimes happens when the window is narrow)
    if (measures.length === 0) continue;
    for (const measure of measures) {
      const staffLines = Array.from(measure.querySelectorAll('g.staff > path'));
      const [measureX1, _y1, measureX2, _y2] = staffLines.at(0).getAttribute('d').replace('M', '').replace('L', '').split(' ').map(coord => parseInt(coord));
      measureXsById[measure.id] = [measureX1, measureX2];
      
      // Draw measure rects
      const measureRectClassName = 'ch-measure-rect';
      for (const shapeLayer of shapeLayersByClassName[measureRectClassName]) {
        const measureRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        measureRect.setAttribute('x', measureX1);
        measureRect.setAttribute('y', systemY1);
        measureRect.setAttribute('width', measureX2 - measureX1);
        measureRect.setAttribute('height', systemY2 - systemY1);
        measureRect.setAttribute('class', measureRectClassName);
        measureRect.setAttribute('data-related', `${system.id} ${measure.id}`);
        shapeLayer.appendChild(measureRect);
      }
      
      const chordPositionNoteX1s = {};
      const chordPositionToExpandedChordPositions = {}
      const noteSymbols = measure.querySelectorAll('.note[data-ch-chord-position] .notehead use, .rest[data-ch-chord-position] use');
      for (const noteSymbol of noteSymbols) {
        const note = noteSymbol.closest('.note, .rest');
        const staff = noteSymbol.closest('.staff');
        const chordPosition = parseInt(note.dataset.chChordPosition);
        const expandedChordPositions = note.dataset.chExpandedChordPosition;
        if (!Object.hasOwn(chordPositionNoteX1s, chordPosition)) {
          chordPositionNoteX1s[chordPosition] = [];
          chordPositionToExpandedChordPositions[chordPosition] = expandedChordPositions;
        }
        const [noteX1, noteY1] = noteSymbol.getAttribute('transform').split('translate(').at(-1).split(')')[0].split(',').map(coord => parseInt(coord));
        chordPositionNoteX1s[chordPosition].push(noteX1);
        
        // Draw note circles
        const noteCircleClassName = 'ch-note-circle';
        for (const shapeLayer of shapeLayersByClassName[noteCircleClassName]) {
          if (noteSymbol.parentElement.classList.contains('rest')) continue;
          const noteCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          noteCircle.setAttribute('cx', noteX1 + (noteheadWidth / 2));
          noteCircle.setAttribute('cy', noteY1);
          noteCircle.setAttribute('r', 180);
          noteCircle.setAttribute('class', noteCircleClassName);
          noteCircle.setAttribute('data-related', `${system.id} ${measure.id} ${staff.id} ${note.id}`);
          noteCircle.setAttribute('data-ch-chord-position', chordPosition);
          noteCircle.setAttribute('data-ch-expanded-chord-position', expandedChordPositions);
          shapeLayer.append(noteCircle);
        }
      }
      
      let previousCpRect = null;
      const chordPositionNoteX1sEntries = Object.entries(chordPositionNoteX1s);
      for (let i = 0; i < chordPositionNoteX1sEntries.length; i++) {
        const [chordPosition, noteX1s] = chordPositionNoteX1sEntries[i];
        const expandedChordPositions = chordPositionToExpandedChordPositions[chordPosition];
        const cpLineX1 = Math.min(...noteX1s);
        const cpLineX = cpLineX1 + (noteheadWidth / 2);
        const cpRectX1 = i === 0 ? measureX1 : cpLineX1 - (noteheadWidth / 2);
        
        // Draw chord position labels
        const cpLabelClassName = 'ch-chord-position-label';
        for (const shapeLayer of shapeLayersByClassName[cpLabelClassName]) {
          const cpLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          cpLabel.setAttribute('x', cpLineX);
          cpLabel.setAttribute('y', systemY2 + 800);
          cpLabel.setAttribute('font-size', 350);
          cpLabel.setAttribute('text-anchor', 'middle');
          cpLabel.setAttribute('class', cpLabelClassName);
          cpLabel.setAttribute('data-related', `${system.id} ${measure.id}`);
          cpLabel.setAttribute('data-ch-chord-position', chordPosition);
          cpLabel.setAttribute('data-ch-expanded-chord-position', expandedChordPositions);
          cpLabel.innerHTML = chordPosition;
          shapeLayer.append(cpLabel);
        }
        
        // Draw chord position lines
        const cpLineClassName = 'ch-chord-position-line';
        for (const shapeLayer of shapeLayersByClassName[cpLineClassName]) {
          const cpLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          cpLine.setAttribute('x1', cpLineX);
          cpLine.setAttribute('y1', systemY1);
          cpLine.setAttribute('x2', cpLineX);
          cpLine.setAttribute('y2', systemY2);
          cpLine.setAttribute('class', cpLineClassName);
          cpLine.setAttribute('data-related', `${system.id} ${measure.id}`);
          cpLine.setAttribute('data-ch-chord-position', chordPosition);
          cpLine.setAttribute('data-ch-expanded-chord-position', expandedChordPositions);
          shapeLayer.appendChild(cpLine);
        }
        
        // Draw chord position rects
        const cpRectClassName = 'ch-chord-position-rect';
        const bottomExtension = shapeLayersByClassName['ch-chord-position-label'].length > 0 ? 1000 : 0;
        for (const shapeLayer of shapeLayersByClassName[cpRectClassName]) {
          const cpRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          cpRect.setAttribute('x', cpRectX1);
          cpRect.setAttribute('y', systemY1);
          cpRect.setAttribute('width', measureX2 - cpRectX1); // Updated later if not the last chord position in the measure
          cpRect.setAttribute('height', systemY2 - systemY1 + bottomExtension);
          cpRect.setAttribute('class', cpRectClassName);
          cpRect.setAttribute('data-related', `${system.id} ${measure.id}`);
          cpRect.setAttribute('data-ch-chord-position', chordPosition);
          cpRect.setAttribute('data-ch-expanded-chord-position', expandedChordPositions);
          shapeLayer.appendChild(cpRect);
          
          // Update width of previous chord position rect
          if (previousCpRect) previousCpRect.setAttribute('width', cpRectX1 - parseInt(previousCpRect.getAttribute('x')));
          previousCpRect = cpRect;
        }
        
      }
      
    }
    
    // Add missing system line at the left edge of the system (this happens after removing staves from the MEI, such as the empty staves in True to the Faith, 1985 Hymns)
    if (!system.querySelector(':scope > path')) {
      const systemLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      // Match system lines drawn by Verovio (13px inset and 27px stroke width)
      systemLine.setAttribute('d', `M13 ${systemY1} L13 ${lastStaffY2}`);
      systemLine.setAttribute('stroke-width', '27');
      system.insertBefore(systemLine, system.firstChild);
    }
  }
  
  // Loop through lyrics by system and staff
  if (this._scoreData.hasLyrics) {
    const lyricFontSize = parseInt(svgParsed.querySelector('.verse tspan[font-size]:not([font-size="0px"])')?.getAttribute('font-size'));
    const lyricPadding = lyricFontSize / 8;
    for (const system of systems) {
      const addedLyricLabels = [];
      for (const staffNumber of this._scoreData.staffNumbers) {
        const previouslyricRect = {
          'ch-shapes-background': {},
          'ch-shapes-foreground': {},
        }
        const verseYPositions = [];
        const chorusYPositions = [];
        const staffLyrics = system.querySelectorAll(`.staff[data-n="${staffNumber}"] .label, .staff[data-n="${staffNumber}"] .verse`);
        if (staffLyrics.length === 0) continue;
        
        for (const lyric of staffLyrics) {
          // Add missing attributes to label (in MEI, the label is inside the verse, but in the SVG, it's a sibling)
          if (lyric.classList.contains('label')) {
            if (lyric.nextElementSibling.dataset.chLyricLineId) lyric.dataset.chLyricLineId = lyric.nextElementSibling.dataset.chLyricLineId;
            if (lyric.nextElementSibling.dataset.chSectionId) lyric.dataset.chSectionId = lyric.nextElementSibling.dataset.chSectionId;
          }
          const isChorus = lyric.hasAttribute('data-ch-chorus');
          const lyricTextElement = lyric.querySelector('text');
          if (!lyric.dataset.chLyricLineId || !lyricTextElement) continue;
          const noteOrChord = lyric.closest('[data-ch-chord-position]');
          const chordPosition = parseInt(noteOrChord.dataset.chChordPosition);
          const expandedChordPositions = parseInt(noteOrChord.dataset.chExpandedChordPosition);
          const staff = noteOrChord.closest('.staff');
          const measure = staff.closest('.measure');
          const measureFirstChordPosition = parseInt(measure.querySelector('[data-ch-chord-position]').dataset.chChordPosition);
          const [measureX1, measureX2] = measureXsById[measure.id];
          let lyricX = parseInt(lyricTextElement.getAttribute('x')) - lyricPadding;
          if (chordPosition === measureFirstChordPosition) lyricX = Math.min(lyricX, measureX1);
          const lyricY = parseInt(lyricTextElement.getAttribute('y'));
          
          if (!isChorus && !verseYPositions.includes(lyricY)) {
            verseYPositions.push(lyricY);
          } else if (isChorus && !chorusYPositions.includes(lyricY)) {
            chorusYPositions.push(lyricY);
          }
          
          // Draw lyric line labels
          const lyricLineLabelClassName = 'ch-lyric-line-label';
          if (!addedLyricLabels.includes(lyric.dataset.chLyricLineId)) {
            for (const shapeLayer of shapeLayersByClassName[lyricLineLabelClassName]) {
              const lyricLineLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
              lyricLineLabel.setAttribute('x', measureX1 - 300);
              lyricLineLabel.setAttribute('y', lyricY);
              lyricLineLabel.setAttribute('font-size', 350);
              lyricLineLabel.setAttribute('text-anchor', 'end');
              lyricLineLabel.setAttribute('dominant-baseline', 'text-bottom');
              lyricLineLabel.setAttribute('class', lyricLineLabelClassName);
              lyricLineLabel.setAttribute('data-related', `${system.id} ${staff.id} ${lyric.id}`);
              lyricLineLabel.setAttribute('data-ch-lyric-line-id', `${lyric.dataset.chLyricLineId}`);
              lyricLineLabel.innerHTML = lyric.dataset.chLyricLineId;
              shapeLayer.appendChild(lyricLineLabel);
            }
            addedLyricLabels.push(lyric.dataset.chLyricLineId);
          }
          
          // Draw lyric rectangles
          const lyricRectClassName = 'ch-lyric-rect';
          for (const shapeLayer of shapeLayersByClassName[lyricRectClassName]) {
            if (lyric.classList.contains('label')) continue;
            const lyricRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            lyricRect.setAttribute('x', lyricX);
            lyricRect.setAttribute('y', lyricY - lyricFontSize + lyricPadding);
            lyricRect.setAttribute('width', measureX2 - lyricX); // Updated later
            lyricRect.setAttribute('height', lyricFontSize);
            lyricRect.setAttribute('class', lyricRectClassName);
            lyricRect.setAttribute('data-related', `${system.id} ${measure.id} ${staff.id} ${lyric.id}`);
            lyricRect.setAttribute('data-ch-section-id', `${lyric.dataset.chSectionId}`);
            lyricRect.setAttribute('data-ch-lyric-line-id', `${lyric.dataset.chLyricLineId}`);
            lyricRect.setAttribute('data-ch-chord-position', chordPosition);
            lyricRect.setAttribute('data-ch-expanded-chord-position', expandedChordPositions);
            shapeLayer.appendChild(lyricRect);
            
            // Update width of previous lyric rect
            let lyricIsLeftOfPreviousLyric = false;
            const shapeLayerClass = shapeLayer.classList.contains('ch-shapes-background') ? 'ch-shapes-background' : 'ch-shapes-foreground';
            if (previouslyricRect[shapeLayerClass][lyric.dataset.chLyricLineId]) {
              const previousLyricX = parseInt(previouslyricRect[shapeLayerClass][lyric.dataset.chLyricLineId].getAttribute('x'));
              if (lyricX > previousLyricX) {
                const previousLyricWidth = parseInt(previouslyricRect[shapeLayerClass][lyric.dataset.chLyricLineId].getAttribute('width'));
                const previousLyricNewWidth = Math.min(lyricX - previousLyricX, previousLyricWidth);
                previouslyricRect[shapeLayerClass][lyric.dataset.chLyricLineId].setAttribute('width', previousLyricNewWidth);
              } else {
                lyricIsLeftOfPreviousLyric = true;
              }
            }
            
            // Handle case where the previously-processed lyric is to the right of the current lyric. This can happen when lyrics are in multiple layers, such as in "It Is Well with My Soul", alto part words "well" and "soul" (layer 1 lyrics come before layer 2 lyrics in the DOM).
            if (lyricIsLeftOfPreviousLyric) {
              const nearbyLyrics = staff.querySelectorAll(`.staff[data-n="${staffNumber}"] .verse[data-ch-lyric-line-id="${lyric.dataset.chLyricLineId}"]`);
              let nextLyricRect;
              for (const nearbyLyric of nearbyLyrics) {
                if (parseInt(nearbyLyric.dataset.chChordPosition) < chordPosition) continue;
                const nearbyLyricRect = shapeLayer.querySelector(`.ch-lyric-rect[data-related~="${nearbyLyric.id}"]`);
                if (nearbyLyricRect) {
                  nextLyricRect = nearbyLyricRect;
                  break;
                }
              }
              let newWidth = lyricFontSize * 2;
              if (nextLyricRect) newWidth = parseInt(nextLyricRect.getAttribute('x')) - lyricX;
              lyricRect.setAttribute('width', newWidth);
            } else {
              previouslyricRect[shapeLayerClass][lyric.dataset.chLyricLineId] = lyricRect;
            }
          }
        }
        
        // Center chorus and verse lines (works best if the first chorus line is at n=1, otherwise there may be extra space below the lyrics, where the chorus was)
        const numVerses = verseYPositions.length;
        const numChoruses = chorusYPositions.length;
        if (numVerses > 0 && numChoruses > 0 && numVerses !== numChoruses) {
          const lineHeight = numVerses > 1 ? (verseYPositions[1] - verseYPositions[0]) : (chorusYPositions[1] - chorusYPositions[0]);
          const versesTop = verseYPositions[0];
          const versesBottom = verseYPositions.at(-1) + lineHeight;
          const chorusesTop = chorusYPositions[0];
          const chorusesBottom = chorusYPositions.at(-1) + lineHeight;
          if (numVerses > numChoruses) {
            const offset = (versesTop - chorusesTop) + (((versesBottom - versesTop) - (chorusesBottom - chorusesTop)) / 2);
            for (const lyric of system.querySelectorAll(`.staff[data-n="${staffNumber}"] .label[data-ch-chorus], .staff[data-n="${staffNumber}"] .verse[data-ch-chorus]`)) {
              for (const element of Array.from(lyric.querySelectorAll('text, rect'))
                .concat([svgParsed.querySelector(`:is(.ch-shapes) [data-related~="${lyric.id}"]`)])
              ) {
                element?.setAttribute('y', parseInt(element?.getAttribute('y')) + offset);
              }
            }
          } else if (numChoruses > numVerses) {
            const offset = (chorusesTop - versesTop) + (((chorusesBottom - chorusesTop) - (versesBottom - versesTop)) / 2);
            for (const lyric of system.querySelectorAll(`.staff[data-n="${staffNumber}"] .label:not([data-ch-chorus]), .staff[data-n="${staffNumber}"] .verse:not([data-ch-chorus])`)) {
              for (const element of Array.from(lyric.querySelectorAll('text, rect'))
                .concat([svgParsed.querySelector(`:is(.ch-shapes) [data-related~="${lyric.id}"]`)])
              ) {
                element?.setAttribute('y', parseInt(element?.getAttribute('y')) + offset);
              }
            }
          }
        }
      }
    }
  }
  
  // Set chord chart visibility
  // TODO: Add guitar chord charts: https://github.com/andresmegias/acordia
  if (this._currentOptions.showChordSet && this._currentOptions.showChordSetImages) {
    const currentChordSet = this._scoreData.chordSetsById[this._currentOptions.showChordSet];
    if (currentChordSet && currentChordSet.svgSymbolsUrl) {
      for (const [chordPosition, chordPositionRefInfo] of Object.entries(currentChordSet.chordPositionRefs)) {
        const harmElements = svgParsed.querySelectorAll(`.harm[data-ch-chord-position="${chordPosition}"]`);
        for (const harmElement of harmElements) {
          const measure = harmElement.closest('.measure');
          let chordChartsGroup = measure.querySelector('.ch-chord-set-images');
          if (!chordChartsGroup) {
            chordChartsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            chordChartsGroup.classList.add('ch-chord-set-images');
            measure.append(chordChartsGroup);
          }
          if (harmElement && chordPositionRefInfo.svgSymbolId) {
            const harmPositioningTspan = harmElement.querySelector('tspan[x]');
            const harmTop = parseInt(harmPositioningTspan.getAttribute('y')) - 2000;
            const harmLeft = parseInt(harmPositioningTspan.getAttribute('x')) - 600;
            chordChartsGroup.insertAdjacentHTML('beforeend', `<use x="${harmLeft}" y="${harmTop}" href="${currentChordSet.svgSymbolsUrl}#${chordPositionRefInfo.svgSymbolId}" width="1200" height="1200" />`);
          }
        }
      }
    }
  }
  
  return (new XMLSerializer()).serializeToString(svgParsed);
}

// Convert qstamp (0-based position in quarter notes, relative to song) to tstamp (1-based position in time signature denominator notes, relative to measure)
ChScore.prototype._qstampToTstamp = function (startQ, measureStartQ, timeSignatureDenominator) {
  const quartersPerBeat = 4 / timeSignatureDenominator;
  const tstamp = ((startQ - measureStartQ) / quartersPerBeat) + 1;
  return tstamp;
}

// Find the last item in an array that is less than or equal to the target value
// An optional key can be provided to find matches in a list of arrays
ChScore.prototype._binaryFind = function (arr, targetValue, { key = null, returnIndex = false, sort = false, findType = 'last-lte' }) {
  // Sort the array (if needed)
  if (sort) {
    if (key === null) {
      arr.sort((a, b) => a[key] - b[key]);
    } else {
      arr.sort((a, b) => a - b);
    }
  }
  
  // Do a binary search on the array to find the last value <= the target value
  let leftIndex = 0;
  let rightIndex = arr.length - 1;
  let targetIndex = -1;
  while (leftIndex <= rightIndex) {
    const midpointIndex = Math.floor((leftIndex + rightIndex) / 2);
    const midpointValue = key === null ? arr[midpointIndex] : arr[midpointIndex][key];
    
    // Last less than or equal
    if (findType === 'last-lte') {
      if (midpointValue <= targetValue) {
        targetIndex = midpointIndex;
        leftIndex = midpointIndex + 1;
      } else {
        rightIndex = midpointIndex - 1;
      }
    // First greater than or equal
    } else if (findType === 'first-gte') {
      if (midpointValue >= targetValue) {
        targetIndex = midpointIndex;
        rightIndex = midpointIndex - 1;
      } else {
        leftIndex = midpointIndex + 1;
      }
    }
    
  }
  
  // Return the matching index or value
  if (returnIndex) {
    return targetIndex;
  } else {
    return arr[targetIndex];
  }
}

// Based on Python bisect.bisect_left
ChScore.prototype._bisectLeft = function (arr, target) {
  let left = 0;
  let right = arr.length;
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (arr[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }
  return left;
}    

ChScore.prototype._getQpmAtTime = function (seconds, midiTempos) {
  const tempo = this._binaryFind(midiTempos, seconds, { key: 'time', findType: 'last-lte' });
  return tempo?.qpm ?? parseInt(this._scoreData.meiParsed.querySelector('tempo').getAttribute('midi.bpm'));
}

ChScore.prototype._getMidiDuration = function (durationQ, quartersPerMinute) {
  const quartersPerSecond = quartersPerMinute / 60;
  return durationQ / quartersPerSecond;
}


// Wrapper function to prevent the given function from being called too frequently
// Adapted from https://levelup.gitconnected.com/debounce-in-javascript-improve-your-applications-performance-5b01855e086
ChScore.prototype._debounce = function (func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Throttle
ChScore.prototype._throttleStatus = {}
ChScore.prototype._isThrottled = function (key, ms) {
  let keyIsThrottled;
  if (Object.hasOwn(this._throttleStatus, key) && this._throttleStatus[key] === true) {
    keyIsThrottled = true;
  } else {
    keyIsThrottled = false;
    this._throttleStatus[key] = true;
    setTimeout(() => {
      this._throttleStatus[key] = false;
    }, ms);
  }
  return keyIsThrottled;
}

// Add a CSS stylesheet to the document
ChScore.prototype._addStylesheet = function (stylesheets, stylesheetKey) {
  let stylesheet = this._stylesheets[stylesheetKey];
  if (!stylesheet) {
    if (this._supportsCssStylesheetApi) {
      stylesheet = new CSSStyleSheet();
      document.adoptedStyleSheets.push(stylesheet);
    } else {
      // For browsers that don't fully support the CSSStyleSheet API, such as Safari < 16.4.
      // See https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet#browser_compatibility
      stylesheet = document.createElement('style');
      stylesheet.appendChild(document.createTextNode(''));
      stylesheet.replaceSync = (newContent) => {
        stylesheet.textContent = newContent;
      }
      stylesheet.insertRule = (newContent) => {
        stylesheet.textContent += newContent;
      }
      document.head.appendChild(stylesheet);
    }
    this._stylesheets[stylesheetKey] = stylesheet;
  }
  return stylesheet;
}

// Remove CSS stylesheets (only those from the current ChScore instance)
ChScore.prototype._removeStylesheets = function () {
  for (const stylesheet of Object.values(this._stylesheets)) {
    if (this._supportsCssStylesheetApi) {
      const adoptedStylesheetIndex = document.adoptedStyleSheets.indexOf(stylesheet);
      document.adoptedStyleSheets.splice(adoptedStylesheetIndex, 1);
    } else {
      stylesheet.remove();
    }
  }
}
  
// Get score elements at point
ChScore.prototype._getPointData = function (x, y) {
  const pointData = {
    systemId: null,
    measureId: null,
    noteIds: [],
    partIds: [],
    lyricId: null,
    chordPosition: null,
    expandedChordPositions: [],
    staffNumber: null,
    sectionIds: [],
    lyricLineId: null,
  }
  let elements = [];
  try { // Avoid an error if the window loses focuses
    elements = document.elementsFromPoint(event.clientX, event.clientY) ?? [];
  } finally {}
  for (const element of elements) {
    if (element === this._container) break;
    
    if (element.dataset.chChordPosition) {
      pointData.chordPosition = parseInt(element.dataset.chChordPosition);
    }
    if (element.dataset.chExpandedChordPosition) {
      pointData.expandedChordPositions = element.dataset.chExpandedChordPosition.split(' ').map(ecp => parseInt(ecp));
    }
    if (element.dataset.chSectionId) {
      pointData.sectionIds = element.dataset.chSectionId.split(' ');
    }
    if (element.dataset.chLyricLineId) {
      pointData.lyricLineId = element.dataset.chLyricLineId;
    }
    if (element.dataset.chStaffNumber) {
      pointData.staffNumber = parseInt(element.dataset.chStaffNumber);
    }
    if (element.dataset.related || element.parentElement?.dataset?.related) {
      for (const relatedElementId of (element.dataset.related || element.parentElement.dataset.related).split(' ')) {
        const relatedElement = document.getElementById(relatedElementId);
        if (relatedElement.classList.contains('system')) {
          pointData.systemId = relatedElementId;
        } else if (relatedElement.classList.contains('measure')) {
          pointData.measureId = relatedElementId;
        } else if (relatedElement.classList.contains('staff')) {
          pointData.staffNumber = parseInt(relatedElement.dataset.n);
        } else if (relatedElement.classList.contains('note')) {
          pointData.noteIds.push(relatedElementId);
          if (relatedElement.dataset.chPartId) {
            pointData.partIds = relatedElement.dataset.chPartId.split(' ');
          }
        } else if (relatedElement.classList.contains('verse')) {
          pointData.lyricId = relatedElementId;
        }
      }
    }
  }
  
  // Get sectionIds if not specified
  if (pointData.sectionIds.length === 0) {
    if (pointData.expandedChordPositions.length > 0 && this._scoreData.expandedChordPositions) {
      pointData.sectionIds = pointData.expandedChordPositions.map(ecp => this._scoreData.expandedChordPositions[ecp].sectionId);
    } else if (pointData.chordPosition && this._scoreData.chordPositions) {
      pointData.sectionIds = Object.keys(this._scoreData.chordPositions[pointData.chordPosition].expandedChordPositions ?? {});
    }
  }
  
  return pointData;
}    

// This function created with help from AI (Claude)
ChScore.prototype._extractPianoIntroduction = function (meiParsed) {
  const MUSICAL_ELEMENTS = ['note', 'rest', 'chord', 'space'];
  const MEASURE_ATTRS = ['clef', 'keySig', 'meterSig', 'staffDef'];
  const NOTATION_ELEMENTS = ['tie', 'slur', 'dir', 'harm', 'dynam', 'tempo', 'pedal'];
  
  const updateElementIds = (elem, idMap) => {
    const elements = elem.tagName === 'chord' ? elem.querySelectorAll('note') : [elem];
    
    for (const el of elements) {
      const oldId = el.getAttribute('xml:id');
      if (oldId) {
        const newId = `${oldId}-intro`;
        idMap[oldId] = newId;
        el.setAttribute('xml:id', newId);
      }
    }
  };
  
  const updateElementAndChildIds = (elem, idMap) => {
    if (elem.hasAttribute('xml:id')) {
      const oldId = elem.getAttribute('xml:id');
      const newId = `${oldId}-intro`;
      idMap[oldId] = newId;
      elem.setAttribute('xml:id', newId);
    }
    
    for (const child of elem.children) {
      updateElementAndChildIds(child, idMap);
    }
  };
  
  const calculateDuration = (elem, tstampUnit = 4) => {
    const dur = parseFloat(elem.getAttribute('dur') || '4');
    const dots = parseInt(elem.getAttribute('dots') || '0');
    let durTstamps = tstampUnit / dur;
    for (let i = 0; i < dots; i++) durTstamps += durTstamps / 2;
    return durTstamps;
  };
  
  const getTstampUnit = (measure) => {
    // Find time signature
    let meterSig = measure.querySelector('meterSig');
    if (!meterSig) {
      const scoreDef = meiParsed.querySelector('scoreDef');
      meterSig = scoreDef?.querySelector('meterSig');
    }
    
    if (meterSig) {
      const unit = parseInt(meterSig.getAttribute('unit') || '4');
      // The tstamp unit is the denominator of the time signature
      // In 3/2, unit=2, so 1 tstamp = 1 half note
      // In 4/4, unit=4, so 1 tstamp = 1 quarter note
      return unit;
    }
    
    return 4; // Default to quarter note
  };
  
  const convertTstampsToDur = (tstamps, tstampUnit = 4) => {
    // tstampUnit tells us what note value = 1 tstamp
    // In 3/2 time: tstampUnit = 2 (half note = 1 tstamp)
    // In 4/4 time: tstampUnit = 4 (quarter note = 1 tstamp)
    
    // Handle dotted notes
    const withOneDot = tstamps / 1.5;
    const withTwoDots = tstamps / 1.75;
    
    const validDurs = [1, 2, 4, 8, 16, 32, 64];
    
    // Check if it matches a dotted duration
    for (const validDur of validDurs) {
      const plainDur = tstampUnit / validDur;
      if (Math.abs(withOneDot - plainDur) < 0.01) {
        return { dur: validDur, dots: 1 };
      }
      if (Math.abs(withTwoDots - plainDur) < 0.01) {
        return { dur: validDur, dots: 2 };
      }
    }
    
    // Otherwise find nearest plain duration
    const meiDur = tstampUnit / tstamps;
    let nearest = validDurs[0];
    let minDiff = Math.abs(meiDur - nearest);
    
    for (const validDur of validDurs) {
      const diff = Math.abs(meiDur - validDur);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = validDur;
      }
    }
    
    return { dur: nearest, dots: 0 };
  };
  
  const clipElement = (elem, currentTstamp, elemEnd, startTstamp, endTstamp, idMap, tstampUnit) => {
    const newElem = elem.cloneNode(true);
    
    if (currentTstamp >= startTstamp && elemEnd <= endTstamp) {
      // Fully inside range - no clipping needed
      updateElementIds(newElem, idMap);
    } else {
      // Partial overlap - clip the duration
      let newDur;
      if (currentTstamp < startTstamp) {
        newDur = Math.min(elemEnd, endTstamp) - startTstamp;
      } else {
        newDur = endTstamp - currentTstamp;
      }
      
      const result = convertTstampsToDur(newDur, tstampUnit);
      newElem.setAttribute('dur', String(result.dur));
      if (result.dots > 0) {
        newElem.setAttribute('dots', String(result.dots));
      } else {
        newElem.removeAttribute('dots');
      }
      updateElementIds(newElem, idMap);
    }
    
    return newElem;
  };
          
  const copyLayerRange = (layer, startTstamp, endTstamp, idMap, tstampUnit) => {
    const newLayer = meiParsed.createElement('layer');
    newLayer.setAttribute('n', layer.getAttribute('n') || '1');
    
    let tstamp = 1;
    let hasContent = false;
    startTstamp = startTstamp ?? 1;
    endTstamp = endTstamp ?? Infinity;
    
    const processContainer = (container, currentTstamp) => {
      let containerTstamp = currentTstamp;
      const children = [];
      
      for (const child of container.children) {
        if (child.tagName === 'beam' || child.tagName === 'tuplet') {
          const result = processContainer(child, containerTstamp);
          if (result.element) {
            children.push(result.element);
          }
          containerTstamp = result.endTstamp;
        } else if (MUSICAL_ELEMENTS.includes(child.tagName)) {
          const durTstamps = calculateDuration(child, tstampUnit);
          const elemEnd = containerTstamp + durTstamps;
          
          if (containerTstamp < endTstamp && elemEnd > startTstamp) {
            children.push(clipElement(child, containerTstamp, elemEnd, startTstamp, endTstamp, idMap, tstampUnit));
          }
          
          containerTstamp = elemEnd;
        }
      }
      
      let newContainer = null;
      if (children.length > 0) {
        newContainer = meiParsed.createElement(container.tagName);
        if (container.hasAttribute('xml:id')) {
          const oldId = container.getAttribute('xml:id');
          const newId = `${oldId}-intro`;
          idMap[oldId] = newId;
          newContainer.setAttribute('xml:id', newId);
        }
        
        if (container.tagName === 'tuplet') {
          const tupletAttrs = ['num', 'numbase', 'bracket.visible', 'num.visible', 'num.place', 'bracket.place'];
          tupletAttrs.forEach(attr => {
            if (container.hasAttribute(attr)) {
              newContainer.setAttribute(attr, container.getAttribute(attr));
            }
          });
        }
        
        children.forEach(child => newContainer.appendChild(child));
      }
      
      return { element: newContainer, endTstamp: containerTstamp };
    };
    
    const processElement = (elem, currentTstamp) => {
      if (elem.tagName === 'beam' || elem.tagName === 'tuplet') {
        const result = processContainer(elem, currentTstamp);
        if (result.element) {
          newLayer.appendChild(result.element);
          hasContent = true;
        }
        return result.endTstamp - currentTstamp;
      }
      
      if (!MUSICAL_ELEMENTS.includes(elem.tagName)) {
        if (startTstamp <= currentTstamp && currentTstamp < endTstamp) {
          newLayer.appendChild(elem.cloneNode(true));
          hasContent = true;
        }
        return 0;
      }
      
      const durTstamps = calculateDuration(elem, tstampUnit);
      const elemEnd = currentTstamp + durTstamps;
      
      if (currentTstamp < endTstamp && elemEnd > startTstamp) {
        newLayer.appendChild(clipElement(elem, currentTstamp, elemEnd, startTstamp, endTstamp, idMap, tstampUnit));
        hasContent = true;
      }
      
      return durTstamps;
    };
    
    for (const elem of layer.children) {
      const duration = processElement(elem, tstamp);
      tstamp += duration;
    }
    
    return hasContent ? newLayer : null;
  };
      
  const updateIdReferences = (elem, idMap) => {
    for (const attr of ['startid', 'endid', 'plist']) {
      if (!elem.hasAttribute(attr)) continue;
      
      const value = elem.getAttribute(attr);
      const ids = value.split(/\s+/);
      const updated = ids.map(id => {
        if (id.startsWith('#')) {
          const oldId = id.substring(1);
          return oldId in idMap ? `#${idMap[oldId]}` : id;
        }
        return id;
      });
      elem.setAttribute(attr, updated.join(' '));
    }
  };
  
  const getMeasureDuration = (measure) => {
    const staff = measure.querySelector('staff');
    if (!staff) return 0;
    
    const layer = staff.querySelector('layer');
    if (!layer) return 0;
    
    const tstampUnit = getTstampUnit(measure);
    
    let totalDur = 0;
    const traverse = (elem) => {
      if (MUSICAL_ELEMENTS.includes(elem.tagName)) {
        totalDur += calculateDuration(elem, tstampUnit);
      } else if (elem.tagName === 'beam' || elem.tagName === 'tuplet') {
        for (const child of elem.children) traverse(child);
      }
    };
    
    for (const elem of layer.children) traverse(elem);
    return totalDur;
  };
  
  const getExpectedMeasureDuration = (measure) => {
    // Look for time signature in this measure or previous measures
    let timeEl = measure.querySelector('meterSig');
    if (!timeEl) {
      const scoreDef = meiParsed.querySelector('scoreDef');
      timeEl = scoreDef?.querySelector('meterSig');
    }
    
    if (timeEl) {
      const count = parseInt(timeEl.getAttribute('count') || '4');
      const unit = parseInt(timeEl.getAttribute('unit') || '4');
      return (4 / unit) * count;
    }
    
    return 4; // Default to 4/4
  };
  
  const renumberAndAppendMeasures = (allExtractedMeasures, introSection, startN) => {
    let n = startN;
    
    for (let rangeIdx = 0; rangeIdx < allExtractedMeasures.length; rangeIdx++) {
      const measures = allExtractedMeasures[rangeIdx];
      for (let i = 0; i < measures.length; i++) {
        const m = measures[i];
        m.setAttribute('n', String(n++));
        
        // If this is the last measure of a range and the next range starts with a partial measure
        if (i === measures.length - 1 && rangeIdx < allExtractedMeasures.length - 1) {
          const nextRangeMeasures = allExtractedMeasures[rangeIdx + 1];
          const thisIsPartial = m.getAttribute('metcon') === 'false';
          const nextIsPartial = nextRangeMeasures[0]?.getAttribute('metcon') === 'false';
          
          if (thisIsPartial && nextIsPartial) {
            m.setAttribute('right', 'invis');
          }
        }
        
        introSection.appendChild(m);
      }
    }
    
    return n;
  };
  
  const extractRange = (measures, startM, startTstamp, endM, endTstamp, idMap) => {
    startM = startM ?? measures[0].getAttribute('n');
    endM = endM ?? measures[measures.length - 1].getAttribute('n');
    
    const startIdx = measures.findIndex(m => m.getAttribute('n') === String(startM));
    const endIdx = measures.findIndex(m => m.getAttribute('n') === String(endM));
    const selected = measures.slice(startIdx, endIdx + 1);
    
    return selected.map((measure, i) => {
      const newM = meiParsed.createElement('measure');
      newM.setAttribute('n', measure.getAttribute('n'));
      
      const mStart = i === 0 ? startTstamp : null;
      const mEnd = i === selected.length - 1 ? endTstamp : null;
      
      // Get tstamp unit for this measure
      const tstampUnit = getTstampUnit(measure);
      
      // Copy measure attributes (first measure only)
      if (i === 0) {
        for (const child of measure.children) {
          if (MEASURE_ATTRS.includes(child.tagName)) {
            newM.appendChild(child.cloneNode(true));
          }
        }
      }
      
      // Group and copy layers by staff
      const staffs = {};
      for (const staff of measure.querySelectorAll('staff')) {
        const staffN = staff.getAttribute('n') || '1';
        staffs[staffN] = staffs[staffN] || [];
        for (const layer of staff.querySelectorAll('layer')) {
          const copiedLayer = copyLayerRange(layer, mStart, mEnd, idMap, tstampUnit);
          if (copiedLayer) {
            staffs[staffN].push(copiedLayer);
          }
        }
      }
      
      // Create staff elements
      for (const [staffN, layers] of Object.entries(staffs)) {
        const newStaff = meiParsed.createElement('staff');
        newStaff.setAttribute('n', staffN);
        layers.forEach(layer => newStaff.appendChild(layer));
        newM.appendChild(newStaff);
      }
      
      // Copy notation elements with updated ID references
      for (const elem of measure.children) {
        if (NOTATION_ELEMENTS.includes(elem.tagName)) {
          const newElem = elem.cloneNode(true);
          updateElementAndChildIds(newElem, idMap);
          updateIdReferences(newElem, idMap);
          newM.appendChild(newElem);
        }
      }
      
      // Check if this is a partial measure
      const actualDur = getMeasureDuration(newM);
      const expectedDur = getExpectedMeasureDuration(newM);
      if (Math.abs(actualDur - expectedDur) > 0.01) {
        newM.setAttribute('metcon', 'false');
      }
      
      return newM;
    });
  };
  
  const introMeasureRanges = [];
  const introChordPositionRanges = [];
  const introBrackets = meiParsed.querySelectorAll('[ch-intro-bracket]');
  for (const introBracket of introBrackets) {
    const type = introBracket.getAttribute('ch-intro-bracket');
    const tstamp = parseFloat(introBracket.getAttribute('tstamp'));
    const chordPosition = parseFloat(introBracket.getAttribute('ch-chord-position'));
    const measureNumber = introBracket.closest('measure').getAttribute('n');
    
    if (type === 'start') {
      introMeasureRanges.push([[measureNumber, tstamp], null]);
      introChordPositionRanges.push([chordPosition, null]);
    } else {
      introMeasureRanges.at(-1)[1] = [measureNumber, tstamp];
      introChordPositionRanges.at(-1)[1] = chordPosition;
    }
    introBracket.remove();
  }
  
  const introChordPositions = [];
  for (const introChordPositionRange of introChordPositionRanges) {
    for (let cp = introChordPositionRange[0]; cp < introChordPositionRange[1]; cp++) introChordPositions.push(cp);
  }
  
  if (meiParsed.querySelector('section[type="introduction"]') || introMeasureRanges.length === 0) return meiParsed;
  
  // Main extraction logic
  const originalMeasures = Array.from(meiParsed.querySelectorAll('measure'));
  const introSection = meiParsed.createElement('section');
  introSection.setAttribute('type', 'introduction');
  introSection.setAttribute('ch-chord-position', introChordPositions.join(' '));
  
  const idMap = {};
  let n = 1;
  
  // Extract and add all ranges to the section
  const allExtractedMeasures = [];
  for (const [[startM, startTstamp], [endM, endTstamp]] of introMeasureRanges) {
    const extractedMeasures = extractRange(originalMeasures, startM, startTstamp, endM, endTstamp, idMap);
    allExtractedMeasures.push(extractedMeasures);
  }
  
  // Renumber and add measures, setting invisible barlines between consecutive partial measures
  n = renumberAndAppendMeasures(allExtractedMeasures, introSection, n);
  
  // Insert section after scoreDef
  const score = meiParsed.querySelector('score');
  const scoreDef = score.querySelector('scoreDef');
  if (scoreDef) scoreDef.parentNode.insertBefore(introSection, scoreDef.nextSibling);
  
  // Clean up unneeded elements in the introduction
  introSection.querySelectorAll('verse, dir, tempo').forEach(v => v.remove());
  
  // Get all note and chord IDs that exist in the intro section
  const introNoteIds = new Set();
  introSection.querySelectorAll('note[*|id], chord[*|id]').forEach(elem => {
    introNoteIds.add(elem.getAttribute('xml:id'));
  });
  
  // Remove slurs and ties that reference notes outside the intro section
  introSection.querySelectorAll('slur, tie').forEach(elem => {
    const startId = elem.getAttribute('startid')?.replace(/^#/, '');
    const endId = elem.getAttribute('endid')?.replace(/^#/, '');
    
    const hasStart = !startId || introNoteIds.has(startId);
    const hasEnd = !endId || introNoteIds.has(endId);
    
    // Remove if either endpoint is missing
    if (!hasStart || !hasEnd) {
      elem.remove();
    }
  });
  
  // Move tempo to beginning of intro and handle barlines
  const newSectionMeasures = Array.from(introSection.querySelectorAll('measure'));
  const tempo = originalMeasures[0]?.querySelector('tempo');
  if (tempo) {
    newSectionMeasures[0]?.append(tempo);
  }
  
  // Handle barline between intro section and main section
  const lastIntroMeasure = newSectionMeasures.at(-1);
  const firstMainMeasure = originalMeasures[0];
  
  if (lastIntroMeasure && firstMainMeasure) {
    const lastIntroIsPartial = lastIntroMeasure.getAttribute('metcon') === 'false';
    const firstMainIsPartial = firstMainMeasure.getAttribute('metcon') === 'false';
    const firstMainHasNoLeftBarline = !firstMainMeasure.getAttribute('left');
    
    if (lastIntroIsPartial && firstMainIsPartial && firstMainHasNoLeftBarline) {
      lastIntroMeasure.setAttribute('right', 'invis');
    }
  }
  
  // Renumber remaining measures
  originalMeasures.forEach(m => {
    m.setAttribute('n', n++);
  });
  
  return meiParsed;
}

// Build parts if needed
// Parts template examples:
// [chordPosition]:[partsTemplate]#[melodyPart]
// 0:SA+TB#S; 24:SA+TB#T; 36:SA+TB#S (The Morning Breaks, 1985 Hymns)
// 0:Unison; 39:SA+TB (I Know That My Redeemer Lives, 1985 Hymns)
// TTBB#T2 (Brightly Beams Our Father's Mercy, Men's Choir, 1985 Hymns)
// Descant+Unison (I Am a Child of God, 1989 Children's Songbook)
ChScore.prototype._normalizeParts = function () {
  if (this._scoreData.parts.length > 0) {
    this._scoreData.parts = this._scoreData.parts;
  } else if (this._scoreData.partsTemplate) {
    this._scoreData.parts = this._buildPartsFromTemplate(this._scoreData.partsTemplate, this._scoreData.staffNumbers, this._scoreData.numChordPositions, this._scoreData.hasLyrics);
  } else {
    this._scoreData.parts = [
      {
        partId: 'melody',
        name: 'Melody',
        isVocal: true,
        placement: 'auto',
        chordPositionRefs: {
          0: {
            isMelody: true,
            staffNumbers: [1],
            lyricLineIds: null,
          },
        },
      },
      {
        partId: 'accompaniment',
        name: 'Accompaniment',
        isVocal: false,
        placement: 'full',
        chordPositionRefs: {
          0: {
            isMelody: false,
            staffNumbers: this._scoreData.staffNumbers,
            lyricLineIds: null,
          },
        },
      },
    ];
  }
  this._scoreData.partsById = {};
  for (const part of this._scoreData.parts) {
    this._scoreData.partsById[part.partId] = part;
  }
}

ChScore.prototype._buildPartsFromTemplate = function (partsTemplate, staffNumbers, numChordPositions, hasLyrics) {
  // Pad with accompaniment or instrumental staves (will be skipped later if not needed)
  const padChar = hasLyrics ? 'C' : 'I';
  const padding = staffNumbers.map(() => padChar).join('+');
  const likelyMelodyChars = 'MSP';
  const polyphonicChars = 'IC';
  const vocalChars = 'MSATBPD';
  
  const normalizedPartsTemplate = (
    (partsTemplate || padding).replace(/\s/g, '') // Remove whitespace
    .replaceAll('Melody', 'MC') // Melody and accompaniment
    .replaceAll('Soprano', 'S')
    .replaceAll('Alto', 'A')
    .replaceAll('Tenor', 'T')
    .replaceAll('Bass', 'B')
    .replaceAll('Descant', 'D')
    .replaceAll('Obbligato', 'O')
    .replaceAll('Instrumental', 'I')
    .replaceAll('Accompaniment', 'C')
    .replaceAll('Solo', 'MC') // Melody and accompaniment
    .replaceAll('Unison', 'MC') // Melody and accompaniment
    .replaceAll('Two-Part', 'P+P') // Two parts on separate staves
    .replaceAll('Duet', 'PP') // Two parts on the same staff
    .replaceAll('SATB', 'SA+TB') // Two staves
    .replaceAll('SSAA', 'SS+AA') // Two staves
    .replaceAll('AATT', 'AA+TT') // Two staves
    .replaceAll('TTBB', 'TT+BB') // Two staves
    .replaceAll('#;', ';') // Unspecified melody part
  );
  
  // Get parts template chord positions
  const partsTemplates = normalizedPartsTemplate.split(';');
  const partsTemplateChordPositions = [];
  for (let vm = 0; vm < partsTemplates.length; vm++) {
    if (partsTemplates[vm].includes(':')) {
      partsTemplateChordPositions.push(parseInt(partsTemplates[vm].split(':')[0]));
    } else {
      partsTemplates[vm] = `0:${partsTemplates[vm]}`;
      partsTemplateChordPositions.push(0);
    }
  }
  
  function getPartId(char, previousChars, splitPartChars) {
    const charToPartId = {
      'M': 'melody',
      'S': 'soprano',
      'A': 'alto',
      'T': 'tenor',
      'B': 'bass',
      'P': 'part',
      'D': 'descant',
      'O': 'obbligato',
      'I': 'instrumental',
      'C': 'accompaniment',
    };
    let partId = charToPartId[char[0]];
    
    // Handle Soprano 1, Soprano 2, etc.
    let n = null;
    if (char.length > 1 && /\d/.test(char[1])) {
      n = parseInt(char[1]);
    } else if (splitPartChars.includes(char)) {
      n = previousChars.split('').filter(c => c === char).length + 1;
    }
    if (n !== null) partId = `${partId}-${n}`;
    return partId;
  }
  
  // TODO: Support localized part names
  function getPartName(partId) {
    const capitalizedWords = [];
    for (const word of partId.split('-')) {
      const capitalizedWord = word[0].toUpperCase() + (word.length > 1 ? word.slice(1) : '');
      capitalizedWords.push(capitalizedWord);
    }
    return capitalizedWords.join(' ');
  }
  
  // Identify parts that need to be split (ex: Soprano 1 and Soprano 2)
  let splitPartChars = '';
  for (const partsTemplate of partsTemplates) {
    const chars = partsTemplate.split(':').pop().split('#')[0].replace(/\+/g, '');
    for (const char of chars) {
      const count = chars.split('').filter(c => c === char).length;
      if (count > 1 && !splitPartChars.includes(char) && !polyphonicChars.includes(char)) {
        splitPartChars += char;
      }
    }
  }
  
  // Build chord position ranges
  const partInfoByPartId = {};
  for (let vm = 0; vm < partsTemplates.length; vm++) {
    const [chordPositionStr, charsAndMelody] = partsTemplates[vm].split(':');
    const chordPosition = parseInt(chordPositionStr);
    
    // Get melody part
    let chars, melodyChar;
    if (charsAndMelody.includes('#')) {
      [chars, melodyChar] = charsAndMelody.split('#');
    } else {
      chars = charsAndMelody;
      melodyChar = chars.split('').find(char => likelyMelodyChars.includes(char)) || chars[0];
    }
    const melodyPartId = getPartId(melodyChar, '', splitPartChars);
    
    let staffNumber = 1;
    chars = `${chars}+${padding}`;
    for (let cr = 0; cr < chars.length; cr++) {
      const char = chars[cr];
      if (char === '+') {
        staffNumber++;
        if (staffNumbers.includes(staffNumber)) {
          continue;
        } else {
          break;
        }
      }
      const partId = getPartId(char, chars.slice(0, cr), splitPartChars);
      if (!(partId in partInfoByPartId)) {
        partInfoByPartId[partId] = {
          partId: partId,
          name: getPartName(partId),
          isVocal: vocalChars.includes(char),
          placement: polyphonicChars.includes(char) ? 'full' : 'auto',
          chordPositionRefs: {},
        };
      }
      if (!(chordPosition in partInfoByPartId[partId].chordPositionRefs)) {
        partInfoByPartId[partId].chordPositionRefs[chordPosition] = {
          isMelody: partId === melodyPartId,
          staffNumbers: [],
          lyricLineIds: null, // TODO: Fill in lyric line IDs
        };
      }
      partInfoByPartId[partId].chordPositionRefs[chordPosition].staffNumbers.push(staffNumber);
    }
  }
  
  // Build parts list
  const parts = [];
  let accompanimentIndex = null;
  const entries = Object.entries(partInfoByPartId);
  for (let pt = 0; pt < entries.length; pt++) {
    const [partId, partInfo] = entries[pt];
    if (partId === 'accompaniment') accompanimentIndex = pt;
    parts.push(partInfo);
  }
  // Move accompaniment to the end of the list
  if (accompanimentIndex !== null) {
    parts.push(parts.splice(accompanimentIndex, 1)[0]);
  }
  
  return parts;
}

ChScore.prototype._normalizeChordSets = function () {
  // Add default chord set
  const harmElements = this._scoreData.meiParsed.querySelectorAll('harm');
  if (harmElements.length > 0) {
    const defaultChordSet = {
      chordSetId: 'default',
      name: 'Default',
      chordPositionRefs: {},
      svgSymbolsUrl: null,
      chordInfoList: [],
    }
    for (const harmElement of harmElements) {
      const chordInfo = {
        prefix: null,
        text: harmElement.textContent.trim().replace('♭', 'b').replace('♯', '#'),
        svgSymbolId: null,
        measureId: harmElement.closest('measure').getAttribute('xml:id'),
        tstamp: harmElement.getAttribute('tstamp'),
      }
      defaultChordSet.chordInfoList.push(chordInfo);
      if (harmElement.getAttribute('ch-chord-position')) {
        const chordPosition = parseInt(harmElement.getAttribute('ch-chord-position'));
        defaultChordSet.chordPositionRefs[chordPosition] = chordInfo;
      }
    }
    this._scoreData.chordSets.unshift(defaultChordSet);
  }
  this._scoreData.chordSetsById = {};
  for (const chordSet of this._scoreData.chordSets) {
    this._scoreData.chordSetsById[chordSet.chordSetId] = chordSet;
  }
}

// Get verse numbers based on <label> elements
// TODO: Account for verses below
ChScore.prototype._getVerseNumbers = function (meiParsed) {
  const verseNumbers = [];
  let hasVerseNumberMismatch = false;
  let counter = 1;
  const verseLabels = meiParsed.querySelectorAll('verse label');
  for (const verseLabel of verseLabels) {
    const verseNumber = parseInt(verseLabel.textContent.trim().replace(/[().]/g, ''));
    const lineNumber = parseInt(verseLabel.closest('verse').getAttribute('n'));
    if (verseNumber === lineNumber && verseNumber === counter) {
      verseNumbers.push(verseNumber);
      counter++;
    } else {
      hasVerseNumberMismatch = true;
      break;
    }
  }
  // Handle single-verse songs where the verse doesn't have a label
  if (verseNumbers.length === 0) verseNumbers.push(1);
  return hasVerseNumberMismatch ? [] : verseNumbers;
}

ChScore.prototype._markSingleLineChordPositions = function (lyricChordPositionRanges, maxAllowedGap = 3) {
  const lyricLinesByStaffAndCp = {};
  const lyrics = Array.from(this._scoreData.meiParsed.querySelectorAll(':is(note[ch-melody], chord:has([ch-melody])) verse:has(syl:not(:empty))'));
  for (const lyric of lyrics) {
    const chordPosition = parseInt(lyric.closest('[ch-chord-position]').getAttribute('ch-chord-position'));
    const lyricLineId = lyric.getAttribute('ch-lyric-line-id');
    const [staffNumber, lineNumber] = lyricLineId.split('.').map(i => parseInt(i));
    if (!Object.hasOwn(lyricLinesByStaffAndCp, staffNumber)) lyricLinesByStaffAndCp[staffNumber] = {};
    if (!Object.hasOwn(lyricLinesByStaffAndCp[staffNumber], chordPosition)) lyricLinesByStaffAndCp[staffNumber][chordPosition] = new Set();
    lyricLinesByStaffAndCp[staffNumber][chordPosition].add(lineNumber);
  }
  
  let ecpCounter = 0;
  const ecpToCp = {};
  for (const lyricChordPositionRange of lyricChordPositionRanges) {
    for (let cp = lyricChordPositionRange[0]; cp < lyricChordPositionRange[1]; cp++) {
      ecpToCp[ecpCounter] = cp;
      ecpCounter += 1;
    }
  }
  
  const singleLineCpRangesByStaff = {}
  for (const staffNumber of Object.keys(lyricLinesByStaffAndCp)) {
    let firstLyricEcp;
    const noLyricEcps = [];
    const oneLyricEcpRanges = [];
    const expandedChordPositions = Object.keys(ecpToCp).map(ecp => parseInt(ecp));
    for (const ecp of expandedChordPositions) {
      const cp = ecpToCp[ecp];
      if (Object.hasOwn(lyricLinesByStaffAndCp[staffNumber], cp)) {
        if (firstLyricEcp == null) firstLyricEcp = ecp;
        if (lyricLinesByStaffAndCp[staffNumber][cp].size > 1 || oneLyricEcpRanges.length === 0) {
          oneLyricEcpRanges.push({
            start: null,
            end: null,
            lineNumbers: new Set(),
          })
        }
        if (lyricLinesByStaffAndCp[staffNumber][cp].size === 1) {
          if (oneLyricEcpRanges.at(-1).start == null) oneLyricEcpRanges.at(-1).start = ecp;
          oneLyricEcpRanges.at(-1).end = ecp + 1;
          oneLyricEcpRanges.at(-1).lineNumbers.add(lyricLinesByStaffAndCp[staffNumber][cp][0])
        }
      } else {
        noLyricEcps.push(ecp);
      }
    }
    
    // Filter out invalid ranges, expand ranges to include adjacent expanded chord positions with no lyrics
    const filteredEcpRanges = [];
    for (const oneLyricEcpRange of oneLyricEcpRanges) {
      if (!oneLyricEcpRange.start || oneLyricEcpRange.end - oneLyricEcpRange.start <= maxAllowedGap) {
        continue;
      }
      let rangeStart = oneLyricEcpRange.start;
      let rangeEnd = oneLyricEcpRange.end;
      if (rangeStart === firstLyricEcp) while (noLyricEcps.includes(rangeStart - 1)) rangeStart -= 1;
      while (noLyricEcps.includes(rangeEnd)) rangeEnd += 1;
      filteredEcpRanges.push({
        start: rangeStart,
        end: rangeEnd,
        lineNumbers: oneLyricEcpRange.lineNumbers,
      });
      for (let ecp = rangeStart; ecp < rangeEnd; ecp++) {
        this._scoreData.chordPositions[ecpToCp[ecp]].isSingleLine = true;
      }
    }
    singleLineCpRangesByStaff[staffNumber] = filteredEcpRanges;
  }
  
  return singleLineCpRangesByStaff;
}

ChScore.prototype._normalizeSections = function () {
  
  // Generate sections based on lyric stanzas
  const generateSectionsFromLyricStanzas = (lyricStanzas, staffNumbers) => {
    const sections = [];
    let sectionCounter = 0;
    for (const lyricStanza of lyricStanzas) {
      sections.push({
        sectionId: `section-${sectionCounter}`,
        type: lyricStanza.type,
        name: lyricStanza.name,
        marker: lyricStanza.marker,
        placement: lyricStanza.chordPositionRanges.length === 0 ? 'below' : 'inline',
        pauseAfter: false,
        chordPositionRanges: lyricStanza.chordPositionRanges,
        annotatedLyrics: lyricStanza.annotatedLyrics,
      });
      sectionCounter += 1;
    }
    return sections;
  }
  
  // Generate default sections
  const generateDefaultSection = (lyricChordPositionRanges, staffNumbers) => {
    const sections = [];
    const chordPositionRanges = [];
    for (const [start, end] of lyricChordPositionRanges) {
      chordPositionRanges.push({
        start: start,
        end: end,
        staffNumbers: this._scoreData.staffNumbers,
        lyricLineIds: null,
      });
    }
    sections.push({
      sectionId: 'unknown',
      type: 'unknown',
      name: 'Unknown',
      marker: null,
      placement: 'inline',
      pauseAfter: false,
      chordPositionRanges: chordPositionRanges,
      annotatedLyrics: null,
    });
    return sections;
  }
  
  this._scoreData.hasRepeatOrJump = !!this._scoreData.meiParsed.querySelector('repeatMark, coda, segno, ending, measure:is([left="rptstart"], [left="rptboth"], [right="rptend"], [right="rptboth"]), dir:is([type="coda"], [type="tocoda"], [type="segno"], [type="dalsegno"], [type="dacapo"], [type="fine"])')
  
  let hasPrebuiltSections = this._scoreData.sections.length > 0;
  const verseNumbers = this._getVerseNumbers(this._scoreData.meiParsed)
  const introBracketElements = this._scoreData.meiParsed.querySelectorAll('[ch-intro-bracket]');
  const [hasComplexSections, hasInitialChorus, expansionIds] = this._updateExpansionMap(this._scoreData.meiParsed, verseNumbers.length, introBracketElements.length > 0, this._scoreData.hasRepeatOrJump);
  
  let introSection;
  let otherSections = [];
  // Use existing sections
  if (hasPrebuiltSections) {
    introSection = this._scoreData.sections[0].type === 'introduction' ? this._scoreData.sections[0] : null;
    otherSections = introSection ? this._scoreData.sections.slice(1) : this._scoreData.sections;
  // Generate sections based on simple score structure
  } else {
    introSection = this._getIntroSectionFromBrackets(introBracketElements, this._scoreData.staffNumbers);
    if (!hasComplexSections) otherSections = this._generateSectionsFromSimpleScore(verseNumbers, hasInitialChorus);
  }
  
  let firstLyricExpandedChordPosition = 0;
  if (introSection) {
    firstLyricExpandedChordPosition = 0;
    for (const chordPositionRange of introSection.chordPositionRanges) {
      firstLyricExpandedChordPosition += chordPositionRange.end - chordPositionRange.start;
    }
  }
  
  // Get sequential lyric chord position ranges
  const lyricChordPositionRanges = [];
  if (otherSections.length > 0) {
    for (const sectionInfo of otherSections) {
      for (const cpr of sectionInfo.chordPositionRanges) lyricChordPositionRanges.push([cpr.start, cpr.end]);
    }
  } else if (this._scoreData.hasExpansion) {
    const expansion = this._scoreData.meiParsed.querySelector('expansion[plist]');
    const expansionSectionElementIds = expansion.getAttribute('plist').trim().split(' ').map(sid => sid.substring(1));
    for (const expansionSectionElementId of expansionSectionElementIds) {
      const sectionElement = this._scoreData.meiParsed.querySelector(`[*|id="${expansionSectionElementId}"]`);
      const sectionElementChordPositions = sectionElement.getAttribute('ch-chord-position').trim().split(' ').map(cp => parseInt(cp));
      lyricChordPositionRanges.push([sectionElementChordPositions[0], sectionElementChordPositions.at(-1) + 1]);
    }
  } else {
    lyricChordPositionRanges.push([0, this._scoreData.numChordPositions]);
  }
  
  // Get annotated lyric stanzas
  this._markSingleLineChordPositions(lyricChordPositionRanges);
  const lyricStanzas = this._extractLyricStanzas(lyricChordPositionRanges, firstLyricExpandedChordPosition);  
  
  // Generate sections based on lyric stanzas, falling back to default sections
  if (otherSections.length === 0) {
    if (lyricStanzas.length > 0) {
      otherSections = generateSectionsFromLyricStanzas(lyricStanzas, this._scoreData.staffNumbers);
      const firstLyricChordPosition = lyricStanzas[0].chordPositionRanges[0].start;
      if (!introSection && firstLyricChordPosition != null && firstLyricChordPosition !== 0) {
        const introChordPositionRanges = [[0, firstLyricChordPosition]];
        introSection = this._getIntroSectionFromChordPositions(introChordPositionRanges, this._scoreData.staffNumbers, false);
      }
    } else {
      otherSections = generateDefaultSection(lyricChordPositionRanges, this._scoreData.staffNumbers);
    }
  }
  
  // Add annotated lyrics to sections
  let sectionBelowCounter = 0;
  if (lyricStanzas.length > 0) {
    for (let ls = 0; ls < lyricStanzas.length; ls++) {
      const lyricStanza = lyricStanzas[ls];
      const section = otherSections[ls];
      if (section?.type === lyricStanza.type && !section.annotatedLyrics) {
        section.annotatedLyrics = lyricStanza.annotatedLyrics;
      } else if (!section) {
        otherSections.push({
          sectionId: `below-${sectionBelowCounter}`,
          type: lyricStanza.type,
          name: lyricStanza.name,
          marker: lyricStanza.marker,
          placement: 'below',
          pauseAfter: false,
          chordPositionRanges: lyricStanza.chordPositionRanges,
          annotatedLyrics: lyricStanza.annotatedLyrics,
        });
        sectionBelowCounter += 1;
      } else {
        break;
      }
    }
  }
  
  this._scoreData.sections = [];
  if (introSection) this._scoreData.sections.push(introSection);
  for (const otherSection of otherSections) this._scoreData.sections.push(otherSection);
  
  this._scoreData.sectionsById = {};
  for (const section of this._scoreData.sections) {
    this._scoreData.sectionsById[section.sectionId] = section;
  }
  
}

ChScore.prototype._extractLyricStanzas = function (lyricChordPositionRanges, ecpStart) {
  const extractedLyricSyllables = [];
  extractedLyricSyllables.push({
    label: null,
    text: '',
    suffix: '',
    chordPositions: [],
    expandedChordPositions: [],
    lyricLineIds: [],
  });
  let ecpCounter = ecpStart;
  const lyricLineCounters = {};
  for (const lyricChordPositionRange of lyricChordPositionRanges) {
    const [start, end] = lyricChordPositionRange;
    let rangeHasSingleLine = true;
    const verseElementsByChordPosition = {};
    for (let cp = start; cp < end; cp++) {
      verseElementsByChordPosition[cp] = this._scoreData.meiParsed.querySelectorAll(`[ch-chord-position="${cp}"][ch-melody] verse, [ch-chord-position="${cp}"]:has([ch-melody]) verse`);
      if (verseElementsByChordPosition[cp].length > 1) rangeHasSingleLine = false;
    }
    
    // Test cases: 
    // "Gethsemane" (Hymns—For Home and Church), "This Is the Christ" (Hymns—For Home and Church), "Beautiful Savior" (1989 CSB) – complex sections
    // "Have I Done Any Good?" (1985 Hymns) – simple verses and chorus, but verses have chord positions with only one lyric syllable. When there's only one lyric syllable, it should be extracted only in the correct verse.
    for (let cp = start; cp < end; cp++) {
      const chordPositionIsSingleLine = this._scoreData.chordPositions[cp].isSingleLine;
      if (!Object.hasOwn(lyricLineCounters, cp)) lyricLineCounters[cp] = 0;
      lyricLineCounters[cp] += 1;
      const verseElements = verseElementsByChordPosition[cp];
      let verseElement;
      if (verseElements.length > 0) {
        if (chordPositionIsSingleLine || rangeHasSingleLine) {
          verseElement = verseElements[0];
        } else {
          verseElement = Array.from(verseElements).filter(ve => parseInt(ve.getAttribute('n')) === lyricLineCounters[cp])[0];
        }
      }
      
      if (verseElement) {
        const label = verseElement.querySelector('label');
        const text = Array.from(verseElement.querySelectorAll('syl')).map(syl => (syl.textContent.replace(/[\-\‑\s]+$/, '').trim() + ' ').trim()).join(' ').trim() || null;
        extractedLyricSyllables.push({
          label: label ? label.textContent.trim() : null,
          text: text,
          chordPositions: [cp],
          expandedChordPositions: [ecpCounter],
          lyricLineIds: [verseElement.getAttribute('ch-lyric-line-id')],
        });
      } else {
        extractedLyricSyllables.at(-1).chordPositions.push(cp);
        extractedLyricSyllables.at(-1).expandedChordPositions.push(ecpCounter);
      }
      ecpCounter += 1;
    }
  }
  return alignSyllablesToLyrics(this._scoreData.lyricsText, extractedLyricSyllables, this._scoreData.staffNumbers);
  
  // Help from AI: https://claude.ai/chat/71346065-9bc9-4cb9-b8dd-f8718ce5dc10
  // JavaScript version: https://claude.ai/chat/ab222e85-8da6-494d-97dc-f969cb8097f7
  function alignSyllablesToLyrics(expandedLyrics, syllables, staffNumbers) {
    // Normalize text: lowercase, remove accents/punctuation/digits/extra whitespace
    function normalize(text) {
      if (text == null) return null;
      return text.normalize('NFD').replace(/[\u0300-\u036f\p{P}\p{N}]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
    }
    
    // Longest common substring similarity (like Python's SequenceMatcher)
    function similarity(str1, str2) {
      const matrix = Array(str1.length + 1).fill(null)
        .map(() => Array(str2.length + 1).fill(0));
      let maxLen = 0;
      for (let i = 1; i <= str1.length; i++) {
        for (let j = 1; j <= str2.length; j++) {
          if (str1[i - 1] === str2[j - 1]) {
            matrix[i][j] = matrix[i - 1][j - 1] + 1;
            maxLen = Math.max(maxLen, matrix[i][j]);
          }
        }
      }
      const maxLength = Math.max(str1.length, str2.length);
      return maxLength > 0 ? (maxLen * 2) / (str1.length + str2.length) : 0;
    }
    
    const stanzas = [];
    if (!expandedLyrics || !syllables || syllables.length === 0) {
      return stanzas;
    }
    
    // Extract stanza headers
    expandedLyrics = expandedLyrics.replace(/\[.*?\]\n/g, match => {
      match = match.trim().replace('[', '').replace(']', '');
      const splitMatch = match.split(' ');
      stanzas.push({
        name: match,
        type: splitMatch[0].toLowerCase(),
        marker: splitMatch.length > 1 ? splitMatch[1] : null,
        annotatedLyrics: '',
        chordPositionRanges: [],
        expandedChordPositions: [],
      });
      return '';
    });
    
    // Build normalized version with position mapping
    const normChars = [];
    const posMap = [];
    for (let i = 0; i < expandedLyrics.length; i++) {
      const char = expandedLyrics[i];
      if (!/[\u0300-\u036f\p{P}\p{N}]/gu.test(char)) {
        const norm = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (norm && !/\s/.test(norm)) {
          normChars.push(norm.toLowerCase());
          posMap.push(i);
        } else if (/\s/.test(norm) && normChars[normChars.length - 1] !== ' ') {
          normChars.push(' ');
          posMap.push(i);
        }
      }
    }
    
    const normText = normChars.join('');
    let pos = 0;
    const insertions = [];
    let currentStanzaIndex = 0;
    
    // Match each syllable
    for (const syllable of syllables) {
      const normSylText = normalize(syllable.text);
      if (!normSylText) continue;
      
      const windowEnd = Math.min(pos + 20, normText.length);
      let matchPos = normText.indexOf(normSylText, pos);
      let matched = false;
      
      // Try exact match first
      if (matchPos !== -1 && matchPos < windowEnd) {
        matched = true;
      } 
      // Fuzzy match
      else {
        let bestPos = pos;
        let bestScore = 0;
        
        for (let i = pos; i < windowEnd; i++) {
          const score = similarity(normSylText, normText.substring(i, i + normSylText.length));
          if (score > bestScore) {
            bestScore = score;
            bestPos = i;
          }
        }
        
        if (bestScore > 0.6) {
          matchPos = bestPos;
          matched = true;
        }
      }
      
      // Process the match
      if (matched) {
        const originalPos = posMap[matchPos] !== undefined ? posMap[matchPos] : expandedLyrics.length;
        
        // Check if we've crossed into a new stanza (look for \n\n between pos and matchPos)
        const textBetween = expandedLyrics.substring(posMap[pos] || 0, originalPos);
        const stanzaBreaks = (textBetween.match(/\n\n/g) || []).length;
        currentStanzaIndex = Math.min(currentStanzaIndex + stanzaBreaks, stanzas.length - 1);
        
        insertions.push([originalPos, `<span data-ch-chord-position="${syllable.chordPositions.join(' ')}" data-ch-expanded-chord-position="${syllable.expandedChordPositions.join(' ')}" data-ch-lyric-line-id="${syllable.lyricLineIds.join(' ')}"></span>`]);
        
        // Add chord positions to current stanza
        if (currentStanzaIndex < stanzas.length) {
          let previousChordPosition;
          for (const chordPosition of syllable.chordPositions) {
            if (previousChordPosition == null || previousChordPosition + 1 != chordPosition) {
              stanzas[currentStanzaIndex].chordPositionRanges.push({
                start: chordPosition,
                end: chordPosition + 1,
                lyricLineIds: syllable.lyricLineIds,
                staffNumbers: staffNumbers,
              });
            } else {
              stanzas[currentStanzaIndex].chordPositionRanges.at(-1).end = chordPosition + 1;
            }
            previousChordPosition = chordPosition;
          }
          stanzas[currentStanzaIndex].expandedChordPositions.push(...syllable.expandedChordPositions);
        }
        
        pos = matchPos + normSylText.length;
      }
    }
    
    function consolidateChordPositionRanges(chordPositionRanges) {
      const newChordPositionRanges = [];
      for (const chordPositionRange of chordPositionRanges) {
        if (newChordPositionRanges.length > 0 && newChordPositionRanges.at(-1).end === chordPositionRange.start && newChordPositionRanges.at(-1).staffNumbers.toString() === chordPositionRange.staffNumbers.toString() && newChordPositionRanges.at(-1).lyricLineIds.toString() === chordPositionRange.lyricLineIds.toString()) {
          newChordPositionRanges.at(-1).end = chordPositionRange.end;
          for (const lyricLineId of chordPositionRange.lyricLineIds) {
            if (!newChordPositionRanges.at(-1).lyricLineIds.includes(lyricLineId)) {
              newChordPositionRanges.at(-1).lyricLineIds.push(lyricLineId);
            }
          }
        } else {
          newChordPositionRanges.push(chordPositionRange);
        }
      }
      return newChordPositionRanges;
    }
    
    for (const stanza of stanzas) {
      stanza.chordPositionRanges = consolidateChordPositionRanges(stanza.chordPositionRanges);
      stanza.expandedChordPositions = [stanza.expandedChordPositions[0], stanza.expandedChordPositions.at(-1) + 1];
    }
    
    // Insert markers in reverse order
    for (let i = insertions.length - 1; i >= 0; i--) {
      const [idx, marker] = insertions[i];
      expandedLyrics = expandedLyrics.substring(0, idx) + marker + expandedLyrics.substring(idx);
    }
    
    const stanzasText = expandedLyrics.split('\n\n');
    for (let sz = 0; sz < stanzas.length; sz++) {
      stanzas[sz].annotatedLyrics = stanzasText[sz].trim();
    }
    
    return stanzas;
  }

}

ChScore.prototype._updateExpansionMap = function (meiParsed, numVerses, hasIntroBrackets, hasRepeatOrJump) {  
  // Check for complex sections and update expansion map
  // TODO: If expansion map doesn't exist, add it
  let hasComplexSections = false;
  let hasInitialChorus = false;
  let expansionIds = [];
  const measures = meiParsed.querySelectorAll('measure');
  const expansion = meiParsed.querySelector('expansion');
  if (
    hasRepeatOrJump
    || measures[measures.length - 1].getAttribute('right') !== 'end' // Last measure isn't end of song (ex: All Things Bright and Beautiful, 1989 CSB)
    || meiParsed.querySelectorAll('measure[right="end"]').length > 1 // Multiple end barlines (ex: For All the Saints, 1985 Hymns)
    || !measures[0].querySelector('verse') // No lyrics in first measure (ex: Families Can Be Together Forever, 1985 Hymns)
    || (meiParsed.querySelector('verse:not([n="1"])') && numVerses === 0) // Multiple lyric lines but no verse labels
    || numVerses === 0
  ) {
    hasComplexSections = true;
  } else if (expansion) {
    expansionIds = expansion.getAttribute('plist').split(' ');
    
    // Simple song with verses or verses and choruses
    // Examples: "The Spirit of God" (1985 Hymns), "Redeemer of Israel" (1985 Hymns)
    if (expansionIds.length === 1) {
      expansion.setAttribute('type', 'verse-chorus');
      expansion.setAttribute('plist', Array(numVerses).fill(expansionIds[0]).join(' '));
      const sectionElement = meiParsed.querySelector(`[*|id="${expansionIds[0].substring(1)}"]`);
      sectionElement.setAttribute('type', 'verse');
    }
    // Simple song with initial chorus, then verses and choruses
    // Examples: "All Things Bright and Beautiful" (1989 CSB); "He Is Born, the Divine Christ Child" (HHC); "Go Tell It on the Mountain" (HHC)
    else if (expansionIds.length === 2 || (expansionIds.length === 3 && expansionIds[0] === expansionIds[2])) {
      expansion.setAttribute('type', 'chorus-verse-chorus');
      const firstSectionElement = meiParsed.querySelector(`[*|id="${expansionIds[0].substring(1)}"]`);
      firstSectionElement.setAttribute('type', 'chorus');
      const firstSectionMeasures = firstSectionElement.querySelectorAll('measure');
      const secondSectionElement = meiParsed.querySelector(`[*|id="${expansionIds[1].substring(1)}"]`);
      secondSectionElement.setAttribute('type', 'verse');
      const secondSectionMeasures = secondSectionElement.querySelectorAll('measure');
      
      if (firstSectionMeasures[firstSectionMeasures.length - 1].getAttribute('right') === 'end' && 
          secondSectionMeasures[secondSectionMeasures.length - 1].getAttribute('right') === 'dbl') {
        hasInitialChorus = true;
        const repeatedSection = Array(numVerses).fill([expansionIds[0], expansionIds[1]]).flat();
        expansion.setAttribute('plist', [...repeatedSection, expansionIds[0]].join(' '));
      }
    } else {
      expansion.setAttribute('type', 'complex');
      hasComplexSections = true;
    }
    
    // Add repeat barlines
    if (!hasComplexSections && numVerses > 1) {
      measures[0].setAttribute('left', 'rptstart');
      measures[measures.length - 1].setAttribute('right', 'rptend');
    }
    
    // Check for pre-expanded introduction
    // Example: Families Can Be Together Forever (1985 Hymns); I Will Walk with Jesus (HHC)
    if (expansionIds.length > 1 && !hasIntroBrackets) {
      const firstSection = meiParsed.querySelector(`[*|id="${expansionIds[0].substring(1)}"]`);
      const secondSection = meiParsed.querySelector(`[*|id="${expansionIds[1].substring(1)}"]`);
      if (!firstSection.querySelector('verse') && secondSection.querySelector('measure').getAttribute('left') === 'rptstart') {
        firstSection.setAttribute('type', 'introduction');
      }
    }
  }
  
  return [hasComplexSections, hasInitialChorus, expansionIds];
}

ChScore.prototype._getIntroSectionFromBrackets = function (introBracketElements, staffNumbers) {
  const introChordPositionRanges = [];
  for (const introBracketElement of introBracketElements) {
    const chordPosition = parseInt(introBracketElement.getAttribute('ch-chord-position'));
    if (introBracketElement.getAttribute('ch-intro-bracket') === 'start') {
      introChordPositionRanges.push([chordPosition, chordPosition + 1]);
    } else {
      introChordPositionRanges.at(-1)[1] = chordPosition;
    }
  }
  return this._getIntroSectionFromChordPositions(introChordPositionRanges, staffNumbers, true);
}

ChScore.prototype._getIntroSectionFromChordPositions = function (introChordPositionRanges, staffNumbers, pauseAfter) {
  let introSection;
  const chordPositionRanges = [];
  for (const [start, end] of introChordPositionRanges) {
    chordPositionRanges.push({
      start: start,
      end: end,
      staffNumbers: staffNumbers,
      lyricLineIds: [],
    });
  }
  if (chordPositionRanges.length > 0) {
    introSection = {
      sectionId: 'introduction',
      type: 'introduction',
      name: 'Introduction',
      marker: null,
      placement: 'inline',
      pauseAfter: pauseAfter,
      chordPositionRanges: chordPositionRanges,
      annotatedLyrics: null,
    }
  }
  return introSection;
}

ChScore.prototype._generateSectionsFromSimpleScore = function (verseNumbers, hasInitialChorus) {
  const meiParsed = this._scoreData.meiParsed;
  const sections = [];
  
  const staffNumbersWithLyrics = new Set();
  for (const staffNumber of this._scoreData.staffNumbers) {
    if (meiParsed.querySelector(`staff[n="${staffNumber}"] verse`)) {
      staffNumbersWithLyrics.add(staffNumber);
    }
  }

  // Get chorus ranges and line numbers from melody lyrics
  const chorusCpRanges = [];
  const chorusLineNumbers = new Set();
  if (meiParsed.querySelector('verse:not([n="1"])')) {
    const maxAllowedGap = 3;
    const lyricGaps = [[]];
    const lineNumbersByCp = {};
    const lyrics = meiParsed.querySelectorAll(':is(note[ch-melody], chord:has([ch-melody])) verse:has(syl:not(:empty))');
    for (const lyric of lyrics) {
      const chordPosition = lyric.closest('note, chord').getAttribute('ch-chord-position');
      if (!(chordPosition in lineNumbersByCp)) {
        lineNumbersByCp[chordPosition] = [];
      }
      const lineNumber = parseInt(lyric.getAttribute('n'));
      lineNumbersByCp[chordPosition].push(lineNumber);
    }
    for (const [chordPosition, lineNumbers] of Object.entries(lineNumbersByCp)) {
      if (lineNumbers.length === 1) {
        lyricGaps[lyricGaps.length - 1].push(chordPosition);
      } else {
        lyricGaps.push([]);
      }
    }
    for (const lyricGap of lyricGaps) {
      if (lyricGap.length > maxAllowedGap) {
        // Save chorus line numbers
        for (const chordPosition of lyricGap) {
          const lineNumbers = lineNumbersByCp[chordPosition];
          for (const lineNumber of lineNumbers) {
            chorusLineNumbers.add(lineNumber);
          }
        }
        // Handle notes without lyrics at the beginning or end of the song
        if (parseInt(lyricGap[0]) - maxAllowedGap <= 0) {
          lyricGap[0] = '0';
        }
        if (parseInt(lyricGap.at(-1)) + maxAllowedGap > this._scoreData.numChordPositions - 1) {
          lyricGap[lyricGaps.length - 1] = String(this._scoreData.numChordPositions - 1);
        }
        // Save chorus chord position ranges
        const start = parseInt(lyricGap[0]);
        const end = parseInt(lyricGap.at(-1)) + 1;
        chorusCpRanges.push(Array.from({length: end - start}, (_, i) => start + i));
      }
    }
  }
  
  // Get line numbers from secondary lyrics
  const additionalSecondaryLyricLineNumbers = new Set();
  const chorusChordPositions = chorusCpRanges.flat();
  for (const lyric of meiParsed.querySelectorAll('verse[ch-secondary]')) {
    const lineNumber = parseInt(lyric.getAttribute('n'));
    if (chorusChordPositions.includes(lyric.closest('note, chord').getAttribute('ch-chord-position'))) {
      chorusLineNumbers.add(lineNumber);
    } else if (!verseNumbers.includes(lineNumber)) {
      additionalSecondaryLyricLineNumbers.add(lineNumber);
    }
  }
  
  let verseCounter = 0;
  for (const verseNumber of verseNumbers) {
    // Get chord position ranges
    const verseLineNumbers = new Set([verseNumber]);
    if (verseNumber === 1) {
      // Lines that appear under the numbered verses are assumed to correspond to verse 1 (example: secondary lyrics in "Joy to the World", 1985 Hymns)
      for (const num of additionalSecondaryLyricLineNumbers) {
        verseLineNumbers.add(num);
      }
    }
    const chordPositionRanges = [];
    let nextChordPosition = 0;
    let nextChorusCpRangeIndex = 0;
    while (nextChordPosition < this._scoreData.numChordPositions) {
      const cpStart = nextChordPosition;
      let cpEnd = this._scoreData.numChordPositions;
      let lyricLinesIds = [];
      for (const staffNumber of staffNumbersWithLyrics) {
        for (const verseLineNumber of verseLineNumbers) {
          lyricLinesIds.push(`${staffNumber}.${verseLineNumber}`);
        }
      }
      if (nextChorusCpRangeIndex < chorusCpRanges.length) {
        const nextChorusCpRange = chorusCpRanges[nextChorusCpRangeIndex];
        if (nextChorusCpRange[0] === nextChordPosition) {
          cpEnd = nextChorusCpRange[nextChorusCpRange.length - 1] + 1;
          lyricLinesIds = [];
          for (const staffNumber of staffNumbersWithLyrics) {
            for (const chorusLineNumber of chorusLineNumbers) {
              lyricLinesIds.push(`${staffNumber}.${chorusLineNumber}`);
            }
          }
          nextChorusCpRangeIndex++;
        } else {
          cpEnd = nextChorusCpRange[0];
        }
      }
      chordPositionRanges.push({
        start: cpStart,
        end: cpEnd,
        staffNumbers: this._scoreData.staffNumbers,
        lyricLineIds: lyricLinesIds,
      });
      nextChordPosition = cpEnd;
    }
    
    // Add extra chorus for songs with initial chorus
    if (hasInitialChorus && verseNumber === verseNumbers[verseNumbers.length - 1] && chordPositionRanges.length > 1) {
      chordPositionRanges.push(chordPositionRanges[chordPositionRanges.length - 2]);
    }
    
    // Get pause after
    let pauseAfter = true;
    const lastChordPositionElement = meiParsed.querySelector(`[ch-chord-position="${this._scoreData.numChordPositions - 1}"]:is(chord, note, rest)`);
    if (
      verseNumber === verseNumbers[verseNumbers.length - 1] // Last verse
      || lastChordPositionElement.tagName === 'rest' // Last note is a rest
      || !lastChordPositionElement.querySelector('verse') // Last note doesn't have lyrics
      || parseInt(lastChordPositionElement.getAttribute('dur')) < 4 // Last note is longer than a quarter note
    ) {
      pauseAfter = false;
    }
    
    for (let cpr = 0; cpr < chordPositionRanges.length; cpr++) {
      const chordPositionRange = chordPositionRanges[cpr];
      if (chorusChordPositions.includes(chordPositionRange.start)) {
        sections.push({
          sectionId: `chorus-${verseCounter}`,
          type: 'chorus',
          name: 'Chorus',
          marker: null,
          placement: 'inline',
          pauseAfter: cpr === chordPositionRanges.length - 1 ? pauseAfter : false,
          chordPositionRanges: [chordPositionRange],
          annotatedLyrics: null,
        });
      } else {
        verseCounter++;
        sections.push({
          sectionId: `verse-${verseCounter}`,
          type: 'verse',
          name: `Verse ${verseNumber}`,
          marker: verseNumber,
          placement: 'inline',
          pauseAfter: cpr === chordPositionRanges.length - 1 ? pauseAfter : false,
          chordPositionRanges: [chordPositionRange],
          annotatedLyrics: null,
        });
      }
    }
  }
  
  return sections;
}


// Load dependencies
ChScore.prototype._chLoadDependencies = async function () {
  async function verovioInitialized() {
    try {
      let tk = new verovio.toolkit();
      tk = null;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 5));
      return verovioInitialized();
    }
  }
  await Promise.all([
    // TODO: Switch back to official Magenta.js build when a new version is available that fixes clicks in Church Organ soundfont
    // https://github.com/magenta/magenta-js/issues/684
    // import('https://cdn.jsdelivr.net/npm/@magenta/music@1.23.1/es6/core.min.js'),
    import('https://cdn.jsdelivr.net/gh/samuelbradshaw/magenta-js@master/music/es6/core.js'),
    import('https://cdn.jsdelivr.net/npm/verovio@6.0.1/dist/verovio-toolkit-wasm.min.js'),
    verovioInitialized(),
  ]);
  console.info('Chorister.js loaded');
  return true;
}
ChScore.prototype._chDependenciesLoaded = ChScore.prototype._chLoadDependencies()

// Keep track of all ChScore instances
ChScore.prototype._chScores = [];

// Check browser type
ChScore.prototype._supportsCssStylesheetApi = CSSStyleSheet?.prototype?.replaceSync;

// Default score data
ChScore.prototype._defaultInputData = {
  scoreType: 'abc',
  scoreContent: `X:1
    T:Westminster Chimes
    L:1/4
    M:3/4
    K:C
    e c d | G3 | G d e | c3 |]`,
}

// Default Verovio options
// See https://book.verovio.org/toolkit-reference/toolkit-options.html
ChScore.prototype._defaultVerovioOptions = {
  expandNever: true,
  lyricHeightFactor: 1.4,
  header: 'none', footer: 'none',
  lyricSize: 4.5,
  lyricWordSpace: 2.0,
  lyricVerseCollapse: true,
  lyricNoStartHyphen: true,
  lyricTopMinMargin: 8.0,
  mmOutput: false,
  transpose: '',
  pageMarginTop: 0, pageMarginBottom: 0,
  pageMarginLeft: 4, pageMarginRight: 4, // Slight margin to prevent elements at the edge of the score from getting clipped
  adjustPageHeight: true,
  pageHeight: 10000,
  scaleToPageSize: false,
  breaks: 'smart',
  breaksSmartSb: 0.8,
  minLastJustification: 0.4,
  breaksNoWidow: true,
  spacingStaff: 12,
  spacingSystem: 4,
  spacingLinear: 0.25,
  spacingNonLinear: 0.6,
  condense: 'auto',
  svgAdditionalAttribute: [
    // Standard MEI attributes
    'staff@n', 'tie@startid', 'slur@startid',
    // Chorister.js basic attributes
    'chord@ch-chord-position', 'note@ch-chord-position', 'rest@ch-chord-position',
    'dir@ch-chord-position', 'harm@ch-chord-position', 'fermata@ch-chord-position',
    'verse@ch-lyric-line-id',
    'dir@ch-intro-bracket', 'rend@ch-superscript', 'syl@end-underscore',
    // Chorister.js optional attributes
    'chord@ch-expanded-chord-position', 'note@ch-expanded-chord-position', 'rest@ch-expanded-chord-position',
    'dir@ch-expanded-chord-position', 'harm@ch-expanded-chord-position', 'fermata@ch-expanded-chord-position',
    'note@ch-part-id', 'note@ch-melody',
    'rest@ch-part-id', 'rest@ch-melody',
    'verse@ch-section-id', 'verse@ch-secondary', 'verse@ch-chorus',
  ],
};

// Default options
ChScore.prototype._defaultOptions = {
  zoomPercent: 40,
  keySignatureId: null, // null, 
  expandScore: false, // false, 'intro', 'full-score'
  showChordSet: false, // true, false, or chordSetId
  showChordSetImages: false,
  showFingeringMarks: false,
  showMeasureNumbers: false,
  showMelodyOnly: false,
  hiddenSectionIds: [],
  drawBackgroundShapes: [],
  drawForegroundShapes: [],
  customEvents: [],
}

ChScore.prototype._getKeySignatures = function (tonality = 'major') {
  const keySignatures = {
    major: {
      'g-flat-major':  { mxlFifths: '-6', meiSig: '6f', meiPnameAccid: 'gf', midiPitch: 54, tonality: 'major', name: 'G♭ major' },
      'g-major':       { mxlFifths: '1',  meiSig: '1s', meiPnameAccid: 'g',  midiPitch: 55, tonality: 'major', name: 'G major'  },
      'a-flat-major':  { mxlFifths: '-4', meiSig: '4f', meiPnameAccid: 'af', midiPitch: 56, tonality: 'major', name: 'A♭ major' },
      'a-major':       { mxlFifths: '3',  meiSig: '3s', meiPnameAccid: 'a',  midiPitch: 57, tonality: 'major', name: 'A major'  },
      'b-flat-major':  { mxlFifths: '-2', meiSig: '2f', meiPnameAccid: 'bf', midiPitch: 58, tonality: 'major', name: 'B♭ major' },
      'b-major':       { mxlFifths: '5',  meiSig: '5s', meiPnameAccid: 'b',  midiPitch: 59, tonality: 'major', name: 'B major'  },
      'c-flat-major':  { mxlFifths: '-7', meiSig: '7f', meiPnameAccid: 'cf', midiPitch: 59, tonality: 'major', name: 'C♭ major' },
      'c-major':       { mxlFifths: '0',  meiSig: '0',  meiPnameAccid: 'c',  midiPitch: 60, tonality: 'major', name: 'C major'  },
      'c-sharp-major': { mxlFifths: '7',  meiSig: '7s', meiPnameAccid: 'cs', midiPitch: 61, tonality: 'major', name: 'C# major' },
      'd-flat-major':  { mxlFifths: '-5', meiSig: '5f', meiPnameAccid: 'df', midiPitch: 61, tonality: 'major', name: 'D♭ major' },
      'd-major':       { mxlFifths: '2',  meiSig: '2s', meiPnameAccid: 'd',  midiPitch: 62, tonality: 'major', name: 'D major'  },
      'e-flat-major':  { mxlFifths: '-3', meiSig: '3f', meiPnameAccid: 'ef', midiPitch: 63, tonality: 'major', name: 'E♭ major' },
      'e-major':       { mxlFifths: '4',  meiSig: '4s', meiPnameAccid: 'e',  midiPitch: 64, tonality: 'major', name: 'E major'  },
      'f-major':       { mxlFifths: '-1', meiSig: '1f', meiPnameAccid: 'f',  midiPitch: 65, tonality: 'major', name: 'F major'  },
      'f-sharp-major': { mxlFifths: '6',  meiSig: '6s', meiPnameAccid: 'fs', midiPitch: 66, tonality: 'major', name: 'F# major' },
    },
    minor: {
      'g-minor':       { mxlFifths: '-2', meiSig: '2f', meiPnameAccid: 'g',  midiPitch: 55, tonality: 'minor', name: 'G minor'  },
      'g-sharp-minor': { mxlFifths: '5',  meiSig: '5s', meiPnameAccid: 'gs', midiPitch: 56, tonality: 'minor', name: 'G# minor' },
      'g-flat-minor':  { mxlFifths: '-7', meiSig: '7f', meiPnameAccid: 'gf', midiPitch: 56, tonality: 'minor', name: 'A♭ minor' },
      'a-minor':       { mxlFifths: '0',  meiSig: '0',  meiPnameAccid: 'a',  midiPitch: 57, tonality: 'minor', name: 'A minor'  },
      'a-sharp-minor': { mxlFifths: '7',  meiSig: '7s', meiPnameAccid: 'as', midiPitch: 58, tonality: 'minor', name: 'A# minor' },
      'b-flat-minor':  { mxlFifths: '-5', meiSig: '5f', meiPnameAccid: 'bf', midiPitch: 58, tonality: 'minor', name: 'B♭ minor' },
      'b-minor':       { mxlFifths: '2',  meiSig: '2s', meiPnameAccid: 'b',  midiPitch: 59, tonality: 'minor', name: 'B minor'  },
      'c-minor':       { mxlFifths: '-3', meiSig: '3f', meiPnameAccid: 'c',  midiPitch: 60, tonality: 'minor', name: 'C minor'  },
      'c-sharp-minor': { mxlFifths: '4',  meiSig: '4s', meiPnameAccid: 'cs', midiPitch: 61, tonality: 'minor', name: 'C# minor' },
      'd-minor':       { mxlFifths: '-1', meiSig: '1f', meiPnameAccid: 'd',  midiPitch: 62, tonality: 'minor', name: 'D minor'  },
      'd-sharp-minor': { mxlFifths: '6',  meiSig: '6s', meiPnameAccid: 'ds', midiPitch: 63, tonality: 'minor', name: 'D# minor' },
      'e-flat-minor':  { mxlFifths: '-6', meiSig: '6f', meiPnameAccid: 'ef', midiPitch: 63, tonality: 'minor', name: 'E♭ minor' },
      'e-minor':       { mxlFifths: '1',  meiSig: '1s', meiPnameAccid: 'e',  midiPitch: 64, tonality: 'minor', name: 'E minor'  },
      'f-minor':       { mxlFifths: '-4', meiSig: '4f', meiPnameAccid: 'f',  midiPitch: 65, tonality: 'minor', name: 'F minor'  },
      'f-sharp-minor': { mxlFifths: '3',  meiSig: '3s', meiPnameAccid: 'fs', midiPitch: 66, tonality: 'minor', name: 'F# minor' },
    },
  };
  return keySignatures[tonality];
}

ChScore.prototype.getKeySignatureInfo = function () {
  return this._scoreData.keySignatureInfo;
}

// Make Highlighter available to ES module (highlight-helper.mjs)
window.ChScore = ChScore;
