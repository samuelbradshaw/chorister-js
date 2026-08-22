/**
 * Chorister.js
 * https://github.com/samuelbradshaw/chorister-js
 */

'use strict';

/********************** ChScore Initialization **********************/

function ChScore(containerSelector) {
  this._containerSelector = containerSelector;
  this._scoreData = null;
  this._currentOptions = null;
  this._vrvToolkit = null;

  this._container = document.querySelector(this._containerSelector);
  if (!this._container) {
    console.error(`Couldn't find a valid score container that matches "${this._containerSelector}".`);
    return false;
  }

  // Remove the previous score if the container already has one
  if (this._container.score) this._container.score.removeScore();

  // Load CSS styles and event listeners
  this._loadStyles();
  this._loadEventListeners();

  // Register ChScore instance
  this._container.score = this;
}

ChScore.prototype._loadStyles = function () {
  this._stylesheets = {};
  const generalStylesheet = this._addStylesheet('general');
  generalStylesheet.replaceSync(`
    /* Shape styles */
    .ch-staff-label, .ch-chord-position-label, .ch-lyric-line-label {
      opacity: 1;
    }
    .ch-system-rect, .ch-measure-rect, .ch-staff-rect,
    .ch-chord-position-line, .ch-chord-position-rect,
    .ch-note-circle, .ch-lyric-rect {
      opacity: 0;
    }

    /* Layout styles */
    [data-ch-layout] {
      /* Disable default pinch to zoom on the score container so it can be handled by JavaScript */
      touch-action: pan-x pan-y;
    }
    [data-ch-page] {
      font-size: calc(0.025em * var(--ch-scale, 40));
    }
    [data-ch-layout="horizontal-scroll"] [data-ch-svg] {
      overflow: scroll hidden;
    }
    [data-ch-layout="paginated"] {
      overflow: scroll hidden;
      scroll-snap-type: x mandatory;
      display: flex;
      column-gap: 2em;
    }
    [data-ch-layout="paginated"] [data-ch-page] {
      flex: 0 0 auto;
      width: 100%;
      height: 100%;
      scroll-snap-align: start;
      scroll-snap-stop: always;
    }

    /* Print styles */
    [data-ch-layout="print"] [data-ch-page] {
      display: block;
      margin-inline: auto;
      width: 172mm;
      font-size: inherit;
    }
    [data-ch-layout="print"] svg.definition-scale {
      color: black !important;
      fill: black !important;
      stroke: black !important;
    }
    [data-ch-layout="print"] g.ch-shapes > *:not(.ch-staff-label, .ch-chord-position-label, .ch-lyric-line-label) {
      display: none !important;
    }
  `);
}

ChScore.prototype._loadEventListeners = function () {
  // Abort controller can be used to cancel event listeners if the score is removed
  this._controller = new AbortController;

  // Print
  let previousLayout = null;
  globalThis.addEventListener('beforeprint', (event) => {
    // TODO: Add blank space at the top of each page (except for the first page), so that systems on subsequent pages aren't higher than the title when viewing them side-by-side
    previousLayout = this._currentOptions.layout;
    this.setOptions({ layout: 'print' });
  }, { signal: this._controller.signal })
  globalThis.addEventListener('afterprint', (event) => {
    this.setOptions({ layout: previousLayout });
  }, { signal: this._controller.signal })

  // Score tap
  const respondToTap = (event, isLongPress = false) => {
    if (!this._currentOptions?.customEvents?.includes('ch:tap')) return;
    this._container.dispatchEvent(new CustomEvent('ch:tap', { detail: {
      pointData: this._getPointData(event.clientX, event.clientY),
      pointerEvent: event,
      isLongPress: isLongPress,
    } }));
  }

  // Score pointer down
  let downTarget = null;
  let tapTimeoutId = null;
  const respondToPointerDown = (event) => {
    downTarget = event.target;
    tapTimeoutId = setTimeout(() => {
      tapTimeoutId = null;
      respondToTap(event, true);
    }, 500);
  }
  this._container.addEventListener('pointerdown', respondToPointerDown, { signal: this._controller.signal });

  // Score pointer up
  const respondToPointerUp = (event) => {
    clearTimeout(tapTimeoutId);
    if (tapTimeoutId !== null && event.target === downTarget && event.type === 'pointerup') {
      respondToTap(event);
    }
    tapTimeoutId = null;
  }
  this._container.addEventListener('pointerup', respondToPointerUp, { signal: this._controller.signal });
  this._container.addEventListener('pointerleave', respondToPointerUp, { signal: this._controller.signal });

  // Score hover
  let hoverState = {};
  const respondToMouseMove = (event, ignoreThrottle = false) => {
    if (!this._currentOptions?.customEvents?.includes('ch:hover')) return;
    if (!ignoreThrottle && this._isThrottled('mousemove', 100)) return;
    const pointData = this._getPointData(event.clientX, event.clientY);
    const pointDataValues = Object.entries(pointData).map(e => (e ?? '').toString()).join(';');
    const hoverStateValues = Object.entries(hoverState).map(e => (e ?? '').toString()).join(';');
    if (pointDataValues === hoverStateValues) return;
    hoverState = pointData;
    this._container.dispatchEvent(new CustomEvent('ch:hover', { detail: {
      pointData: structuredClone(pointData),
    } }));
  }
  this._container.addEventListener('mousemove', (event) => respondToMouseMove(event), { signal: this._controller.signal });
  this._container.addEventListener('mouseleave', (event) => respondToMouseMove(event, true), { signal: this._controller.signal });

  // Pinch to zoom (general)
  let initialPinchScale = null;
  let targetPinchScale = null;
  const clampScale = (scale) => Math.min(100, Math.max(15, scale));
  const getTouchDistance = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  const getCurrentScale = () => {
    if (Array.isArray(this._currentOptions.scale)) {
      return Number.parseInt(this._container.dataset.chScale);
    } else {
      return this._currentOptions.scale;
    }
  };
  const applyPinchTransform = () => {
    this._container.dataset.chPinch = '';
    if (initialPinchScale != null && targetPinchScale != null) {
      const cssRatio = clampScale(targetPinchScale) / initialPinchScale;
      this._pages[0].style.transformOrigin = 'top left';
      this._pages[0].style.transform = `scale(${cssRatio})`;
      this._container.style.overflow = 'clip';
    }
  };
  const finalizePinch = () => {
    this._pages[0].style.transform = '';
    this._pages[0].style.transformOrigin = '';
    this._container.style.overflow = '';
    initialPinchScale = null;
    if (targetPinchScale != null) {
      const clamped = clampScale(targetPinchScale);
      targetPinchScale = null;
      if (Math.round(clamped) !== getCurrentScale()) {
        this.setOptions({ scale: clamped });
      }
    }
    this._container.removeAttribute('data-ch-pinch');
  };

  // Pinch to zoom (touch screens)
  let pinchStartDistance = null;
  this._container.addEventListener('touchstart', (event) => {
    if (event.touches.length === 2) {
      pinchStartDistance = getTouchDistance(event.touches[0], event.touches[1]);
      initialPinchScale = getCurrentScale();
    }
  }, { signal: this._controller.signal });
  this._container.addEventListener('touchmove', (event) => {
    if (event.touches.length === 2 && pinchStartDistance != null) {
      event.preventDefault();
      const ratio = getTouchDistance(event.touches[0], event.touches[1]) / pinchStartDistance;
      targetPinchScale = initialPinchScale * ratio;
      applyPinchTransform();
    }
  }, { passive: false, signal: this._controller.signal });
  const resetTouch = () => { pinchStartDistance = null; finalizePinch(); };
  this._container.addEventListener('touchend', resetTouch, { signal: this._controller.signal });
  this._container.addEventListener('touchcancel', resetTouch, { signal: this._controller.signal });

  // Pinch to zoom (Safari trackpad)
  let gestureActive = false;
  this._container.addEventListener('gesturestart', (event) => {
    event.preventDefault();
    gestureActive = true;
    initialPinchScale = getCurrentScale();
  }, { passive: false, signal: this._controller.signal });
  this._container.addEventListener('gesturechange', (event) => {
    event.preventDefault();
    if (initialPinchScale != null) {
      targetPinchScale = initialPinchScale * event.scale;
      applyPinchTransform();
    }
  }, { passive: false, signal: this._controller.signal });
  this._container.addEventListener('gestureend', (event) => {
    event.preventDefault();
    gestureActive = false;
    finalizePinch();
  }, { passive: false, signal: this._controller.signal });

  // Pinch to zoom (Chrome/Firefox trackpad) and ctrl+scroll (all browsers)
  let wheelPinchFrameId = null;
  this._container.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (gestureActive) return; // Safari gesture is handling the zoom
    if (initialPinchScale == null) initialPinchScale = getCurrentScale();
    if (targetPinchScale == null) targetPinchScale = getCurrentScale();
    targetPinchScale += -event.deltaY * 0.3; // Decimal can be adjusted to tune sensitivity
    targetPinchScale = clampScale(targetPinchScale);
    applyPinchTransform();
    // Finalize after a pause in wheel events
    clearTimeout(wheelPinchFrameId);
    wheelPinchFrameId = setTimeout(finalizePinch, 200);
  }, { passive: false, signal: this._controller.signal });

  // Score container resize
  this._resizeObserver = new ResizeObserver(this._debounce((entries) => {
    if (!this._scoreData) return;
    for (const entry of entries) {
      const width = Math.round(entry.borderBoxSize[0].inlineSize);
      const height = Math.round(entry.borderBoxSize[0].blockSize);
      const fixedHeight = (Array.isArray(this._currentOptions.scale) || this._currentOptions.layout === 'paginated');
      if (width !== Number.parseInt(this._container.dataset.chWidth) || (fixedHeight && height !== Number.parseInt(this._container.dataset.chHeight))) {
        this.setOptions(this._currentOptions);
      }
      this._container.dataset.chWidth = width;
      this._container.dataset.chHeight = height;
    }
  }, 100));
  this._resizeObserver.observe(this._container, { box: 'border-box' });

  // Score container page change
  this._pageObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
      } else {
        entry.target.classList.remove('active');
      }
    }
    if (this._currentOptions.customEvents.includes('ch:pagechange')) {
      const pageState = this.getPageState();
      if (pageState.currentPageNumber != null) {
        this._container.dispatchEvent(new CustomEvent('ch:pagechange', { detail: {
          pageState: pageState,
        } }));
      }
    }
  }, { root: this._container, threshold: 0.75 });
}


/********************** Public methods **********************/

ChScore.prototype.load = async function (format, { scoreId = null, scoreUrl = null, midiUrl = null, lyricsUrl = null, scoreContent = null, midiNoteSequence = null, lyricsText = null, parts = null, partsTemplate = null, sections = null, chordSets = null, fermatas = null }, options = this._defaultOptions) {
  this._container.dataset.chStatus = 'preparing';
  if (!format || !(scoreUrl || scoreContent)) {
    console.error(`Score data is incomplete: format and scoreUrl (or scoreContent) are required. Loading default score.`);
    format = this._defaultInputData.format;
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
        scoreContent = await (format === 'mxl' ? response.arrayBuffer() : response.text());
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

  // Instantiate Verovio toolkit
  this._container.dataset.chStatus = 'processing';
  this._vrvToolkit = new verovio.toolkit();
  this.setOptions(options, false);

  // Attempt to unzip MXL to MusicXML (will be a no-op in certain environments)
  if (scoreContent instanceof ArrayBuffer) {
    scoreContent = await this._unzipMusicXml(scoreContent) ?? scoreContent;
  }

  // Load score into Verovio
  if (scoreContent instanceof ArrayBuffer) {
    // MXL (compressed MusicXML)
    this._vrvToolkit.loadZipDataBuffer(scoreContent);
  } else {
    // MusicXML, MEI, ABC, Humdrum, or PAE string
    if (format === 'abc') {
      scoreContent = scoreContent.replace(/^\s+/gm, '');
    } else if (format === 'musicxml' || format === 'mxl') {
      scoreContent = this._fixIntroBrackets(scoreContent);
      scoreContent = this._fixLyricStyling(scoreContent);
      scoreContent = this._fixCreditPages(scoreContent);
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

  // Process MEI, draw SVG, and load MIDI
  this._parseAndAnnotateMei();
  // TODO: Transposition doesn't take effect when setOptions is called above, because the MEI isn't parsed yet. Calling setOptions again here fixes it, but I'd like to find a cleaner fix.
  if (this._currentOptions.keySignatureId) this.setOptions(this._currentOptions, false);
  this._drawScore();
  this._loadMidi();

  if (this._currentOptions.customEvents.includes('ch:scoreload')) {
    this._container.dispatchEvent(new CustomEvent('ch:scoreload', { detail: {
      scoreData: this._scoreData,
    } }));
  }
  return this._scoreData;
}

ChScore.prototype.setOptions = function (optionsToUpdate, redraw = true) {
  const updatedOptionKeys = [];
  this._currentOptions = this._currentOptions ?? {};
  for (const key of Object.keys(this._defaultOptions)) {
    // Make sure current options has correct signature (based on default options)
    this._currentOptions[key] = this._currentOptions[key] ?? this._defaultOptions[key];
    // Update option values
    if (Object.hasOwn(optionsToUpdate, key)) {
      // Normalize scale option
      if (key === 'scale') {
        let scale = optionsToUpdate.scale;
        if (Array.isArray(optionsToUpdate.scale)) {
          scale = [Math.round(Number.parseFloat(scale.at(0))), Math.round(Number.parseFloat(scale.at(-1)))];
          if (scale[0] === scale[1]) scale = scale[0] ?? optionsToUpdate.scale;
        } else {
          scale = Math.round(Number.parseFloat(optionsToUpdate.scale));
        }
        optionsToUpdate.scale = scale;
      }
      // Track which values changed
      if ((optionsToUpdate[key] ?? '').toString() !== (this._currentOptions[key] ?? '').toString()) {
        updatedOptionKeys.push(key);
        this._currentOptions[key] = optionsToUpdate[key];
      }
    }
  }

  // Add attributes: @data-ch-layout, @data-ch-scale-to-fit
  this._container.dataset.chLayout = this._currentOptions.layout;
  this._container.dataset.chScaleToFit = Array.isArray(this._currentOptions.scale);

  // Get default Verovio options
  // If scale option is an array (min and max values), final scale is calculated when drawing the SVG
  const verovioOptions = structuredClone(this._defaultVerovioOptions);
  verovioOptions.scale = Array.isArray(this._currentOptions.scale) ? null : this._currentOptions.scale;
  verovioOptions.pageWidth = Math.max(this._container.offsetWidth, 100);

  // Set page size and scale
  if (this._currentOptions.layout === 'print') {
    verovioOptions.mmOutput = true;
    verovioOptions.scale = 100;
    verovioOptions.pageWidth = 172 * 10; // 172mm (A4-210mm paper size, minus 19mm margin)
    verovioOptions.systemMaxPerPage = 1; // Separate page (SVG element) for each system, so systems wrap cleanly to the next printed page (instead of being split between pages)
  } else if (this._currentOptions.layout === 'vertical-scroll') {
    verovioOptions.pageHeight = 60000; // Maximum allowed by Verovio
  } else if (this._currentOptions.layout === 'horizontal-scroll') {
    verovioOptions.breaks = 'none'
  } else if (this._currentOptions.layout === 'paginated') {
    verovioOptions.systemMaxPerPage = 1;
    verovioOptions.pageHeight = Math.max(this._container.offsetHeight, 100);
  }
  this._container.dataset.chScale = Number.parseInt(verovioOptions.scale);
  this._container.style.setProperty('--ch-scale', Number.parseInt(verovioOptions.scale));

  // Set margin and spacing
  const shapeClassNames = (this._currentOptions.drawBackgroundShapes || []).concat(this._currentOptions.drawForegroundShapes || []);
  if (shapeClassNames.length > 0) {
    if (shapeClassNames.includes('ch-chord-position-label')) {
      verovioOptions.spacingSystem = Math.max(verovioOptions.spacingSystem, 12);
      verovioOptions.pageMarginBottom = Math.max(verovioOptions.pageMarginBottom, 20);
    }
    if (shapeClassNames.includes('ch-lyric-line-label')) {
      verovioOptions.pageMarginLeft = Math.max(verovioOptions.pageMarginLeft, 90);
    }
    if (shapeClassNames.includes('ch-staff-label')) {
      verovioOptions.pageMarginLeft = Math.max(verovioOptions.pageMarginLeft, 150);
    }
  }
  if (this._currentOptions.showChordSet && this._currentOptions.showChordSetImages) {
    verovioOptions.spacingLinear = 1.0;
    verovioOptions.spacingNonLinear = 0.5;
    verovioOptions.spacingSystem += 22;
    verovioOptions.pageMarginTop += 220;
  }
  if (this._currentOptions.showMeasureNumbers) {
    verovioOptions.pageMarginLeft = Math.max(verovioOptions.pageMarginLeft, 30);
    verovioOptions.pageMarginRight = Math.max(verovioOptions.pageMarginRight, 30);
  }
  if (this._currentOptions.showMelodyOnly) {
    verovioOptions.spacingSystem += 5;
    verovioOptions.pageMarginBottom += 20;
  }

  // Transpose
  const keySignatureInfo = this._scoreData?.keySignatureInfo;
  if (this._currentOptions.keySignatureId && keySignatureInfo) {
    const nearbyKeyIndex = keySignatureInfo.nearbyKeySignatures.findIndex(ks => ks.keySignatureId === this._currentOptions.keySignatureId);
    const nearbyKeyInfo = keySignatureInfo.nearbyKeySignatures[nearbyKeyIndex];
    // TODO: Figure out why nearbyKeyInfo is undefined when transposing "His Voice As the Sound" (HHC)
    if (nearbyKeyInfo) {
      const directionOperator = nearbyKeyIndex < 7 ? '-' : nearbyKeyIndex > 7 ? '+' : '';
      verovioOptions.transpose = directionOperator + nearbyKeyInfo.meiPnameAccid;
    }
  }

  this._vrvToolkit.resetOptions();
  this._vrvToolkit.setOptions(verovioOptions);

  // Reload score, if it was loaded previously
  if (this._vrvToolkit.getPageCount() > 0) {
    if (updatedOptionKeys.some(key => ['showMelodyOnly', 'showChordSet', 'showChordSetImages', 'showFingeringMarks', 'showMeasureNumbers', 'hideSectionIds', 'expandScore'].includes(key))) {
      this._updateMei();
    }

    // Some options require loading the data into Verovio again
    // See https://github.com/rism-digital/verovio/discussions/4142
    if (verovioOptions.transpose !== this._previousVerovioOptions.transpose || verovioOptions.expand !== this._previousVerovioOptions.expand || verovioOptions.expandNever !== this._previousVerovioOptions.expandNever || verovioOptions.expandAlways !== this._previousVerovioOptions.expandAlways) {
      this._vrvToolkit.loadData(this._scoreData.meiString);
    } else {
      this._vrvToolkit.redoLayout();
    }

    if (redraw) this._drawScore();
  }

  this._previousVerovioOptions = verovioOptions;
}

ChScore.prototype.getOptions = function () {
  return structuredClone(this._currentOptions);
}

ChScore.prototype.getScoreData = function () {
  return this._scoreData;
}

ChScore.prototype.getScoreContainer = function () {
  return this._container;
}

ChScore.prototype.getKeySignatureInfo = function () {
  return this._scoreData.keySignatureInfo;
}

ChScore.prototype.getPageState = function () {
  let currentPageNumber;
  const pageNumbers = [];
  for (const page of this._pages) {
    const pageNumber = Number.parseInt(page.dataset.chPage);
    if (page.classList.contains('active')) currentPageNumber = pageNumber;
    pageNumbers.push(pageNumber);
  }
  return {
    currentPageNumber: currentPageNumber,
    pageNumbers: pageNumbers,
  }
}

ChScore.prototype.jumpToPage = function (pageNumber, animate = false) {
  const pageState = this.getPageState();
  const currentPageIndex = pageState.pageNumbers.indexOf(pageState.currentPageNumber);
  if (currentPageIndex == null) return;
  if (pageNumber === 'previous') {
    pageNumber = pageState.pageNumbers.at(Math.max(currentPageIndex - 1, 0));
  } else if (pageNumber === 'next') {
    pageNumber = pageState.pageNumbers.at(currentPageIndex + 1) ?? pageState.pageNumbers.at(-1);
  }
  const scrollBehavior = animate ? 'smooth' : 'instant';
  this._container.querySelector(`[data-ch-page="${pageNumber}"]`).scrollIntoView({ behavior: scrollBehavior, block: 'nearest', inline: 'center', container: 'nearest' });
}

ChScore.prototype.getMidi = function (format = 'note-sequence') {
  const noteSequence = this._scoreData.midiNoteSequence;
  if (format === 'note-sequence') {
    return noteSequence;
  } else {
    const byteArray = core.sequenceProtoToMidi(noteSequence);
    if (format === 'blob') {
      return new Blob([byteArray], { type: 'audio/midi' });
    } else if (format === 'array-buffer') {
      return byteArray.toArray();
    }
  }
}

ChScore.prototype.removeScore = function () {
  this._removeStylesheets();
  this._resizeObserver?.disconnect();
  this._pageObserver?.disconnect();
  this._controller?.abort();
  this._container.innerHTML = '';
  const attributeNames = this._container.getAttributeNames();
  for (const attributeName of attributeNames) {
    if (attributeName.startsWith('data-ch-')) {
      this._container.removeAttribute(attributeName);
    }
  }
  this._container.style.removeProperty('--ch-scale');
  this._container.score = undefined;
}


/********************** Private methods: loading **********************/

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

  if (this._currentOptions.customEvents.includes('ch:midiready')) {
    this._container.dispatchEvent(new CustomEvent('ch:midiready', { detail: {
      midiNoteSequence: midiNoteSequence,
    } }));
  }
}

// Move credits onto page 1. Verovio only turns page 1 credits into <pgHead>/<pgFoot>
// and drops the rest, which loses verses printed below the music on a later page.
// Chorister reads those verses out of the metadata and then removes pgHead and pgFoot
// before drawing, so nothing is rendered twice.
ChScore.prototype._fixCreditPages = function (musicXml) {
  if (!musicXml.includes('<credit')) return musicXml;

  const parsed = (new DOMParser()).parseFromString(musicXml, 'text/xml');
  if (parsed.querySelector('parsererror')) return musicXml;

  let changed = false;
  for (const credit of parsed.querySelectorAll('credit')) {
    if (credit.getAttribute('page') === '1') continue;
    credit.setAttribute('page', '1');
    changed = true;
  }

  return changed ? (new XMLSerializer()).serializeToString(parsed) : musicXml;
}

// Convert bold and italic font names to standard font style and weight attributes
ChScore.prototype._fixLyricStyling = function (musicXml) {
  if (!musicXml.includes('<lyric')) return musicXml;

  const parsed = (new DOMParser()).parseFromString(musicXml, 'text/xml');
  if (parsed.querySelector('parsererror')) return musicXml;

  let changed = false;
  for (const text of parsed.querySelectorAll('lyric > text')) {
    const fontFamily = (text.getAttribute('font-family') || '').toLowerCase();
    if (!text.getAttribute('font-style') && fontFamily.includes('italic')) {
      text.setAttribute('font-style', 'italic');
      changed = true;
    }
    if (!text.getAttribute('font-weight') && fontFamily.includes('bold')) {
      text.setAttribute('font-weight', 'bold');
      changed = true;
    }
  }

  return changed ? (new XMLSerializer()).serializeToString(parsed) : musicXml;
}

// Move intro brackets (⌜ ⌝) to the correct document order (based on x-position) relative to surrounding notes. When converting MusicXML to MEI, Verovio uses document order to determine element position.
ChScore.prototype._fixIntroBrackets = function (musicXml) {
  if (!musicXml.includes('⌜') && !musicXml.includes('⌝')) return musicXml;

  const parsed = (new DOMParser()).parseFromString(musicXml, 'text/xml');
  if (parsed.querySelector('parsererror')) return musicXml;

  const adjacentNote = (element, direction) => {
    let sibling = element[direction];
    while (sibling && sibling.nodeName !== 'note') sibling = sibling[direction];
    return sibling;
  }
  const previousNote = (element) => adjacentNote(element, 'previousElementSibling');
  const nextNote = (element) => adjacentNote(element, 'nextElementSibling');

  let moved = false;
  for (const direction of parsed.querySelectorAll('direction')) {
    if (!['⌜', '⌝'].includes(direction.textContent.trim())) continue;
    const positioned = direction.querySelector('[default-x]');
    const bracketX = positioned ? Number.parseFloat(positioned.getAttribute('default-x')) : null;
    if (bracketX === null || Number.isNaN(bracketX)) continue;

    for (let note = previousNote(direction); note && Number.parseFloat(note.getAttribute('default-x')) > bracketX; note = previousNote(direction)) {
      note.parentNode.insertBefore(direction, note);
      moved = true;
    }
    for (let note = nextNote(direction); note && Number.parseFloat(note.getAttribute('default-x')) < bracketX; note = nextNote(direction)) {
      note.parentNode.insertBefore(direction, note.nextSibling);
      moved = true;
    }
  }

  return moved ? (new XMLSerializer()).serializeToString(parsed) : musicXml;
}

// Get metadata from the MEI fileDesc, pgHead, and pgFoot elements
ChScore.prototype._getScoreMetadata = function (meiParsed) {

  // <lb> is a line break; other elements (<rend>, <ref>, ...) only wrap text
  const getText = (element) => {
    if (!element) return '';
    let text = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
      else if (node.nodeName === 'lb') text += '\n';
      else text += getText(node);
    }
    // Clean up whitespace
    return text
      .split('\n').map(line => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n')
      .replace(/^\n+|\n+$/g, '');
  }

  const getTextBlocks = (containerName) => {
    const blocks = [];
    for (const container of meiParsed.querySelectorAll(containerName)) {
      for (const rend of container.querySelectorAll(':scope > rend')) {
        const text = getText(rend);
        if (!text) continue;
        blocks.push({
          text: text,
          halign: rend.getAttribute('halign'),
          valign: rend.getAttribute('valign'),
          elementId: rend.getAttribute('xml:id'),
        });
      }
    }
    return blocks;
  }

  const contributors = [];
  for (const persName of meiParsed.querySelectorAll('fileDesc respStmt persName')) {
    const name = getText(persName);
    if (name) contributors.push({ role: persName.getAttribute('role'), name: name });
  }

  const date = meiParsed.querySelector('fileDesc pubStmt date');
  const header = getTextBlocks('pgHead');
  const footer = getTextBlocks('pgFoot');

  return {
    title: getText(meiParsed.querySelector('fileDesc titleStmt title')) || null,
    contributors: contributors,
    date: date ? (date.getAttribute('isodate') ?? getText(date)) : null,
    distributor: getText(meiParsed.querySelector('fileDesc pubStmt distributor')) || null,
    availability: getText(meiParsed.querySelector('fileDesc pubStmt availability')) || null,
    header: header,
    footer: footer,
    stanzas: header.concat(footer)
      .filter(block => /^\s*\d+\s*[.)]/.test(block.text))
      .map(block => block.text),
  };
}

// Extract MusicXML from compressed MXL file so it can be processed before feeding it into Verovio
ChScore.prototype._unzipMusicXml = async function (arrayBuffer) {
  if (typeof DecompressionStream === 'undefined' || typeof Response === 'undefined') return null;

  const CENTRAL_DIRECTORY_END = 0x06054b50;
  const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const decoder = new TextDecoder();

  // Entries are listed in the central directory, which is found through the end-of-central-directory record at the end of the file (after any comment)
  let directoryEnd = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 22 - 0xffff); offset--) {
    if (view.getUint32(offset, true) === CENTRAL_DIRECTORY_END) { directoryEnd = offset; break; }
  }
  if (directoryEnd === -1) return null;

  const entryCount = view.getUint16(directoryEnd + 10, true);
  let entryOffset = view.getUint32(directoryEnd + 16, true);
  for (let entry = 0; entry < entryCount; entry++) {
    if (view.getUint32(entryOffset, true) !== CENTRAL_DIRECTORY_ENTRY) return null;
    const method = view.getUint16(entryOffset + 10, true);
    const compressedSize = view.getUint32(entryOffset + 20, true);
    const nameLength = view.getUint16(entryOffset + 28, true);
    const extraLength = view.getUint16(entryOffset + 30, true);
    const commentLength = view.getUint16(entryOffset + 32, true);
    const localOffset = view.getUint32(entryOffset + 42, true);
    const name = decoder.decode(bytes.subarray(entryOffset + 46, entryOffset + 46 + nameLength));
    entryOffset += 46 + nameLength + extraLength + commentLength;

    // Skip META-INF and other non-MusicXML files
    if (name.startsWith('META-INF') || !/\.(musicxml|xml)$/i.test(name)) continue;

    // Sizes in the local header can be zeroed out, so use the central directory's
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);

    if (method === 0) return decoder.decode(compressed); // stored
    if (method !== 8) return null; // MXL writers only ever deflate
    const inflated = new Response(compressed).body.pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(inflated).text();
  }

  return null;
}

// A round marks where each voice enters with a circled digit, engraved as a dingbat
// circled digit (➀–➈). Not to be confused with a verse marker ("2.").
ChScore.prototype._roundMarkerPattern = /^[➀-➈]$/;

ChScore.prototype._parseAndAnnotateMei = function () {
  this._scoreData.meiParsed = (new DOMParser()).parseFromString(this._scoreData.meiStringOriginal, 'text/xml');
  this._scoreData.scoreMetadata = this._getScoreMetadata(this._scoreData.meiParsed);

  // Enable collapsing empty staves. Example: "True to the Faith" (1985 Hymns).
  for (const scoreDef of this._scoreData.meiParsed.querySelectorAll('scoreDef')) {
    scoreDef.setAttribute('optimize', 'true');
  }

  // Replace page breaks with system breaks
  // When printing, Verovio page height options are set so that each system is drawn as a separate SVG element. This allows the sheet music to flow between pages more cleanly. However, when Verovio is set to respect encoded page and system breaks, page height options are ignored. Replacing page breaks with system breaks allows the page height options for printing to work as expected.
  const pageBreaks = this._scoreData.meiParsed.querySelectorAll('pb');
  for (const pageBreak of pageBreaks) {
    const systemBreak = this._createMeiElement(this._scoreData.meiParsed, 'sb');
    Array.from(pageBreak.attributes).forEach(attribute => systemBreak.setAttribute(attribute.name, attribute.value));
    pageBreak.parentNode.replaceChild(systemBreak, pageBreak);
  }

  // Normalize layers (layers in each staff should be numbered starting at 1). Layer numbers are used when calculating which part a note belongs to. Example of a song that needs normalization: "Our Hearts Are Turning" (SingPraises.net Collection) (MusicXML exported from MuseScore; the second staff has layer numbers 5 and 6).
  const hasSuspiciousLayerNumbers = this._scoreData.meiParsed.querySelector('layer:not([n="1"], [n="2"])');
  if (hasSuspiciousLayerNumbers) {
    for (const staff of this._scoreData.meiParsed.querySelectorAll('staffDef')) {
      const staffNumber = Number.parseInt(staff.getAttribute('n'));
      const layersByNumber = {}
      for (const layer of this._scoreData.meiParsed.querySelectorAll(`staff[n="${staffNumber}"] layer`)) {
        const layerNumber = Number.parseInt(layer.getAttribute('n'));
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

  // Correct syllables that carry a verse number before anything reads them, starting
  // with the syllable text gathered below
  this._normalizeLyricVerseNumbers(this._scoreData.meiParsed);

  // Gather information about each note and rest
  this._scoreData.notesAndRestsById = {}
  const tiedNoteEndIds = new Set(Object.values(tiedNotes));
  const notesAndRests = this._scoreData.meiParsed.querySelectorAll('note, rest');
  for (const meiElement of notesAndRests) {
    const elementId = meiElement.getAttribute('xml:id');
    const meiChordElement = meiElement.closest('chord') ?? null;
    const meiBeamElement = meiElement.closest('beam') ?? null;
    const meiLayerElement = meiElement.closest('layer');
    const meiStaffElement = meiElement.closest('staff');
    const meiMeasureElement = meiElement.closest('measure');
    const isTiedNote = tiedNoteEndIds.has(elementId);
    const isRest = meiElement.matches('rest');
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
      pitch: this._getMeiPitch(meiElement),
      lyricSyllables: lyricSyllables,
      staffNumber: Number.parseInt(meiStaffElement.getAttribute('n')),
      layerNumber: Number.parseInt(meiLayerElement.getAttribute('n')),
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
    if (element.matches('measure')) {
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
    } else if (element.matches('sb')) {
      systemCounter += 1;
    } else {
      // Time signature change
      timeSignature[0] = Number.parseInt(element.getAttribute('count') ?? element.getAttribute('meter.count') ?? timeSignature[0]);
      timeSignature[1] = Number.parseInt(element.getAttribute('unit') ?? element.getAttribute('meter.unit') ?? timeSignature[1]);
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

  const staffPartIdsCache = new Map();
  function getStaffPartIds(staffNumber, chordPosition, parts) {
    const cacheKey = `${chordPosition}:${staffNumber}`;
    const cached = staffPartIdsCache.get(cacheKey);
    if (cached) return [cached[0].map(staffPartIds => [...staffPartIds]), cached[1]];

    const partIdsDict = { 1: [], 2: [], 3: [], 4: [] };
    const fullPartIds = [];
    const melodyPartIds = [];
    let autoPlacementCounter = 1;

    for (const part of parts) {
      const partId = part.partId;
      let chordPositionRefInfo = null;
      const refChordPositions = Object.keys(part.chordPositionRefs);
      for (let rcp = refChordPositions.length - 1; rcp >= 0; rcp--) {
        if (refChordPositions[rcp] <= chordPosition) {
          chordPositionRefInfo = part.chordPositionRefs[refChordPositions[rcp]];
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
    while (partIds.length > 1 && partIds.at(-1).length === 0) partIds.pop();

    staffPartIdsCache.set(cacheKey, [partIds, melodyPartIds]);
    return [partIds.map(cachedPartIds => [...cachedPartIds]), melodyPartIds];
  }

  // Build an element ID index for faster repeated lookup
  const elementsById = new Map();
  for (const element of this._scoreData.meiParsed.querySelectorAll('[*|id]')) {
    elementsById.set(element.getAttribute('xml:id'), element);
  }

  const vrvTimemap = this._vrvToolkit.renderToTimemap({ includeRests: true, includeMeasures: true, });
  if (!vrvTimemap || vrvTimemap.length === 0) {
    console.error('Error: Verovio returned an empty or invalid timemap. The score data may be malformed.');
    return;
  }
  this._scoreData.staffNumbers = Array.from(this._scoreData.meiParsed.querySelectorAll('staffDef')).map(sf => Number.parseInt(sf.getAttribute('n')));
  this._scoreData.hasLyrics = this._scoreData.meiParsed.querySelector('verse') !== null;
  const chordPositionIndex = this._indexChordPositions(vrvTimemap);
  this._scoreData.numChordPositions = chordPositionIndex.qstamps.length - 1;
  this._normalizeParts(chordPositionIndex);

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
      previousSectionElement = elementsById.get(entry.measureOn).closest('section, ending');
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
        let positionInChord = null;
        const layerNumber = Number.parseInt(note.meiElement.closest('layer').getAttribute('n'));
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

        if (melodyPartIds.length && note.partIds.some(partId => melodyPartIds.includes(partId))) {
          // Multiple parts can be flagged isMelody at once for a 'Two-Part' template (see
          // hasTwoPartMelody / _buildPartsFromTemplate), so more than one note here can be
          // tagged ch-melody. melodyNote itself stays singular (first found), since it's
          // used elsewhere (showMelodyOnly staff choice, MIDI) as "the" reference melody note.
          note.meiElement.setAttribute('ch-melody', '');
          note.isMelody = true;
          if (!melodyNote) melodyNote = note;
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
    if (element.matches('measure')) {
      currentMeasureId = element.getAttribute('xml:id');
    } else {
      let qstamp;
      let chordPosition;
      const tstamp = Number.parseFloat(element.getAttribute('tstamp'));
      const startid = element.getAttribute('startid')?.substring(1);
      const measureInfo = this._scoreData.measuresById[currentMeasureId];
      if (tstamp) {
        // Convert tstamp (1-based position in time signature denominator notes, relative to measure) to qstamp (0-based position in quarter notes, relative to song)
        const quartersPerBeat = 4 / measureInfo.timeSignature[1];
        qstamp = Math.min(measureInfo.endQ, measureInfo.startQ + ((tstamp - 1) * quartersPerBeat));
        chordPosition = this._bisectLeft(chordPositionQstamps, qstamp);
      } else if (startid) {
        const refNote = elementsById.get(startid);
        chordPosition = Number.parseInt(refNote.getAttribute('ch-chord-position'));
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

      // Mark intro brackets and round markers
      const elementText = element.textContent.trim();
      if (elementText === '⌜') {
        element.setAttribute('ch-intro-bracket', 'start');
      } else if (elementText === '⌝') {
        element.setAttribute('ch-intro-bracket', 'end');
      } else if (this._roundMarkerPattern.test(elementText)) {
        element.setAttribute('ch-round-marker', '');
      }

      // If qstamp is at the end of the measure, right-align it to prevent it from sticking out too far
      // See https://github.com/rism-digital/verovio/issues/4239
      if (qstamp === measureInfo.endQ) {
        const halignRend = this._createMeiElement(this._scoreData.meiParsed, 'rend');
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
  let expandedChordPositionQStartCounter = 0;
  // A range left without an end runs to the end of the score; settle that before walking.
  for (const sectionInfo of this._scoreData.sections) {
    for (const chordPositionRange of sectionInfo.chordPositionRanges) {
      if (!chordPositionRange.end) chordPositionRange.end = chordPositionCounter;
    }
  }
  // Records the numbering `ch-expanded-chord-position` indexes into; expansion replays
  // this sequence rather than deriving it again.
  for (const { range, chordPosition, expandedChordPosition: expandedChordPositionCounter, passNumber }
    of this._walkSungChordPositions(this._sectionChordPositionRanges())) {
    const sectionInfo = range.sectionInfo;
    const staffNumbers = range.staffNumbers ?? this._scoreData.staffNumbers;

    const lyricSelectors = [];
    if (range.lyricLineIds) {
      for (const lyricLineId of range.lyricLineIds) {
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
      // Passes over this chord position so far; lets expansion replay the sequence.
      passNumber: passNumber,
      staffNumbers: staffNumbers,
      lyricLabels: lyricLabels,
      lyricSyllables: lyricSyllables,
      lyricIsSkipSymbol: ['—'].includes(lyricSyllables.join()),
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

    expandedChordPositionQStartCounter += this._scoreData.chordPositions[chordPosition].durationQ;
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
    // A slur can be missing an end — one starting on a rest, for example — and a
    // slur attached by timestamp has neither
    const startId = slur.getAttribute('startid')?.substring(1);
    const endId = slur.getAttribute('endid')?.substring(1);
    const startElement = startId && measure.querySelector(`[*|id="${startId}"]`);
    const endElement = endId && measure.querySelector(`[*|id="${endId}"]`);
    if (startElement && startElement.parentElement.matches('chord')) {
      slur.setAttribute('startid', '#' + startElement.parentElement.getAttribute('xml:id'));
    }
    if (endElement && endElement.parentElement.matches('chord')) {
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
  this._scoreData.meiParsedComplete = this._scoreData.meiParsed;
  this._updateMei();
}

// Clean up verse numbers that were engraved as part of a lyric syllable
// Example: "Venid a Mí" (Spanish Hymns #61)
const CH_INLINE_VERSE_NUMBER = /^\s*\(?(\d+\s*[.)])\s*/;
ChScore.prototype._normalizeLyricVerseNumbers = function (meiParsed) {
  if (meiParsed.querySelector('verse label')) return;

  // Every staff carrying lyrics prints its own copy of the numbers and numbers its
  // own lines from 1, so a staff's lyric lines are read on their own. A line can be
  // numbered more than once, where a score lays its stanzas out one after another
  // rather than stacking them — example: "Were You There?" (Hymns for Home and Church)
  const versesByStaff = new Map();
  for (const verse of meiParsed.querySelectorAll('verse')) {
    // Empty verse elements are removed later; one landing first for a line would
    // cost the staff the number it does carry
    if (verse.textContent.trim() === '') continue;
    const staffNumber = verse.closest('staff')?.getAttribute('n') ?? '';
    const lineNumber = Number.parseInt(verse.getAttribute('n'));
    if (Number.isNaN(lineNumber)) continue;
    if (!versesByStaff.has(staffNumber)) versesByStaff.set(staffNumber, new Map());
    const versesByLineNumber = versesByStaff.get(staffNumber);
    if (!versesByLineNumber.has(lineNumber)) versesByLineNumber.set(lineNumber, []);
    versesByLineNumber.get(lineNumber).push(verse);
  }

  for (const versesByLineNumber of versesByStaff.values()) {
    // A staff engraves its numbers inline or it doesn't: every line has to start with
    // its own number for any of them to be read as one, which is what tells a verse
    // number from a lyric that merely starts with a digit
    let engravesNumbersInline = true;
    for (let lineNumber = 1; lineNumber <= versesByLineNumber.size; lineNumber++) {
      const syl = versesByLineNumber.get(lineNumber)?.[0].querySelector('syl');
      const match = syl && CH_INLINE_VERSE_NUMBER.exec(syl.textContent);
      if (!match || Number.parseInt(match[1]) !== lineNumber) {
        engravesNumbersInline = false;
        break;
      }
    }
    if (!engravesNumbersInline) continue;

    // Each stanza's number moves out of the syllable it was engraved in, the ones
    // that start a lyric line and the ones that start a later stanza of it alike
    for (const verses of versesByLineNumber.values()) {
      for (const verse of verses) {
        const syl = verse.querySelector('syl');
        const match = syl && CH_INLINE_VERSE_NUMBER.exec(syl.textContent);
        if (!match) continue;
        const labelElement = this._createMeiElement(meiParsed, 'label');
        labelElement.textContent = match[1].replace(/\s+/g, '');
        verse.insertBefore(labelElement, verse.firstChild);
        syl.textContent = syl.textContent.slice(match[0].length);
      }
    }
  }
}

// Clean up and add metadata to MEI document based on rendering options
ChScore.prototype._updateMei = function () {
  this._scoreData.meiParsed = this._scoreData.meiParsedComplete.cloneNode(true);

  // Set chord set visibility
  // Add attributes to chord symbols: @ch-superscript
  if (this._scoreData.hasChordSets) {
    const harmStaffNumber = this._scoreData.meiParsed.querySelector('[ch-melody]')?.closest('staff')?.getAttribute('n') ?? '1';
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
        const harm = this._createMeiElement(this._scoreData.meiParsed, 'harm');
        harm.setAttribute('staff', harmStaffNumber);
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
    // Independent melody lines are already one per staff, so consolidating onto one would
    // lose all but the first
    if (this._scoreData.melodyPartIds.length <= 1) {
      // Move melody notes to a single staff and layer (preferring treble clef staff if any melody notes are on one)
      const trebleClefStaffNumbers = Array.from(this._scoreData.meiParsed.querySelectorAll('clef[shape="G"]')).map(cf => Number.parseInt(cf.closest('staffDef').getAttribute('n')));
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
      for (const element of this._scoreData.meiParsed.querySelectorAll(`layer:not([n="1"]), staff:not([n="${melodyStaffNumber}"])`)) {
        deletedElementIds.push(element.getAttribute('xml:id'));
        element.remove();
      }
    }
    // Remove orphaned chords and beams
    for (const element of this._scoreData.meiParsed.querySelectorAll('chord, beam')) {
      if (!element.querySelector('note, rest')) {
        deletedElementIds.push(element.getAttribute('xml:id'));
        element.remove();
      }
    }
    // Clean up spanning elements
    const uniqueSlurs = new Set();
    for (const spanningElement of this._scoreData.meiParsed.querySelectorAll('[startid], [endid]')) {
      const startId = spanningElement.getAttribute('startid')?.substring(1);
      const endId = spanningElement.getAttribute('endid')?.substring(1);
      if ((startId && deletedElementIds.includes(startId)) || (endId && deletedElementIds.includes(endId))) {
        spanningElement.remove();
        continue;
      } else if (spanningElement.matches('slur')) {
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

  // Identify visible section IDs, chord positions, and staff numbers
  const sectionIdsToKeep = new Set();
  const expandedChordPositionsToKeep = new Set();
  const staffNumbersToKeep = new Set();
  if (this._currentOptions.hideSectionIds && this._currentOptions.hideSectionIds.length > 0) {
    const hiddenSectionIds = new Set(this._currentOptions.hideSectionIds);
    const isHidden = (sectionId) => hiddenSectionIds.has(sectionId);
    for (const sectionInfo of this._scoreData.sections) {
      if (isHidden(sectionInfo.sectionId)) continue;
      sectionIdsToKeep.add(sectionInfo.sectionId);
      // Off the range, not the recorded entry, which falls back to every staff
      for (const chordPositionRange of sectionInfo.chordPositionRanges) {
        for (const staffNumber of chordPositionRange.staffNumbers ?? []) {
          staffNumbersToKeep.add(staffNumber);
        }
      }
    }
    // Read from the recorded sequence: these numbers are matched below against the
    // @ch-expanded-chord-position attributes written from that same sequence.
    for (const [ecp, expandedChordPositionInfo] of this._scoreData.expandedChordPositions.entries()) {
      if (isHidden(expandedChordPositionInfo.sectionId)) continue;
      expandedChordPositionsToKeep.add(ecp);
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
      const singleLineSectionIds = new Set();
      const isTwoPart = this._scoreData.hasTwoPartMelody;

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
          singleLineSectionIds.add(sectionId);
        }

        sectionsById[sectionId] = [];
        sectionIdCounter[sectionId] = 0;
        let previousElement = section.previousElementSibling;
        while (previousElement && !previousElement.matches('section, ending, expansion')) {
          sectionsById[sectionId].push(previousElement);
          previousElement = previousElement.previousElementSibling;
        }
        sectionsById[sectionId].push(section);
        for (const element of sectionsById[sectionId]) element.remove();
      }

      // Create new section elements, tagged with which playthrough of the song each is:
      // reaching a section this playthrough already sang means the music has come back
      // round. Not the same as the `-rendN` suffix, which counts playthroughs of one element
      // — an ending is `-rend1` of itself but belongs to the body rendition before it.
      let renditionNumber = 0;
      const sectionIdsThisRendition = new Set();
      for (const sectionId of sectionIds) {
        if (renditionNumber === 0 || sectionIdsThisRendition.has(sectionId)) {
          renditionNumber += 1;
          sectionIdsThisRendition.clear();
        }
        sectionIdsThisRendition.add(sectionId);
        sectionIdCounter[sectionId] += 1;
        for (const element of sectionsById[sectionId]) {
          const newElement = element.cloneNode(true);
          this._suffixIds(newElement, `-rend${sectionIdCounter[sectionId]}`);
          if (newElement.matches('section, ending')) {
            newElement.setAttribute('ch-rendition', renditionNumber);
          }
          parentSection.append(newElement);
        }
      }

      // Clean up endings
      for (const ending of this._scoreData.meiParsed.querySelectorAll('ending')) {
        const endingSection = this._createMeiElement(this._scoreData.meiParsed, 'section');
        endingSection.setAttribute('xml:id', ending.getAttribute('xml:id'));
        endingSection.setAttribute('ch-chord-position', ending.getAttribute('ch-chord-position'));
        if (ending.hasAttribute('ch-rendition')) {
          endingSection.setAttribute('ch-rendition', ending.getAttribute('ch-rendition'));
        }
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
      let currentSectionIndex = -1;
      let currentSectionChordPositions = null;
      let currentExpandedChordPositions = null;
      let currentSectionOriginalId = null;
      let currentRendition = 0;
      const sectionElements = this._scoreData.meiParsed.querySelectorAll('section[type="introduction"], section:not([type="introduction"]) > section');

      // For a 'Two-Part' score it's @ch-rendition that says which part is singing, not the
      // walk's pass number: the walk counts visits *per chord position*, so a repeat ending
      // whose positions no body range covered reads as pass 1 however many renditions
      // precede it. _gatherSyllables' tail-word handling works around the same mismatch.
      const renditionOf = section => Number.parseInt(section.getAttribute('ch-rendition')) || 0;
      const melodyPartIds = this._scoreData.melodyPartIds;
      // A chord takes its part from the notes inside it
      const partIdOf = element => element.getAttribute('ch-part-id')
        ?? element.querySelector('note[ch-part-id]')?.getAttribute('ch-part-id');

      // A labelled pickup ("(3.)" in "A Child’s Prayer", 1989 CSB) leads *into* the verse it
      // names, so it sounds at the end of the rendition before that one, not with its part.
      // The label sits on the word's first syllable only, so the state runs on until the
      // next word start resets it. Keyed by note rather than verse, and built up front,
      // because the replay prunes verses.
      const pickupRenditionByElement = new Map();
      if (isTwoPart) {
        for (const section of sectionElements) {
          const pickupRenditionByLine = {};
          for (const verse of section.querySelectorAll('verse')) {
            const lyricLineId = verse.getAttribute('ch-lyric-line-id');
            if (this._startsWord(verse)) {
              const pickupVerse = this._pickupVerseNumber(verse);
              pickupRenditionByLine[lyricLineId] = pickupVerse == null ? null : pickupVerse - 1;
            }
            const pickupRendition = pickupRenditionByLine[lyricLineId];
            if (pickupRendition == null) continue;
            const noteOrChord = verse.closest('note, chord');
            if (!noteOrChord) continue;
            pickupRenditionByElement.set(noteOrChord, pickupRendition);
            // A chord is rested out as a whole, so it needs the mark its notes carry
            const chord = noteOrChord.parentElement?.closest('chord');
            if (chord) pickupRenditionByElement.set(chord, pickupRendition);
          }
        }
      }
      // Whether a part's note is sung in a given rendition: a pickup only in the rendition
      // it leads out of, anything else whenever its own part is singing — and once every
      // part has had its pass, they all sing.
      const soundsInRendition = (element, rendition) => {
        const pickupRendition = pickupRenditionByElement.get(element);
        if (pickupRendition != null) return rendition === pickupRendition;
        const singingPartId = melodyPartIds[rendition - 1]; // undefined once all have sung
        return !singingPartId || partIdOf(element) === singingPartId;
      };
      // Replay the sequence recorded at parse time rather than walking it again.
      // `ch-expanded-chord-position` indexes into this very array, so writing it while
      // reading it keeps the two in step by construction.
      for (const [ecpCounter, expandedChordPositionInfo] of this._scoreData.expandedChordPositions.entries()) {
        const chordPosition = expandedChordPositionInfo.chordPositionInfo.chordPosition;
        const sectionInfo = this._scoreData.sectionsById[expandedChordPositionInfo.sectionId];
        const passNumber = expandedChordPositionInfo.passNumber;

        // Move to next section if needed. The elements at this chord position are found
        // once and reused for the advance test and the tagging below.
        const selector = `[ch-chord-position="${chordPosition}"]`;
        let elements = sectionElements[currentSectionIndex]?.querySelectorAll(selector);
        if (currentSectionChordPositions == null || !currentSectionChordPositions.has(chordPosition) || elements?.[0]?.hasAttribute('ch-expanded-chord-position')) {
          if (currentExpandedChordPositions) {
            sectionElements[currentSectionIndex].setAttribute('ch-expanded-chord-position', currentExpandedChordPositions.join(' '));
          }
          currentSectionIndex++;
          const currentSection = sectionElements[currentSectionIndex];
          currentSectionChordPositions = new Set(currentSection
            .getAttribute('ch-chord-position').trim().split(' ').map(cp => Number.parseInt(cp)));
          currentExpandedChordPositions = [];
          // The extracted introduction section carries no xml:id
          currentSectionOriginalId = currentSection.getAttribute('xml:id')?.split('-rend')[0] ?? null;
          currentRendition = renditionOf(currentSection);
          elements = currentSection.querySelectorAll(selector);
        }
        currentExpandedChordPositions.push(ecpCounter);

        // Add expanded chord positions and remove unneeded lyrics
        const isIntroduction = sectionInfo.type === 'introduction';
        // Both of these signals are scoped per staff/section as a whole (see the matching
        // comment in _gatherSyllables), so they read true throughout a 'Two-Part' score —
        // each part's own verse is alone on its own staff/note. Ignored here for the same
        // reason: only the per-pass matching below should decide which part's words show.
        const isSingleLine = isTwoPart ? false
          : expandedChordPositionInfo.chordPositionInfo.isSingleLine
            || singleLineSectionIds.has(currentSectionOriginalId);
        for (const element of elements) {
          element.setAttribute('ch-expanded-chord-position', ecpCounter);
          const verseElements = element.querySelectorAll('verse');
          if (verseElements.length > 0 && !isIntroduction) {
            // A note belonging to no melody part (an accompaniment staff carrying words)
            // falls through to the ordinary per-pass rule
            const isTwoPartMelodyNote = isTwoPart && melodyPartIds.includes(partIdOf(element));
            let keptVerseIndex = -1;
            if (isTwoPartMelodyNote) {
              if (soundsInRendition(element, currentRendition)) keptVerseIndex = 0;
            } else {
              keptVerseIndex = this._verseSoundingAt(verseElements, passNumber, isSingleLine);
            }
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
      }
      if (sectionElements[currentSectionIndex]) {
        sectionElements[currentSectionIndex].setAttribute('ch-expanded-chord-position', currentExpandedChordPositions.join(' '));
      }

      // The part that isn't singing needs its *notes* dropped too. Same rule as the verses above, but over every clone — the replay doesn't reach them all.
      const silentSet = new Set();
      if (isTwoPart) {
        for (const section of sectionElements) {
          if (section.getAttribute('type') === 'introduction') continue;
          const rendition = renditionOf(section);
          for (const element of section.querySelectorAll('note, chord')) {
            // A chord is rested out as a whole, so its own notes aren't handled separately
            if (element.matches('note') && element.parentElement.closest('chord')) continue;
            if (!melodyPartIds.includes(partIdOf(element))) continue;
            if (!soundsInRendition(element, rendition)) silentSet.add(element);
          }
        }
      }

      // Silence the non-singing part by rewriting it as rests rather than deleting it, so
      // the staff keeps its shape and stays readable: a layer that sings nothing at all in
      // this measure becomes a single <mRest>, and anything narrower becomes a rest of the
      // same duration in place.
      if (silentSet.size > 0) {
        const removedIds = new Set();
        const layers = new Set();
        for (const element of silentSet) {
          layers.add(element.closest('layer'));
          removedIds.add(element.getAttribute('xml:id'));
          for (const note of element.querySelectorAll('note')) removedIds.add(note.getAttribute('xml:id'));
        }

        // A rest standing in for something silenced, carrying over the attributes that say
        // where in the song it is — the same ones the engraving's own rests have
        const restLike = (source, attributes) => {
          const rest = this._createMeiElement(this._scoreData.meiParsed, 'rest');
          for (const attribute of attributes) {
            const value = source.getAttribute(attribute);
            if (value != null) rest.setAttribute(attribute, value);
          }
          return rest;
        };

        for (const layer of layers) {
          const events = this._layerEvents(layer);
          if (events.every(event => silentSet.has(event))) {
            while (layer.firstChild) layer.removeChild(layer.firstChild);
            layer.append(this._createMeiElement(this._scoreData.meiParsed, 'mRest'));
            continue;
          }
          for (const event of events) {
            if (silentSet.has(event)) {
              event.replaceWith(restLike(event,
                ['dur', 'dots', 'ch-chord-position', 'ch-expanded-chord-position']));
            }
          }
        }

        // A beam or tuplet left holding nothing but rests becomes the one rest that spans
        // it — "A Child’s Prayer"'s silenced triplet pickup reads as a single quarter rest
        // rather than three triplet rests. Only whole containers are collapsed: merging
        // adjacent rests in general has to respect where the beat falls, which a duration
        // sum on its own can't tell. Walked innermost-first so a nested container settles
        // before the one holding it.
        for (const layer of layers) {
          for (const container of Array.from(layer.querySelectorAll('beam, tuplet')).reverse()) {
            if (!container.isConnected) continue; // Already swallowed by a container inside it
            const events = this._layerEvents(container);
            if (events.length === 0 || !events.every(event => event.matches('rest'))) continue;
            const durations = events.map(event => this._wholeNotesOf(event));
            if (durations.some(duration => duration == null)) continue;
            const attributes = this._restAttributesFor(durations.reduce((sum, d) => sum + d, 0));
            if (!attributes) continue;
            // The collapsed rest starts where the run started
            const rest = restLike(events[0], ['ch-chord-position', 'ch-expanded-chord-position']);
            rest.setAttribute('dur', attributes.dur);
            if (attributes.dots) rest.setAttribute('dots', attributes.dots);
            container.replaceWith(rest);
          }
        }

        // Drop beams left holding nothing but rests, and any spanning element that pointed
        // at a note that is now gone
        // Only a measure holding a silenced layer can have been left with either, and
        // `[startid], [endid], [plist]` over the whole expanded MEI is the most expensive
        // selector on this path — so both sweeps stay inside the measures actually touched
        const touchedMeasures = new Set([...layers].map(layer => layer.closest('measure')));
        for (const measure of touchedMeasures) {
          for (const beam of measure.querySelectorAll('beam')) {
            if (!beam.querySelector('note')) beam.replaceWith(...beam.childNodes);
          }
          for (const spanningElement of measure.querySelectorAll('[startid], [endid], [plist]')) {
            const referenced = ['startid', 'endid', 'plist']
              .flatMap(attribute => (spanningElement.getAttribute(attribute) ?? '').split(/\s+/))
              .filter(token => token.startsWith('#')).map(token => token.substring(1));
            if (referenced.some(id => removedIds.has(id))) spanningElement.remove();
          }
        }
      }

      // A verse the replay never reached keeps its engraved lyric line number, which Verovio
      // renders as a *second* row of words under the staff. An expanded score shows one
      // verse per staff per rendition, so every surviving melody verse belongs on line 1 —
      // a genuine secondary line, already renumbered to 2 above, is the only exception.
      for (const verse of this._scoreData.meiParsed.querySelectorAll(
        ':is(note[ch-melody], chord:has([ch-melody])) verse:not([ch-secondary])')) {
        verse.setAttribute('n', 1);
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
      const chordPositions = chordPositionElement.getAttribute('ch-chord-position').trim().split(' ').map(cp => Number.parseInt(cp));
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
  if (this._currentOptions.hideSectionIds && this._currentOptions.hideSectionIds.length > 0 && this._currentOptions.expandScore !== 'full-score') {
    const oldToNewLineNumber = {}
    for (const element of this._scoreData.meiParsed.querySelectorAll('label[ch-section-id], verse[ch-section-id]')) {
      const sectionIds = element.getAttribute('ch-section-id').split(' ');
      const chordPosition = Number.parseInt(element.closest('[ch-chord-position]').getAttribute('ch-chord-position'));
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

  if (this._currentOptions.hideSectionIds && this._currentOptions.hideSectionIds.length > 0) {
    // Remove unneeded section elements
    for (const sectionElement of this._scoreData.meiParsed.querySelectorAll('section[ch-expanded-chord-position], ending[ch-expanded-chord-position]')) {
      const sectionElementExpandedChordPositions = new Set(sectionElement.getAttribute('ch-expanded-chord-position').trim().split(' ').map(ecp => Number.parseInt(ecp)));
      if (sectionElementExpandedChordPositions.isDisjointFrom(expandedChordPositionsToKeep)) sectionElement.remove();
    }
    // Remove unneeded staff elements
    if (staffNumbersToKeep.size > 0 && staffNumbersToKeep.size !== this._scoreData.staffNumbers.length) {
      const sortedStaffNumbersToKeep = Array.from(staffNumbersToKeep).sort((a, b) => a - b);
      const referringElementsSelector = '[staff]:not(' + sortedStaffNumbersToKeep.map(sn => `[staff="${sn}"]`).join(',') + ')';
      for (const referringElement of this._scoreData.meiParsed.querySelectorAll(referringElementsSelector)) {
        referringElement.setAttribute('staff', sortedStaffNumbersToKeep[0]);
        // Prevent overlapping text if staff already has text above
        referringElement.setAttribute('vgrp', 4000);
      }
      const stavesSelector = ':is(staff, staffDef):not(' + sortedStaffNumbersToKeep.map(sn => `[n="${sn}"]`).join(',') + ')';
      for (const staff of this._scoreData.meiParsed.querySelectorAll(stavesSelector)) staff.remove();
    }
  }

  // Save changes
  this._scoreData.meiString = (new XMLSerializer()).serializeToString(this._scoreData.meiParsed);
  this._vrvToolkit.loadData(this._scoreData.meiString);
}

// Create an SVG element
ChScore.prototype._createSvgElement = function (svgParsed, tagName) {
  return svgParsed.createElementNS('http://www.w3.org/2000/svg', tagName);
}

// Create an MEI element
ChScore.prototype._createMeiElement = function (meiParsed, tagName) {
  return meiParsed.createElementNS('http://www.music-encoding.org/ns/mei', tagName);
}

ChScore.prototype._updateSvg = function (svg) {
  const svgParsed = (new DOMParser()).parseFromString(svg, 'text/xml');
  const definitionScaleElement = svgParsed.querySelector('.definition-scale');
  const systems = svgParsed.querySelectorAll('g.system');
  const noteheadWidth = 230;
  // Remove CSS styles added by Verovio (:not(:last-child) is to make sure the <style> element with @font-face isn't removed)
  svgParsed.querySelector('style:not(:last-child)')?.remove();
  // Related: https://github.com/rism-digital/verovio/issues/4252
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
          tspan.setAttribute('x', Number.parseInt(tspan.getAttribute('x')) + (noteheadWidth / 2));
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
    if (this._currentOptions.hideSectionIds && this._currentOptions.hideSectionIds.includes('introduction')) {
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
  const backgroundShapes = this._createSvgElement(svgParsed, 'g');
  backgroundShapes.classList.add('ch-shapes', 'ch-shapes-background');
  pageMarginElement.prepend(backgroundShapes);
  const foregroundShapes = this._createSvgElement(svgParsed, 'g');
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
    systemX2 = Number.parseInt(measures.at(-1).querySelector('.staff > path').getAttribute('d').split(' ')[2].replace('L', ''));

    const staves = measures[0].querySelectorAll('.staff');
    for (let sf = 0; sf < staves.length; sf++) {
      const staff = staves[sf];
      const staffNumber = Number.parseInt(staff.dataset.n);
      const staffLines = Array.from(staff.querySelectorAll(':scope > path'));
      const staffY1 = Number.parseInt(staffLines[0].getAttribute('d').split(' ')[1]);
      const staffY2 = Number.parseInt(staffLines.at(-1).getAttribute('d').split(' ')[3]);

      if (sf === 0) {
        systemX1 = Number.parseInt(staffLines[0].getAttribute('d').split(' ')[0].replace('M', ''));
        systemY1 = staffY1;
      }
      if (sf === staves.length - 1) {
        systemY2 = staffY2;
        lastStaffY2 = staffY2;
      }

      // Draw staff labels
      const staffLabelClassName = 'ch-staff-label';
      for (const shapeLayer of shapeLayersByClassName[staffLabelClassName]) {
        const staffLabel = this._createSvgElement(svgParsed, 'text');
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
        const staffRect = this._createSvgElement(svgParsed, 'rect');
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
      const systemLyricsBottom = Math.max(0, ...Array.from(system.querySelectorAll('.verse text')).map(lyric => Number.parseInt(lyric.getAttribute('y'))));
      systemY2 = Math.max(systemY2, systemLyricsBottom + 500) ?? 0;
    }

    // Draw system rects
    const systemRectClassName = 'ch-system-rect';
    for (const shapeLayer of shapeLayersByClassName[systemRectClassName]) {
      const systemRect = this._createSvgElement(svgParsed, 'rect');
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
      const [measureX1, _y1, measureX2, _y2] = staffLines.at(0).getAttribute('d').replace('M', '').replace('L', '').split(' ').map(coord => Number.parseInt(coord));
      measureXsById[measure.id] = [measureX1, measureX2];

      // Draw measure rects
      const measureRectClassName = 'ch-measure-rect';
      for (const shapeLayer of shapeLayersByClassName[measureRectClassName]) {
        const measureRect = this._createSvgElement(svgParsed, 'rect');
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
        const chordPosition = Number.parseInt(note.dataset.chChordPosition);
        const expandedChordPositions = note.dataset.chExpandedChordPosition;
        if (!Object.hasOwn(chordPositionNoteX1s, chordPosition)) {
          chordPositionNoteX1s[chordPosition] = [];
          chordPositionToExpandedChordPositions[chordPosition] = expandedChordPositions;
        }
        const [noteX1, noteY1] = noteSymbol.getAttribute('transform').split('translate(').at(-1).split(')')[0].split(',').map(coord => Number.parseInt(coord));
        chordPositionNoteX1s[chordPosition].push(noteX1);

        // Draw note circles
        const noteCircleClassName = 'ch-note-circle';
        for (const shapeLayer of shapeLayersByClassName[noteCircleClassName]) {
          if (noteSymbol.parentElement.classList.contains('rest')) continue;
          const noteCircle = this._createSvgElement(svgParsed, 'circle');
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
          const cpLabel = this._createSvgElement(svgParsed, 'text');
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
          const cpLine = this._createSvgElement(svgParsed, 'line');
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
          const cpRect = this._createSvgElement(svgParsed, 'rect');
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
          if (previousCpRect) previousCpRect.setAttribute('width', cpRectX1 - Number.parseInt(previousCpRect.getAttribute('x')));
          previousCpRect = cpRect;
        }
      }
    }
  }

  // Loop through lyrics by system and staff
  if (this._scoreData.hasLyrics) {
    const lyricFontSize = Number.parseInt(svgParsed.querySelector('.verse tspan[font-size]:not([font-size="0px"])')?.getAttribute('font-size'));
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
          const chordPosition = Number.parseInt(noteOrChord.dataset.chChordPosition);
          const expandedChordPositions = Number.parseInt(noteOrChord.dataset.chExpandedChordPosition);
          const staff = noteOrChord.closest('.staff');
          const measure = staff.closest('.measure');
          const measureFirstChordPosition = Number.parseInt(measure.querySelector('[data-ch-chord-position]').dataset.chChordPosition);
          const [measureX1, measureX2] = measureXsById[measure.id];
          let lyricX = Number.parseInt(lyricTextElement.getAttribute('x')) - lyricPadding;
          if (chordPosition === measureFirstChordPosition) lyricX = Math.min(lyricX, measureX1);
          const lyricY = Number.parseInt(lyricTextElement.getAttribute('y'));

          if (!isChorus && !verseYPositions.includes(lyricY)) {
            verseYPositions.push(lyricY);
          } else if (isChorus && !chorusYPositions.includes(lyricY)) {
            chorusYPositions.push(lyricY);
          }

          // Draw lyric line labels
          const lyricLineLabelClassName = 'ch-lyric-line-label';
          if (!addedLyricLabels.includes(lyric.dataset.chLyricLineId)) {
            for (const shapeLayer of shapeLayersByClassName[lyricLineLabelClassName]) {
              const lyricLineLabel = this._createSvgElement(svgParsed, 'text');
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
            const lyricRect = this._createSvgElement(svgParsed, 'rect');
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
              const previousLyricX = Number.parseInt(previouslyricRect[shapeLayerClass][lyric.dataset.chLyricLineId].getAttribute('x'));
              if (lyricX > previousLyricX) {
                const previousLyricWidth = Number.parseInt(previouslyricRect[shapeLayerClass][lyric.dataset.chLyricLineId].getAttribute('width'));
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
                if (Number.parseInt(nearbyLyric.dataset.chChordPosition) < chordPosition) continue;
                const nearbyLyricRect = shapeLayer.querySelector(`.ch-lyric-rect[data-related~="${nearbyLyric.id}"]`);
                if (nearbyLyricRect) {
                  nextLyricRect = nearbyLyricRect;
                  break;
                }
              }
              let newWidth = lyricFontSize * 2;
              if (nextLyricRect) newWidth = Number.parseInt(nextLyricRect.getAttribute('x')) - lyricX;
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
                element?.setAttribute('y', Number.parseInt(element?.getAttribute('y')) + offset);
              }
            }
          } else if (numChoruses > numVerses) {
            const offset = (chorusesTop - versesTop) + (((chorusesBottom - chorusesTop) - (versesBottom - versesTop)) / 2);
            for (const lyric of system.querySelectorAll(`.staff[data-n="${staffNumber}"] .label:not([data-ch-chorus]), .staff[data-n="${staffNumber}"] .verse:not([data-ch-chorus])`)) {
              for (const element of Array.from(lyric.querySelectorAll('text, rect'))
                .concat([svgParsed.querySelector(`:is(.ch-shapes) [data-related~="${lyric.id}"]`)])
              ) {
                element?.setAttribute('y', Number.parseInt(element?.getAttribute('y')) + offset);
              }
            }
          }
        }
      }
    }
  }

  // Set chord set image visibility
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
            chordChartsGroup = this._createSvgElement(svgParsed, 'g');
            chordChartsGroup.classList.add('ch-chord-set-images');
            measure.append(chordChartsGroup);
          }
          if (harmElement && chordPositionRefInfo.svgSymbolId) {
            const imageSize = 1600;
            const harmTspan = harmElement.querySelector('tspan[x]');
            const firstStaffY = Number.parseInt(harmTspan.closest('g.measure').querySelector('g.staff path').getAttribute('d').split(' ')[1]);
            const harmTspanY = Number.parseInt(harmTspan.getAttribute('y'));
            // Position above the first staff, if there's a staff above the chord symbol (for example, on songs with a descant)
            const y = Math.min(firstStaffY, harmTspanY) - (imageSize * 1.25);
            const x = Number.parseInt(harmTspan.getAttribute('x')) - (imageSize / 2);
            chordChartsGroup.insertAdjacentHTML('beforeend', `<use x="${x}" y="${y}" href="${currentChordSet.svgSymbolsUrl}?3#${chordPositionRefInfo.svgSymbolId}" width="${imageSize}" height="${imageSize}" />`);
          }
        }
      }
    }
  }

  return svgParsed;
}

ChScore.prototype._drawScore = function () {
  this._container.dataset.chStatus = 'drawing';
  this._container.innerHTML = '';
  if (this._pages) for (const page of this._pages) this._pageObserver.unobserve(page);

  // Add attributes: @data-ch-width, @data-ch-height
  this._container.dataset.chWidth = this._container.offsetWidth;
  this._container.dataset.chHeight = this._container.offsetHeight;

  // Create pages
  this._pages = [];
  const createPage = () => {
    const page = document.createElement('div');
    const pageNumber = this._pages.length + 1;
    page.setAttribute('data-ch-page', pageNumber);
    page.style.visibility = 'hidden';
    if (this._pages.length === 0) page.classList.add('active');
    this._pageObserver.observe(page);
    this._pages.push(page);
    this._container.append(page);
  }
  createPage();

  // Create inner container
  const addInnerContainer = (name, content) => {
    const innerContainer = document.createElement('div');
    innerContainer.setAttribute(`data-ch-${name}`, '');
    if (name === 'svg') {
      innerContainer.append(document.importNode(content.documentElement, true));
      this._pages.at(-1).insertBefore(innerContainer, lyricsBelowInnerContainer);
    } else {
      innerContainer.append(content);
      this._pages.at(-1).append(innerContainer);
    }
    return innerContainer;
  }

  // Parse header and footer content
  let headerNodes = [], footerNodes = [];
  if (this._currentOptions.headerContent || this._currentOptions.footerContent) {
    const parser = new DOMParser();
    headerNodes = Array.from(parser.parseFromString(this._currentOptions.headerContent ?? '', 'text/html').body.childNodes);
    footerNodes = Array.from(parser.parseFromString(this._currentOptions.footerContent ?? '', 'text/html').body.childNodes);
  }

  // Add header content
  if (headerNodes.length === 0) headerNodes.push(document.createTextNode(''));
  for (const headerNode of headerNodes) {
    addInnerContainer('header', headerNode);
  }

  // Add lyrics content
  for (const section of this._scoreData.sections) {
    if ((this._currentOptions.hideSectionIds ?? []).includes(section.sectionId) || section.placement !== 'below') {
      continue;
    }
    const lyricParagraph = document.createElement('p');
    lyricParagraph.dataset.chSectionId = section.sectionId;
    const lyricLines = section.annotatedLyrics.replace(/\||•|_|◠|◡/g, '').trim().split('\n');
    for (let ln = 0; ln < lyricLines.length; ln++) {
      const lyricLineContainer = document.createElement('span');
      const lyricLineBreak = document.createElement('br');
      let lineHtml = '';
      if (section.marker && ln === 0) lineHtml += `<span class="label">${section.marker}. </span>`;
      lineHtml += lyricLines[ln];
      lyricLineContainer.innerHTML = lineHtml;
      lyricParagraph.append(lyricLineContainer);
      lyricParagraph.append(lyricLineBreak);
    }
    addInnerContainer('lyrics-below', lyricParagraph);
  }
  let lyricsBelowInnerContainer = this._pages.at(-1).querySelector('[data-ch-lyrics-below]');
  if (!lyricsBelowInnerContainer) {
    lyricsBelowInnerContainer = addInnerContainer('lyrics-below', document.createTextNode(''));
  }

  // Add footer content
  if (footerNodes.length === 0) footerNodes.push(document.createTextNode(''));
  for (const footerNode of footerNodes) {
    addInnerContainer('footer', footerNode);
  }

  // If scale option is an array (min and max values), attempt to find an optimal scale that fits on a single page, without getting too small
  if (Array.isArray(this._currentOptions.scale) && this._currentOptions.layout !== 'print') {
    const getPageCountAtScale = (scale) => {
      this._container.dataset.chScale = Number.parseInt(scale);
      this._container.style.setProperty('--ch-scale', Number.parseInt(scale));
      const availableHeight = Math.max(this._container.offsetHeight - this._pages[0].scrollHeight, 100);
      this._vrvToolkit.setOptions({ scale: scale, pageHeight: availableHeight });
      this._vrvToolkit.redoLayout();
      return this._vrvToolkit.getPageCount();
    };
    // Binary search for optimal scale
    let [minScale, maxScale] = this._currentOptions.scale;
    while (minScale < maxScale) {
      const mid = Math.ceil((minScale + maxScale) / 2);
      const numPages = getPageCountAtScale(mid);
      if (numPages === 1) {
        minScale = mid;
      } else {
        maxScale = mid - 1;
      }
    }
    // Set final scale
    getPageCountAtScale(minScale);
  }

  // Render SVG
  const numPages = this._vrvToolkit.getPageCount();
  for (let p = 1; p <= numPages; p++) {
    const svgParsed = this._updateSvg(this._vrvToolkit.renderToSVG(p));
    addInnerContainer('svg', svgParsed);
  }

  // If the score container has a fixed height that's not tall enough for the rendered score, add bottom margin to increase the available space. Setting container height directly is avoided, because that could trigger a redraw.
  if (this._container.offsetHeight < this._container.scrollHeight && !['paginated', 'print'].includes(this._currentOptions.layout)) {
    this._container.style.marginBottom = `${this._container.scrollHeight - this._container.offsetHeight}px`;
  } else {
    this._container.style.marginBottom = '';
  }

  // Paginated layout: sort inner containers into pages
  if (this._currentOptions.layout === 'paginated' && this._pages[0].scrollHeight > this._container.offsetHeight) {
    const pageHeight = this._container.offsetHeight;
    let pageTop = this._pages[0].getBoundingClientRect().top;
    for (const innerContainer of this._pages[0].children) {
      const innerContainerRect = innerContainer.getBoundingClientRect();
      if (innerContainerRect.bottom - pageTop > pageHeight && innerContainerRect.top !== pageTop) {
        createPage();
        pageTop = innerContainerRect.top;
      }
      innerContainer.pageIndex = this._pages.length - 1;
    }
    for (const innerContainer of Array.from(this._pages[0].children)) {
      if (innerContainer.pageIndex !== 0) this._pages[innerContainer.pageIndex].append(innerContainer);
    }
  }

  // Remove temporary styles
  for (const page of this._pages) {
    page.style.visibility = '';
  }

  this._container.dataset.chStatus = 'ready';
  if (this._currentOptions.customEvents.includes('ch:scoredraw')) {
    this._container.dispatchEvent(new CustomEvent('ch:scoredraw', { detail: {
      pageState: this.getPageState(),
      width: this._container.offsetWidth,
      height: this._container.offsetHeight,
      scale: this._currentOptions.scale,
    } }));
  }
}

// This function created with help from AI (Claude)
ChScore.prototype._extractPianoIntroduction = function (meiParsed) {
  const MUSICAL_ELEMENTS = ['note', 'rest', 'chord', 'space'];
  const MEASURE_ATTRS = ['clef', 'keySig', 'meterSig', 'staffDef'];
  const NOTATION_ELEMENTS = ['tie', 'slur', 'dir', 'harm', 'dynam', 'tempo', 'pedal'];

  const updateElementIds = (elem, idMap) => {
    const elements = elem.matches('chord') ? elem.querySelectorAll('note') : [elem];

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
    const dur = Number.parseFloat(elem.getAttribute('dur') || '4');
    const dots = Number.parseInt(elem.getAttribute('dots') || '0');
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
      const unit = Number.parseInt(meterSig.getAttribute('unit') || '4');
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
    const newLayer = this._createMeiElement(meiParsed, 'layer');
    newLayer.setAttribute('n', layer.getAttribute('n') || '1');

    let tstamp = 1;
    let hasContent = false;
    startTstamp = startTstamp ?? 1;
    endTstamp = endTstamp ?? Infinity;

    const processContainer = (container, currentTstamp) => {
      let containerTstamp = currentTstamp;
      const children = [];

      for (const child of container.children) {
        if (child.matches('beam, tuplet')) {
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
        newContainer = this._createMeiElement(meiParsed, container.tagName);
        if (container.hasAttribute('xml:id')) {
          const oldId = container.getAttribute('xml:id');
          const newId = `${oldId}-intro`;
          idMap[oldId] = newId;
          newContainer.setAttribute('xml:id', newId);
        }

        if (container.matches('tuplet')) {
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
      if (elem.matches('beam, tuplet')) {
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
      } else if (elem.matches('beam, tuplet')) {
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
      const count = Number.parseInt(timeEl.getAttribute('count') || '4');
      const unit = Number.parseInt(timeEl.getAttribute('unit') || '4');
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
    endM = endM ?? measures.at(-1).getAttribute('n');

    const startIdx = measures.findIndex(m => m.getAttribute('n') === String(startM));
    const endIdx = measures.findIndex(m => m.getAttribute('n') === String(endM));
    const selected = measures.slice(startIdx, endIdx + 1);

    return selected.map((measure, i) => {
      const newM = this._createMeiElement(meiParsed, 'measure');
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
        const newStaff = this._createMeiElement(meiParsed, 'staff');
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
  for (const introBracket of this._getIntroBrackets(meiParsed)) {
    introMeasureRanges.push([
      [introBracket.start.measureNumber, introBracket.start.tstamp],
      [introBracket.end.measureNumber, introBracket.end.tstamp],
    ]);
    introChordPositionRanges.push([introBracket.start.chordPosition, introBracket.end.chordPosition]);
  }
  for (const element of meiParsed.querySelectorAll('[ch-intro-bracket]')) element.remove();

  const introChordPositions = [];
  for (const introChordPositionRange of introChordPositionRanges) {
    for (let cp = introChordPositionRange[0]; cp < introChordPositionRange[1]; cp++) introChordPositions.push(cp);
  }

  if (meiParsed.querySelector('section[type="introduction"]') || introMeasureRanges.length === 0) return meiParsed;

  // Add repeat barlines
  const originalMeasures = Array.from(meiParsed.querySelectorAll('measure'));
  const verseNumbers = this._getInlineVerseNumbers(this._scoreData.meiParsed);
  if (!this._scoreData.hasRepeatOrJump && verseNumbers.length > 1) {
    originalMeasures[0].setAttribute('left', 'rptstart');
    originalMeasures.at(-1).setAttribute('right', 'rptend');
  }

  const introSection = this._createMeiElement(meiParsed, 'section');
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
  let removeSelectors = ['verse', 'dir', 'tempo'];
  const introSectionInfo = this._scoreData.sections[0].type === 'introduction' ? this._scoreData.sections[0] : null;
  const introStaffNumbers = introSectionInfo?.chordPositionRanges?.[0]?.staffNumbers ?? [];
  if (introStaffNumbers.length > 0) removeSelectors.push('staff:not(' + introStaffNumbers.map(sn => `[n="${sn}"]`).join(',') + ')');
  introSection.querySelectorAll(removeSelectors.join(',')).forEach(v => v.remove());

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
    import('https://cdn.jsdelivr.net/npm/verovio@6.1.0/dist/verovio-toolkit-wasm.min.js'),
    verovioInitialized(),
  ]);
  return true;
}
ChScore.prototype._chDependenciesLoaded = ChScore.prototype._chLoadDependencies()

// Check browser type
ChScore.prototype._supportsCssStylesheetApi = CSSStyleSheet?.prototype?.replaceSync;

// Default score data
ChScore.prototype._defaultInputData = {
  format: 'abc',
  scoreContent: `X:1
    T:Westminster Chimes
    L:1/4
    M:3/4
    K:C
    e c d | G3 | G d e | c3 |]`,
}

// Default Verovio options
// See https://book.verovio.org/toolkit-reference/toolkit-options.html
// Some of these defaults are adjusted in setOptions()
ChScore.prototype._defaultVerovioOptions = {
  header: 'none', footer: 'none', // Hide header and footer
  pageMarginTop: 0, pageMarginBottom: 0, // Minimal top and bottom margins
  pageMarginLeft: 4, pageMarginRight: 4, // Slight margin to prevent elements at the edge of the score from getting clipped
  pageHeight: 60000, // Large height to create one continuous page with all systems
  pageWidth: 100, // Adjusted in setOptions()
  adjustPageHeight: true, // Shrink the page height to avoid extra whitespace at the bottom
  adjustPageWidth: false, // Don't shrink page width
  scaleToPageSize: true, // Responsive layout without needing as much manual calculation
  scale: 40, // Adjusted in setOptions()
  spacingStaff: 14, // Vertical spacing
  spacingSystem: 0, // Vertical spacing
  spacingLinear: 0.25, // Horizontal spacing
  spacingNonLinear: 0.6, // Horizontal spacing
  lyricHeightFactor: 1.4, // Lyric line spacing
  lyricSize: 4.5, // Lyric size relative to size of notes
  lyricWordSpace: 2.0, // Space between lyric syllables (slightly bigger than default ensures that syllables remain spaced well when wider fonts are set with CSS)
  lyricVerseCollapse: true, // Prevents extra whitespace if there are empty lyric syllables
  lyricNoStartHyphen: true, // Don't draw extra hyphen on the left when a word wraps to the next system
  lyricTopMinMargin: 8.0, // Prevent lyrics from getting too close to notation
  breaks: 'smart', // Prefer breaking at encoded system breaks, but only if they're nearby
  breaksSmartSb: 0.6, // How close nearby system break needs to be for it to be used
  minLastJustification: 0.4, // Justification of last system
  breaksNoWidow: true, // Prevent single measure on last page
  condense: 'auto', // Hide empty staves. Example: "True to the Faith" (1985 Hymns). Requires setting scoreDef@optimize to 'true' in the MEI.
  condenseFirstPage: true, // Allow empty staves in the first system to be hidden
  systemDivider: 'none', // When a score is condensed, Verovio draws dividers between systems by default. This turns them off.
  transpose: '', // Don't transpose by default
  expandNever: true, // Prevent Verovio-generated MIDI from expanding
  mmOutput: false, // Use pixel units, not millimeters
  xmlIdSeed: 1, // Keep generated element IDs consistent between loads
  svgAdditionalAttribute: [
    // Standard MEI attributes
    'staff@n', 'tie@startid', 'slur@startid',
    // Chorister.js basic attributes
    'chord@ch-chord-position', 'note@ch-chord-position', 'rest@ch-chord-position',
    'dir@ch-chord-position', 'harm@ch-chord-position', 'fermata@ch-chord-position',
    'verse@ch-lyric-line-id',
    'dir@ch-intro-bracket', 'dir@ch-round-marker', 'rend@ch-superscript', 'syl@end-underscore',
    // Chorister.js advanced attributes (based on parts and sections data)
    'chord@ch-expanded-chord-position', 'note@ch-expanded-chord-position', 'rest@ch-expanded-chord-position',
    'dir@ch-expanded-chord-position', 'harm@ch-expanded-chord-position', 'fermata@ch-expanded-chord-position',
    'note@ch-part-id', 'note@ch-melody',
    'rest@ch-part-id', 'rest@ch-melody',
    'verse@ch-section-id', 'verse@ch-secondary', 'verse@ch-chorus',
  ],
};

// Default options
ChScore.prototype._defaultOptions = {
  layout: 'vertical-scroll',  // 'vertical-scroll', 'horizontal-scroll', 'paginated', 'print'
  scale: 40,                  // Number (exact), or array with two numbers for fit to page (min and max)
  keySignatureId: null,       // Key signature ID or false
  expandScore: false,         // 'intro', 'full-score', or false
  showChordSet: false,        // Chord set ID or false
  showChordSetImages: false,  // true or false
  showFingeringMarks: false,  // true or false
  showMeasureNumbers: false,  // true or false
  showMelodyOnly: false,      // true or false
  headerContent: '',          // HTML string
  footerContent: '',          // HTML string
  hideSectionIds: [],         // Array of section IDs
  drawBackgroundShapes: [],   // Array of shape class names
  drawForegroundShapes: [],   // Array of shape class names
  customEvents: ['ch:tap', 'ch:midiready', 'ch:scoreload', 'ch:scoredraw', 'ch:pagechange'], // array of custom event types
}

ChScore.prototype._keySignatures = {
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

ChScore.prototype._getKeySignatures = function (tonality = 'major') {
  return this._keySignatures[tonality];
}


/********************** Private methods: normalize input data **********************/

// Where every chord position and measure starts, and which one each note belongs to,
// read from the Verovio timemap. Naming the place a song changes voicing needs this
// before the main loop can run, since that loop needs the parts this has yet to derive.
ChScore.prototype._indexChordPositions = function (vrvTimemap) {
  const qstamps = [];
  const byElementId = {};
  const measures = {};
  let measureId = null;
  let chordPositionCounter = 0;

  for (const entry of vrvTimemap) {
    const onIds = (entry.on ?? []).concat(entry.restsOn ?? []);
    if (entry.measureOn) {
      if (measureId) measures[measureId].endQ = entry.qstamp;
      measureId = entry.measureOn;
      measures[measureId] = { startQ: entry.qstamp, endQ: entry.qstamp, firstChordPosition: null };
    }
    if (onIds.length === 0) continue;
    // The written score is what's being measured, so where a measure is revisited
    // the first time through is the one that counts
    if (measureId && measures[measureId].firstChordPosition === null) {
      measures[measureId].firstChordPosition = chordPositionCounter;
    }
    for (const elementId of onIds) byElementId[elementId] = chordPositionCounter;
    qstamps.push(entry.qstamp);
    chordPositionCounter += 1;
  }
  if (measureId) measures[measureId].endQ = vrvTimemap.at(-1)?.qstamp ?? measures[measureId].startQ;
  // Trailing bound, so _bisectLeft can place something written at the very end
  qstamps.push(measures[measureId]?.endQ ?? 0);

  return { qstamps: qstamps, byElementId: byElementId, measures: measures };
}

ChScore.prototype._getInlineVerseNumbers = function (meiParsed) {
  const verseNumbers = [];
  let hasVerseNumberMismatch = false;
  let counter = 1;
  // Get verse numbers based on <label> elements
  const verseLabels = meiParsed.querySelectorAll('verse label');
  const lyricLinesSeen = new Set();
  for (const verseLabel of verseLabels) {
    const verse = verseLabel.closest('verse');
    const verseNumber = Number.parseInt(this._cleanMarker(verseLabel.textContent));
    const lineNumber = Number.parseInt(verse.getAttribute('n'));
    // Only the first label of a lyric line names the line. A score that lays its
    // stanzas out one after another numbers the same line again further in, and that
    // number is the stanza's, not the line's.
    const lyricLineId = `${verse.closest('staff')?.getAttribute('n') ?? ''}.${lineNumber}`;
    if (lyricLinesSeen.has(lyricLineId)) continue;
    lyricLinesSeen.add(lyricLineId);
    // Skip duplicate verse numbers, as in "Were You There", HHC
    if (verseNumbers.includes(verseNumber)) continue;
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
        const chordPosition = Number.parseInt(harmElement.getAttribute('ch-chord-position'));
        defaultChordSet.chordPositionRefs[chordPosition] = chordInfo;
      }
      harmElement.remove();
    }
    this._scoreData.chordSets.unshift(defaultChordSet);
  }
  this._scoreData.chordSetsById = {};
  for (const chordSet of this._scoreData.chordSets) {
    this._scoreData.chordSetsById[chordSet.chordSetId] = chordSet;
  }
}


/********************** Private methods: normalize parts **********************/

ChScore.prototype._normalizeParts = function (chordPositionIndex) {
  // Parts supplied by the caller win; otherwise build them from a template,
  // deriving one from the engraving when none was given
  if (this._scoreData.parts.length === 0) {
    this._scoreData.partsTemplate ||= this._derivePartsTemplate(chordPositionIndex);
    this._scoreData.parts = this._scoreData.partsTemplate ? this._buildPartsFromTemplate(
      this._scoreData.partsTemplate, this._scoreData.staffNumbers,
      this._scoreData.numChordPositions, this._scoreData.hasLyrics
    ) : [
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

  // The melody-eligible parts, in the order they sing: for a 'Two-Part' template ('P+P',
  // independent melody lines on separate staves) part-N sings rendition N, so the order is
  // load-bearing. More than one means two-part; 'Duet' ('PP', one shared staff) yields one.
  this._scoreData.melodyPartIds = Object.values(this._scoreData.partsById)
    .filter(part => /^part-\d+$/.test(part.partId) && Object.values(part.chordPositionRefs).some(ref => ref.isMelody))
    .map(part => part.partId);
  this._scoreData.hasTwoPartMelody = this._scoreData.melodyPartIds.length > 1;
}

// Derive a likely parts template heuristically, from what each staff looks like
ChScore.prototype._derivePartsTemplate = function (chordPositionIndex) {
  // Nothing is sung, so every staff is an instrument — answered without reading the
  // engraving, which also lets this be asked of a score that has none
  if (!this._scoreData.hasLyrics) return 'I';

  // Staves as a template with no chord position on it. Nothing sung anywhere is one 'I'
  // for the score, not one per staff.
  const joinPartsTemplate = staves => staves.some(staff => staff.hasLyrics)
    ? staves.map(staff => staff.partsChars).join('+')
    : 'I';

  const measureData = this._getStaffMeasureData();
  const wholeStaves = this._deriveStaffPartsChars(measureData);
  const whole = joinPartsTemplate(wholeStaves);

  // A song announcing this many changes is using its directions for something else
  const CH_MAX_SEGMENT_BOUNDARIES = 6;
  const boundaries = this._getPartsSegmentBoundaries(measureData, wholeStaves, chordPositionIndex);
  if (boundaries.length < 2 || boundaries.length > CH_MAX_SEGMENT_BOUNDARIES) return whole;

  // What belongs to the song rather than to a section of it: who sings (a descant joining
  // for the last verse sings throughout) and which staff carries the tune (a section where
  // the melody rests doesn't hand it to the descant above)
  const songFacts = {
    singingStaffNumbers: new Set(wholeStaves.filter(staff => staff.hasLyrics).map(staff => staff.staffNumber)),
    melodyStaffNumber: wholeStaves.find(staff => staff.isMelodyStaff)?.staffNumber ?? null,
  };

  const segments = [];
  for (let b = 0; b < boundaries.length; b++) {
    const endMeasure = boundaries[b + 1]?.measureIndex ?? Infinity;
    const template = joinPartsTemplate(this._deriveStaffPartsChars(
      measureData, boundaries[b].measureIndex, endMeasure, songFacts));
    const previous = segments.at(-1);
    // A section that reads the same as the one before it wasn't a change, and an
    // interlude nobody sings says nothing about how the singing around it is voiced
    if (previous && (template === previous.template || template === 'I')) continue;
    segments.push({ chordPosition: boundaries[b].chordPosition, template: template });
  }

  // Nothing changed after all, so answer for the whole song
  if (segments.length < 2) return whole;
  return segments.map(segment => `${segment.chordPosition}:${segment.template}`).join('; ');
}

// What each staff holds in each measure, read once for the whole score. A song that
// changes voicing is read a section at a time, so _getStaffLayoutInfo totals these over
// whatever range it's asked about rather than going back to the engraving each time.
ChScore.prototype._getStaffMeasureData = function () {
  const measures = Array.from(this._scoreData.meiParsed.querySelectorAll('measure'));
  const staffDefs = Array.from(this._scoreData.meiParsed.querySelectorAll('staffDef'));

  const byStaff = staffDefs.map(staffDef => ({
    staffNumber: Number.parseInt(staffDef.getAttribute('n')),
    clef: this._getClefRegister(staffDef.querySelector('clef')),
    grandStaffId: staffDef.closest('staffGrp')?.getAttribute('xml:id') ?? null,
    byMeasure: measures.map(() => ({
      // Every question a range gets asked reduces to totalling these, so none of it
      // holds on to the engraving it was read from
      voiceCounts: {},
      melodyLayerNotes: 0,
      melodyLayerChordNotes: 0,
      syllables: 0,
      secondVoice: 0,
      sounds: false,
      hasVerse: false,
      sung: 0,
      shortOfTwoParts: 0,
      lowerVoiceCantSing: 0,
    })),
  }));

  const byStaffNumber = new Map(byStaff.map(staffData => [staffData.staffNumber, staffData]));
  for (let mi = 0; mi < measures.length; mi++) {
    for (const staff of measures[mi].querySelectorAll('staff')) {
      const staffData = byStaffNumber.get(Number.parseInt(staff.getAttribute('n')));
      if (!staffData) continue;
      const measure = staffData.byMeasure[mi];

      const layers = Array.from(staff.querySelectorAll('layer'));
      this._countMeasureVoices(layers, measure.voiceCounts);
      // Some staves number their only layer 2 (a stem-direction convention),
      // so fall back to whichever layer comes first
      const melodyLayer = staff.querySelector('layer[n="1"]') ?? staff.querySelector('layer');
      if (melodyLayer) {
        const melodyNotes = melodyLayer.querySelectorAll('note');
        measure.melodyLayerNotes += melodyNotes.length;
        for (const note of melodyNotes) {
          if (note.parentElement?.matches('chord')) measure.melodyLayerChordNotes += 1;
        }
        const counts = this._countLowerVoiceNotes(melodyLayer, layers);
        measure.syllables += counts.syllablePositions;
        measure.secondVoice += counts.secondVoiceEvents;
        // The staff is only compared with the one above where its second voice
        // is singing: silent for the measure, or written a rest, it's tacet
        measure.sounds = measure.sounds
          || (staff.querySelector('note') !== null && !counts.secondVoiceResting);
        if (counts.syllablePositions > 0) {
          measure.sung += 1;
          const short = counts.lowerVoiceNotes < counts.syllablePositions;
          if (short) measure.shortOfTwoParts += 1;
          // Whether a staff is accompanied is only asked of one with a second
          // voice engraved as its own layer: a staff of plain single notes is
          // short everywhere, which says nothing about who is harmonizing it
          if (short && layers.length > 1) measure.lowerVoiceCantSing += 1;
        }
      }
      if (staff.querySelector('verse')) measure.hasVerse = true;
    }
  }

  return { measures: measures, byStaff: byStaff };
}

// Work out heuristically what each staff holds over a range of measures, as staves with
// their parts characters filled in, which _derivePartsTemplate spells out as a template.
ChScore.prototype._deriveStaffPartsChars = function (measureData, startMeasure = 0, endMeasure = Infinity, songFacts = null) {
  const staves = this._getStaffLayoutInfo(measureData, startMeasure, endMeasure, songFacts);

  // Nothing is sung here, so there is no voicing to read
  if (!staves.some(staff => staff.hasLyrics)) return staves;

  // The staves braced together in each system, which is what says whether a staff
  // that doesn't sing belongs to the singers or to an instrument of its own. A Map,
  // so a null grandStaffId stays null rather than becoming the string "null".
  const staffSystems = new Map();
  for (const staff of staves) {
    if (!staffSystems.has(staff.grandStaffId)) staffSystems.set(staff.grandStaffId, []);
    staffSystems.get(staff.grandStaffId).push(staff);
  }

  // Two or more staves braced together that nobody sings from are an instrument's
  // own system — a piano's pair of staves — which says the singers are elsewhere
  const singerGroup = staves.find(staff => staff.hasLyrics)?.grandStaffId;
  const accompanimentIsElsewhere = [...staffSystems].some(([grandStaffId, system]) =>
    grandStaffId !== singerGroup && system.length > 1 && system.every(staff => !staff.hasLyrics));

  const melodyIndex = staves.findIndex(staff => staff.isMelodyStaff);

  for (let s = 0; s < staves.length; s++) {
    const staff = staves[s];
    const previous = staves[s - 1];

    // A staff over the melody is an extra line above it: a descant when it sings too,
    // an obbligato when it never does. Only the staff immediately above can be an
    // obbligato — anything higher and silent is playing something else.
    if (s < melodyIndex && staves.length >= 3) {
      if (staff.hasLyrics) {
        staff.partsChars = 'D';
      } else if (s === melodyIndex - 1) {
        staff.partsChars = 'O';
      }
    }

    if (staff.partsChars) continue;

    if (staff.hasLyrics) {
      // Words over chords are several parts sharing a staff, whether written as chords
      // or as layers of their own; either way every word has a note under it. Words over
      // a single line are one part, left 'P' until the run signatures below name it.
      const writtenInParts = staff.hasChordsInMelodyLayer || staff.hasTwoPartCoverage;
      if (writtenInParts && !staff.isAccompanied) {
        staff.partsChars = 'P'.repeat(staff.numParts);
      } else if (staff.numParts === 1 && !staff.hasChordsInMelodyLayer) {
        staff.partsChars = 'P';
      } else {
        // Chorded, but by something that isn't singing along — one voice, and an
        // instrument filling in the harmony on the same staff
        staff.partsChars = 'MC';
      }
    } else if (previous?.hasLyrics && previous.grandStaffId === staff.grandStaffId) {
      // A silent staff braced to a singing one carries on what that staff was: more
      // voices below several sharing a staff, or more accompaniment. A lone vocal line
      // above it doesn't count — that leaves the piano a piano.
      const voicesAbove = previous.partsChars.length > 1 && previous.partsChars.endsWith('P');
      // Braced with the singers while the accompaniment has a system of its own, it's
      // another voice however sparely written. Otherwise it needs chords of its own and
      // the notes to sing the words above: a sparse left hand is an accompaniment.
      const readAsVoices = accompanimentIsElsewhere
        || (staff.hasChordsInMelodyLayer && this._coversWordsAbove(staff, previous));
      staff.partsChars = voicesAbove && readAsVoices ? 'P'.repeat(staff.numParts) : 'C';
    } else {
      staff.partsChars = 'C';
    }
  }

  // Accompaniment almost never gets a staff to itself, so a lone one means the staff
  // above holds the piano's other half — over either singers or just a right hand
  // doubling the melody. A duet keeps up with every syllable; a doubling drops out.
  if (staves.filter(staff => staff.partsChars === 'C').length === 1) {
    for (const staff of staves) {
      if (!staff.hasLyrics || !/^PP+$/.test(staff.partsChars)) continue;
      staff.partsChars = staff.hasTwoPartCoverage ? `${staff.partsChars}C` : 'MC';
    }
  }

  // Name the interchangeable parts, now that every staff is known: which voices
  // "two parts in a treble clef" are depends on what the staves around it hold
  const isParts = staff => /^P+$/.test(staff.partsChars);
  const signature = run => run.map(staff => `${staff.clef}${staff.partsChars.length}`).join('+');

  // Voicings for a run of adjacent staves of interchangeable parts, keyed by each
  // staff's clef and part count — an SATB hymn is two parts over two parts, and
  // the same hymn in open score is four staves of one part each
  const CH_VOICES_BY_STAFF_RUN = {
    'G2+G2': ['SS', 'AA'],
    'F2+F2': ['TT', 'BB'],
    'G2+F2': ['SA', 'TB'],
    'G1+F2': ['S', 'TB'],
    'G2+F1': ['SA', 'B'],
    'G2+G1': ['SS', 'A'],
    'G3+F2': ['SSA', 'TB'],
    'G2+F3': ['SA', 'TTB'],
    'G3+F3': ['SSA', 'TTB'],
    'C2+F2': ['TT', 'BB'],
    'C1+F2': ['T', 'BB'],
    'C2+F1': ['TT', 'B'],
    'C2+C2': ['TT', 'BB'],
    'C2+C1': ['TT', 'B'],
    'C1+C1+F1+F1': ['T', 'T', 'B', 'B'],
    'C1+C1+F1': ['T', 'T', 'B'],
    'C1+F1+F1': ['T', 'B', 'B'],
    'G1+G1+F1+F1': ['S', 'A', 'T', 'B'],
    'G1+G1+F1': ['S', 'A', 'B'],
    'G1+F1+F1': ['S', 'T', 'B'],
  };

  // Three interchangeable parts on a staff of their own, by clef — a men's-voice clef
  // has no soprano, like a bass clef. Four on one staff stay 'PPPP': 'SSAA' reads back
  // as two staves of two, moving half of them onto the staff below.
  const trioByClef = { 'G': 'SSA', 'F': 'TTB', 'C': 'TTB' };
  
  for (let s = 0; s < staves.length; s++) {
    if (!isParts(staves[s])) continue;

    // The whole run of staves written as parts, which is what names them
    let end = s;
    while (end + 1 < staves.length && isParts(staves[end + 1])) end++;
    const run = staves.slice(s, end + 1);

    const whole = CH_VOICES_BY_STAFF_RUN[signature(run)];
    if (whole) {
      run.forEach((staff, index) => { staff.partsChars = whole[index]; });
      s = end;
      continue;
    }

    // No voicing for the run as a whole, so take the largest piece of it that is
    // named, and fall back to naming a staff on its own
    for (let r = 0; r < run.length; r++) {
      const pair = CH_VOICES_BY_STAFF_RUN[signature(run.slice(r, r + 2))];
      if (pair) {
        [run[r].partsChars, run[r + 1].partsChars] = pair;
        r++;
        continue;
      }
      if (run[r].partsChars.length === 3) run[r].partsChars = trioByClef[run[r].clef] ?? run[r].partsChars;
    }
    s = end;
  }

  // A lone part no voicing claimed, read by what shares its staff system: alone on a
  // staff it's the voice by itself, maybe unaccompanied ('M'); braced only to silent
  // staves it's an accompanied melody ('MC'); braced to another voice it stays a part.
  for (const staff of staves) {
    if (staff.partsChars !== 'P') continue;
    const system = staffSystems.get(staff.grandStaffId);
    if (!staff.hasLyrics) staff.partsChars = 'C';
    else if (system.length === 1) staff.partsChars = 'M';
    else if (system.filter(other => other.hasLyrics).length === 1) staff.partsChars = 'MC';
  }

  return staves;
}

// What each staff looks like over a range of measures. Chord positions aren't annotated
// yet, so a staff's first lyric is located by the measure it falls in. The range is the
// whole score unless a section is read on its own, when `songFacts` supplies the two
// things a section must not answer for itself: who sings, and who carries the tune.
ChScore.prototype._getStaffLayoutInfo = function (measureData, startMeasure = 0, endMeasure = Infinity, songFacts = null) {
  const staves = [];
  const end = Math.min(endMeasure, measureData.measures.length);

  for (const staffData of measureData.byStaff) {
    const voiceCounts = {};
    let melodyLayerNotes = 0;
    let melodyLayerChordNotes = 0;
    let firstLyricMeasure = null;
    let measuresLowerVoiceCantSing = 0;
    let sungMeasures = 0;
    let measuresShortOfTwoParts = 0;
    // Kept at each measure's own index, so a staff that rests through a passage can be
    // compared with the one above it over the measures it plays. _coversWordsAbove skips
    // the gaps, which is what keeps a section's reading to the measures in it.
    const syllablesByMeasure = [];
    const secondVoiceByMeasure = [];
    const soundsByMeasure = [];

    for (let mi = startMeasure; mi < end; mi++) {
      const measure = staffData.byMeasure[mi];
      for (const [voices, count] of Object.entries(measure.voiceCounts)) {
        voiceCounts[voices] = (voiceCounts[voices] ?? 0) + count;
      }
      melodyLayerNotes += measure.melodyLayerNotes;
      melodyLayerChordNotes += measure.melodyLayerChordNotes;
      if (measure.syllables) syllablesByMeasure[mi] = measure.syllables;
      if (measure.secondVoice) secondVoiceByMeasure[mi] = measure.secondVoice;
      if (measure.sounds) soundsByMeasure[mi] = true;
      sungMeasures += measure.sung;
      measuresShortOfTwoParts += measure.shortOfTwoParts;
      measuresLowerVoiceCantSing += measure.lowerVoiceCantSing;
      if (firstLyricMeasure === null && measure.hasVerse) firstLyricMeasure = mi;
    }

    // Whether the staff is written as chords, rather than merely containing one:
    // a line with a couple of divisi notes, or an alternate note for a second
    // time through, is still one part
    const hasChordsInMelodyLayer = melodyLayerChordNotes * 2 > melodyLayerNotes;

    // How many voices share the staff, by how many notes sound together — two can share
    // a chord in one bar and split into layers in the next. The commonest number wins
    // rather than the largest, so one divisi chord in a cadence doesn't make it three.
    const voices = Object.keys(voiceCounts).map(Number);
    const numParts = voices.length === 0 ? 1
      : voices.reduce((best, n) => voiceCounts[n] > voiceCounts[best] ? n : best, voices[0]);

    const CH_UNSINGABLE_MEASURES = 3;
    staves.push({
      staffNumber: staffData.staffNumber,
      clef: staffData.clef,
      hasLyrics: songFacts
        ? songFacts.singingStaffNumbers.has(staffData.staffNumber)
        : firstLyricMeasure !== null,
      firstLyricMeasure: firstLyricMeasure,
      hasChordsInMelodyLayer: hasChordsInMelodyLayer,
      // The staff is harmonized by an instrument, not by other singers — read per
      // section, since that changing is what "0:Unison; 78:SATB" describes
      isAccompanied: measuresLowerVoiceCantSing >= CH_UNSINGABLE_MEASURES,
      // Enough notes under the melody, everywhere it sings, for a second voice to
      // sing every word with it — whether as chords or as a layer of its own
      hasTwoPartCoverage: sungMeasures > 0 && measuresShortOfTwoParts === 0,
      syllablesByMeasure: syllablesByMeasure,
      // What a second voice on this staff would have to sing with, whether the
      // staff carries words of its own or not, and where it plays at all
      secondVoiceByMeasure: secondVoiceByMeasure,
      soundsByMeasure: soundsByMeasure,
      numParts: numParts,
      grandStaffId: staffData.grandStaffId,
      isMelodyStaff: false,
      partsChars: null,
    });
  }

  // The melody is on the staff that starts singing first. Staves above it sing
  // over it rather than carrying it, whatever number they happen to be — an
  // introduction on its own staves can leave the melody well down the system.
  const singingStaves = staves.filter(staff => staff.hasLyrics);
  const melodyStaff = songFacts
    ? staves.find(staff => staff.staffNumber === songFacts.melodyStaffNumber)
    : singingStaves.reduce((earliest, staff) =>
      staff.firstLyricMeasure < earliest.firstLyricMeasure ? staff : earliest, singingStaves[0]);
  if (melodyStaff) melodyStaff.isMelodyStaff = true;

  return staves;
}

// Where the song might change its voicing, from the directions over the staves. A change
// is announced — "Harmony", "Unison", "Sop 1" — but in whatever words the engraver chose,
// so every direction is a candidate; sections that read the same are merged again.
ChScore.prototype._getPartsSegmentBoundaries = function (measureData, wholeStaves, chordPositionIndex) {
  const accompanimentStaves = new Set(wholeStaves
    .filter(staff => !staff.hasLyrics || staff.partsChars === 'C')
    .map(staff => String(staff.staffNumber)));

  // The chord position an element is attached to, by @startid or @tstamp — the same
  // reading the @ch-chord-position pass makes, from the index rather than the annotations
  const indexedChordPosition = (element, measureId) => {
    if (!chordPositionIndex) return null;

    const startid = element.getAttribute('startid')?.substring(1);
    if (startid && startid in chordPositionIndex.byElementId) return chordPositionIndex.byElementId[startid];

    const measureInfo = this._scoreData.measuresById[measureId];
    const indexedMeasure = chordPositionIndex.measures[measureId];
    const tstamp = Number.parseFloat(element.getAttribute('tstamp'));
    if (tstamp && measureInfo && indexedMeasure) {
      // Convert tstamp (1-based position in time signature denominator notes, relative to measure) to qstamp (0-based position in quarter notes, relative to song)
      const quartersPerBeat = 4 / measureInfo.timeSignature[1];
      const qstamp = Math.min(indexedMeasure.endQ, indexedMeasure.startQ + ((tstamp - 1) * quartersPerBeat));
      return this._bisectLeft(chordPositionIndex.qstamps, qstamp);
    }

    // Nothing to place it by: the measure it sits in is as close as this gets
    return indexedMeasure?.firstChordPosition ?? null;
  };

  // Text that isn't a direction but is engraved as one. Could be guitar chords, hand and octave marks, and jumps/navigation, etc.
  const CH_CHORD_SYMBOL = /^\(?[A-G][#b♯♭]?(m|maj|min|dim|aug|sus|add|°|ø)?\d*(\/[A-G][#b♯♭]?)?\)?$/;
  const CH_FALSE_POSITIVE = /^(r\.?h\.?|l\.?h\.?|8vb|8va|simile|sim\.|[()]|[➀-➓]|[0-9]+\.?)$/i;

  const boundaries = [{ measureIndex: 0, chordPosition: 0 }];
  for (let mi = 1; mi < measureData.measures.length; mi++) {
    const measure = measureData.measures[mi];
    // Tempo and dynamic marks are elements of their own, so most of what is written over
    // a staff isn't a <dir>. Of what is, anything addressed to the singers is placed above
    // or below the staff — guitar chords carry no placement — and navigation is named.
    for (const dir of measure.querySelectorAll('dir[place]:not([type="coda"], [type="tocoda"], [type="segno"], [type="dalsegno"], [type="dacapo"], [type="fine"])')) {
      const staff = dir.getAttribute('staff');
      if (staff && accompanimentStaves.has(staff)) continue;
      const text = dir.textContent.trim();
      if (!text || text === '⌜' || text === '⌝') continue;
      if (CH_CHORD_SYMBOL.test(text) || CH_FALSE_POSITIVE.test(text)) continue;

      const chordPosition = indexedChordPosition(dir, measure.getAttribute('xml:id'));
      if (chordPosition === null) continue;
      boundaries.push({ measureIndex: mi, chordPosition: chordPosition });
      // One direction per measure is enough — the rest only mark the same place again
      break;
    }
  }

  // A boundary is only worth taking if the section it opens is long enough to read —
  // three measures is already the threshold at which a staff counts as accompanied. Where
  // directions cluster this keeps the last, which is where the music actually changes.
  const CH_MIN_SEGMENT_MEASURES = 4;
  return boundaries.filter((boundary, b) => {
    const next = boundaries[b + 1]?.measureIndex ?? measureData.measures.length;
    return b === 0 || next - boundary.measureIndex >= CH_MIN_SEGMENT_MEASURES;
  });
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
    .replaceAll('Melody', 'M') // Melody alone without accompaniment
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
      partsTemplateChordPositions.push(Number.parseInt(partsTemplates[vm].split(':')[0]));
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
      n = Number.parseInt(char[1]);
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
      const capitalizedWord = word[0].toUpperCase() + word.slice(1);
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
    const chordPosition = Number.parseInt(chordPositionStr);

    // Get melody part
    let chars, melodyChar;
    if (charsAndMelody.includes('#')) {
      [chars, melodyChar] = charsAndMelody.split('#');
    } else {
      chars = charsAndMelody;
      melodyChar = chars.split('').find(char => likelyMelodyChars.includes(char)) || chars[0];
    }
    const melodyPartId = getPartId(melodyChar, '', splitPartChars);
    // 'Two-Part' ('P+P') splits into part-1, part-2, … but the melody char above always
    // resolves to the first. Both are independent melody lines, so flag every part-N.
    // Requiring 'P' in more than one '+'-separated staff segment keeps 'Duet' ('PP', one
    // shared staff) out.
    const staffSegmentsWithP = chars.split('+').filter(segment => segment.includes('P')).length;
    const isTwoPartMelody = melodyChar === 'P' && splitPartChars.includes('P') && staffSegmentsWithP > 1;

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
          isMelody: isTwoPartMelody ? partId.startsWith('part-') : partId === melodyPartId,
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

// An element's timed events in document order, looking through the containers that can
// wrap them
ChScore.prototype._layerEvents = function (element, events = []) {
  for (const child of element.children) {
    if (child.matches('note, chord, rest, space, mRest')) events.push(child);
    else if (child.matches('beam, tuplet, graceGrp, bTrem, fTrem')) this._layerEvents(child, events);
  }
  return events;
}

// What a note or rest is worth as a fraction of a whole note, tuplets included — a triplet
// eighth inside <tuplet num="3" numbase="2"> is 1/8 × 2/3. Null where it carries no @dur.
ChScore.prototype._wholeNotesOf = function (element) {
  const dur = Number.parseInt(element.getAttribute('dur'));
  if (!dur) return null;
  const dots = Number.parseInt(element.getAttribute('dots')) || 0;
  let value = (1 / dur) * (2 - Math.pow(2, -dots));
  for (let ancestor = element.parentElement;
    ancestor && !ancestor.matches('layer'); ancestor = ancestor.parentElement) {
    if (!ancestor.matches('tuplet')) continue;
    const num = Number.parseInt(ancestor.getAttribute('num'));
    const numbase = Number.parseInt(ancestor.getAttribute('numbase'));
    if (num && numbase) value *= numbase / num;
  }
  return value;
}

// The single rest worth that many whole notes, or null where no plain rest is (5/8 of a
// whole note has to stay written as more than one)
ChScore.prototype._restAttributesFor = function (wholeNotes) {
  for (const dots of [0, 1, 2]) {
    const dotted = 2 - Math.pow(2, -dots);
    const dur = Math.round(dotted / wholeNotes);
    if (dur >= 1 && dur <= 128 && (dur & (dur - 1)) === 0
      && Math.abs(dotted / dur - wholeNotes) < 1e-9) return { dur, dots };
  }
  return null;
}

// How often each number of voices sounds together across one staff of one measure,
// as a tally keyed by that number. Kept per measure so a range of them can be totalled
// without going back to the engraving — see _getStaffMeasureData.
ChScore.prototype._countMeasureVoices = function (layers, counts = {}) {
  const spans = [];
  for (const layer of layers) {
    let time = 0;
    for (const event of this._layerEvents(layer)) {
      const notes = event.matches('chord') ? event.querySelectorAll('note').length
                  : event.matches('note') ? 1 : 0;
      const duration = Number.parseInt(event.getAttribute('dur.ppq') ?? '0') || 0;
      if (notes > 0) spans.push({ start: time, end: time + duration, notes });
      time += duration;
    }
  }

  // Sweep the spans in time order rather than re-totalling them at every onset. A
  // span sounds through an onset once started and before ended, so both its start and
  // its end apply at any onset at or after them — no ordering left to settle.
  const events = [];
  for (const span of spans) {
    if (span.end <= span.start) continue;
    events.push({ time: span.start, delta: span.notes });
    events.push({ time: span.end, delta: -span.notes });
  }
  events.sort((a, b) => a.time - b.time);

  const onsets = [...new Set(spans.map(span => span.start))].sort((a, b) => a - b);
  let next = 0;
  let sounding = 0;
  for (const onset of onsets) {
    while (next < events.length && events[next].time <= onset) sounding += events[next++].delta;
    if (sounding > 0) counts[sounding] = (counts[sounding] ?? 0) + 1;
  }
  return counts;
}

// How many syllables the melody sings in this measure, and how many notes the voice
// below has to sing them with. A piano's right hand doubling a line holds one note
// under several syllables; a real second voice articulates every one.
ChScore.prototype._countLowerVoiceNotes = function (melodyLayer, layers) {
  const sungPositions = Array.from(melodyLayer.querySelectorAll('chord, note'))
    .filter(element => element.matches('chord') || !element.closest('chord'))
    .filter(element => element.querySelector('verse'));

  // Each verse counted on its own: stacked verses break words differently, and the
  // sparsest line is what the voice below has to keep up with.
  const lineNumbers = new Set();
  for (const verse of melodyLayer.querySelectorAll('verse')) {
    lineNumbers.add(verse.getAttribute('n') ?? '1');
  }
  // Syllable positions, not verse elements: a note carrying four stanzas is
  // still one place where a syllable is sung, and a syllable held over several
  // notes is one place too
  const syllablePositions = sungPositions.length === 0 ? 0
    : Math.min(...Array.from(lineNumbers, lineNumber =>
        sungPositions.filter(element => element.querySelector(`verse[n="${lineNumber}"]`)).length));

  // The lower voice sounds once per chord it shares with the melody, plus once
  // per note of its own
  let lowerVoiceNotes = melodyLayer.querySelectorAll('chord').length;
  // Rests count wherever they fall, the melody layer included: on a staff written in
  // chords a rest silences every voice on it, and a part entering or leaving a tacet
  // passage mid-measure is marked by nothing else.
  let secondVoiceRests = melodyLayer.querySelectorAll('rest, mRest, space').length;
  for (const layer of layers) {
    if (layer === melodyLayer) continue;
    const chordNotes = layer.querySelectorAll('chord note').length;
    lowerVoiceNotes += layer.querySelectorAll('note, chord').length - chordNotes;
    secondVoiceRests += layer.querySelectorAll('rest, mRest, space').length;
  }

  // A voice written a rest here has somewhere to be and isn't singing this bar —
  // which is a part resting, not a part missing. Where nothing is written for it
  // at all, there was never a second voice to rest.
  const secondVoiceResting = lowerVoiceNotes === 0 && secondVoiceRests > 0;

  return {
    syllablePositions,
    lowerVoiceNotes,
    // What the voice has to answer for the words above: the notes it sings, and
    // the rests that say it isn't meant to be singing them
    secondVoiceEvents: lowerVoiceNotes + secondVoiceRests,
    secondVoiceResting,
  };
}

// Whether a silent staff has notes enough to be singing the words above it. Only the
// measures it plays in count: a staff resting under a whole verse isn't failing to
// sing it — it's tacet, and its rests say so.
const CH_COVERED_FRACTION = 0.95;
ChScore.prototype._coversWordsAbove = function (staff, singingStaff) {
  let secondVoiceNotes = 0;
  let syllablePositions = 0;
  for (let mi = 0; mi < staff.soundsByMeasure.length; mi++) {
    if (!staff.soundsByMeasure[mi]) continue;
    const syllables = singingStaff.syllablesByMeasure[mi] ?? 0;
    // A measure counts as covered at most once: spare notes in one bar say
    // nothing about a bar where the voice came up short
    secondVoiceNotes += Math.min(staff.secondVoiceByMeasure[mi] ?? 0, syllables);
    syllablePositions += syllables;
  }
  return secondVoiceNotes >= CH_COVERED_FRACTION * syllablePositions;
}

// Which voices a clef puts on the staff: 'G' treble, 'F' bass, 'C' men's voices. A
// treble clef marked to sound an octave lower is how modern engraving writes a tenor
// line, so it says what a C clef says — no sopranos — and is read the same way.
ChScore.prototype._getClefRegister = function (clef) {
  const shape = clef?.getAttribute('shape') ?? null;
  const soundsOctaveLower = clef?.getAttribute('dis') === '8'
    && clef?.getAttribute('dis.place') === 'below';
  return shape === 'G' && soundsOctaveLower ? 'C' : shape;
}


/********************** Private methods: normalize sections **********************/

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
    for (const { start, end } of lyricChordPositionRanges) {
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
  const verseNumbers = this._getInlineVerseNumbers(this._scoreData.meiParsed);
  const hasIntroBrackets = this._getIntroBrackets(this._scoreData.meiParsed).length > 0;
  const [hasComplexSections, hasInitialChorus, expansionIds] = this._updateExpansionElement(this._scoreData.meiParsed, verseNumbers.length, hasIntroBrackets, this._scoreData.hasRepeatOrJump);

  let introSection;
  let otherSections = [];
  // Use existing sections
  if (hasPrebuiltSections) {
    introSection = this._scoreData.sections[0].type === 'introduction' ? this._scoreData.sections[0] : null;
    otherSections = introSection ? this._scoreData.sections.slice(1) : this._scoreData.sections;
  // Generate sections based on simple score structure
  } else {
    introSection = this._getIntroSectionFromBrackets(this._scoreData.meiParsed, this._scoreData.staffNumbers);
    if (!hasComplexSections) otherSections = this._generateSectionsFromSimpleScore(verseNumbers, hasInitialChorus);
  }

  let firstLyricExpandedChordPosition = 0;
  if (introSection) {
    firstLyricExpandedChordPosition = 0;
    for (const chordPositionRange of introSection.chordPositionRanges) {
      firstLyricExpandedChordPosition += chordPositionRange.end - chordPositionRange.start;
    }
  }

  // Get sequential lyric chord position ranges. Ranges that came from a section
  // carry its type, and the first one is marked as starting it, so the stanzas
  // built from them line up with the sections they came from.
  const lyricChordPositionRanges = [];
  if (otherSections.length > 0) {
    for (const sectionInfo of otherSections) {
      for (let cpr = 0; cpr < sectionInfo.chordPositionRanges.length; cpr++) {
        const chordPositionRange = sectionInfo.chordPositionRanges[cpr];
        lyricChordPositionRanges.push({
          start: chordPositionRange.start,
          end: chordPositionRange.end,
          sectionType: sectionInfo.type,
          startsSection: cpr === 0,
        });
      }
    }
  } else if (this._scoreData.hasExpansion) {
    const expansion = this._scoreData.meiParsed.querySelector('expansion[plist]');
    const expansionSectionElementIds = expansion.getAttribute('plist').trim().split(' ').map(sid => sid.substring(1));
    for (const expansionSectionElementId of expansionSectionElementIds) {
      const sectionElement = this._scoreData.meiParsed.querySelector(`[*|id="${expansionSectionElementId}"]`);
      const sectionElementChordPositions = sectionElement.getAttribute('ch-chord-position').trim().split(' ').map(cp => Number.parseInt(cp));
      lyricChordPositionRanges.push({
        start: sectionElementChordPositions[0],
        end: sectionElementChordPositions.at(-1) + 1,
      });
    }
  } else {
    lyricChordPositionRanges.push({ start: 0, end: this._scoreData.numChordPositions });
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

  // A stanza that isn't sung from the staff: a lyric line playback never reached, or
  // a verse printed under the music. The shape is the same either way.
  const newSectionBelow = (counter, { type, name, marker, annotatedLyrics, chordPositionRanges = [] }) => ({
    sectionId: `below-${counter}`,
    type: type,
    name: name,
    marker: marker,
    placement: 'below',
    pauseAfter: false,
    chordPositionRanges: chordPositionRanges,
    annotatedLyrics: annotatedLyrics,
  });

  // Add annotated lyrics to sections
  let sectionBelowCounter = 0;
  let si = 0;
  for (let ls = 0; ls < lyricStanzas.length; ls++) {
    const lyricStanza = lyricStanzas[ls];
    const stanzaStart = lyricStanza.chordPositionRanges[0]?.start;
    // A stanza with no real range at all (e.g. text printed below the music, never
    // sung from the staff) has no position to match — searching for `undefined`
    // would coincidentally "match" another rangeless section already filled in an
    // earlier iteration (undefined === undefined), so skip straight to the
    // list-position fallback instead of searching.
    let pi = stanzaStart !== undefined ? si : otherSections.length;
    while (pi < otherSections.length && otherSections[pi].chordPositionRanges[0]?.start !== stanzaStart) pi += 1;
    const foundByPosition = pi < otherSections.length;
    const section = foundByPosition ? otherSections[pi] : otherSections[ls];

    if (section?.type === lyricStanza.type && !section.annotatedLyrics) {
      section.annotatedLyrics = lyricStanza.annotatedLyrics;
      if (foundByPosition) si = pi + 1;
    } else if (!section) {
      otherSections.push(newSectionBelow(sectionBelowCounter, lyricStanza));
      sectionBelowCounter += 1;
    } else {
      // A section exists here but doesn't match (already annotated some other
      // way, or genuinely a different type) — sections were built by a path this
      // stanza list isn't in step with, so stop rather than guess; this is the
      // same bailout the original position-paired version used.
      break;
    }
  }

  // Add verses printed below the music (from <pgHead> or <pgFoot>) that aren't
  // sung from the staff. Example: "Redeemer of Israel" (1985 Hymns), where
  // verses 5 and 6 appear as text under the score.
  //
  // A below-music verse has no staff of its own to repeat the chorus, so it's added
  // back here, reusing the sung chorus's wording. Found by repeated text, not
  // `type === 'chorus'`: complex-sections songs skip the type detection that would set it.
  const annotatedLyricsCounts = new Map();
  for (const section of otherSections) {
    if (!section.annotatedLyrics) continue;
    annotatedLyricsCounts.set(section.annotatedLyrics, (annotatedLyricsCounts.get(section.annotatedLyrics) ?? 0) + 1);
  }
  const referenceChorus = otherSections.find(section => annotatedLyricsCounts.get(section.annotatedLyrics) > 1);
  // For comparing against a below verse's own text, which keeps the page's own line
  // breaks rather than the sung chorus's normalized single line ("nearer-my-god-to-thee",
  // where the printed verse already ends with its own copy of the refrain).
  const foldWords = text => text?.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase() ?? '';
  const foldedReferenceChorus = foldWords(referenceChorus?.annotatedLyrics);
  for (const textBlock of this._scoreData.scoreMetadata?.stanzas ?? []) {
    // One block of text can hold several verses, separated by blank lines
    for (const stanzaText of textBlock.split(/\n\s*\n/)) {
      // A verse marker is 1 or 2 digits — a longer run is something else printed the
      // same way, like a copyright year ("1982. Text © ...") in an attribution block.
      const [, marker, annotatedLyrics] = /^\s*(\d{1,2})\s*[.)]\s*([\s\S]*)$/.exec(stanzaText) ?? [];
      if (!annotatedLyrics) continue;

      // Skip verses that are already sung from the staff
      const alreadyPresent = otherSections.some(section => this._cleanMarker(section.marker) === marker);
      if (alreadyPresent) continue;

      otherSections.push(newSectionBelow(sectionBelowCounter, {
        type: 'verse',
        name: `Verse ${marker}`,
        marker: marker,
        annotatedLyrics: annotatedLyrics,
      }));
      sectionBelowCounter += 1;

      // Some hymns print each verse below the music with its own copy of the refrain
      // already at the end (its "chorus" isn't a separate section at all, sung or
      // printed); don't add a second one on top of it.
      if (referenceChorus && !foldWords(annotatedLyrics).endsWith(foldedReferenceChorus)) {
        otherSections.push(newSectionBelow(sectionBelowCounter, {
          type: 'chorus',
          name: referenceChorus.name,
          annotatedLyrics: referenceChorus.annotatedLyrics,
        }));
        sectionBelowCounter += 1;
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

  // Save lyrics if lyrics weren't provided
  if (!this._scoreData.lyricsText) {
    const stanzaTexts = [];
    for (const section of this._scoreData.sections) {
      if (!section.annotatedLyrics) continue;
      const name = section.name || this._stanzaName(section);
      stanzaTexts.push(`[${name}]\n${section.annotatedLyrics}`);
    }
    this._scoreData.lyricsText = stanzaTexts.join('\n\n') || null;
  }

}

ChScore.prototype._updateExpansionElement = function (meiParsed, numVerses, hasIntroBrackets, hasRepeatOrJump) {
  // Check for complex sections and update expansion map
  // TODO: If expansion map doesn't exist, add it
  let hasComplexSections = false;
  let hasInitialChorus = false;
  let expansionIds = [];
  const measures = Array.from(meiParsed.querySelectorAll('measure'));
  const expansion = meiParsed.querySelector('expansion');
  if (expansion && numVerses > 0) {
    expansionIds = expansion.getAttribute('plist').split(' ');

    // Simple song with verses or verses and choruses
    // Examples: "The Spirit of God" (1985 Hymns), "Redeemer of Israel" (1985 Hymns)
    if (expansionIds.length === 1) {
      expansion.setAttribute('plist', Array(numVerses).fill(expansionIds[0]).join(' '));
      const sectionElement = meiParsed.querySelector(`[*|id="${expansionIds[0].substring(1)}"]`);
      sectionElement.setAttribute('type', 'verse');

    // Simple song with initial chorus, then verses and choruses
    // Examples: "All Things Bright and Beautiful" (1989 CSB); "He Is Born, the Divine Christ Child" (HHC); "Go Tell It on the Mountain" (HHC)
    } else if (expansionIds.length === 2 || (expansionIds.length === 3 && expansionIds[0] === expansionIds[2])) {
      const firstSectionElement = meiParsed.querySelector(`[*|id="${expansionIds[0].substring(1)}"]`);
      const firstSectionMeasures = Array.from(firstSectionElement.querySelectorAll('measure'));
      const secondSectionElement = meiParsed.querySelector(`[*|id="${expansionIds[1].substring(1)}"]`);
      const secondSectionMeasures = Array.from(secondSectionElement.querySelectorAll('measure'));
      if (firstSectionMeasures.at(-1).getAttribute('right') === 'end' &&
          secondSectionMeasures.at(-1).getAttribute('right') === 'dbl') {
        firstSectionElement.setAttribute('type', 'chorus');
        secondSectionElement.setAttribute('type', 'verse');
        hasInitialChorus = true;
        const repeatedSection = Array(numVerses).fill([expansionIds[0], expansionIds[1]]).flat();
        expansion.setAttribute('plist', [...repeatedSection, expansionIds[0]].join(' '));
      } else {
        hasComplexSections = true;
      }
    } else {
      hasComplexSections = true;
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

    expansion.setAttribute('type', hasComplexSections ? 'complex' : hasInitialChorus ? 'chorus-verse-chorus' : 'verse-chorus');
  } else if (
    hasRepeatOrJump
    || measures.at(-1).getAttribute('right') !== 'end' // Last measure isn't end of song
    || meiParsed.querySelectorAll('measure[right="end"]').length > 1 // Multiple end barlines (ex: For All the Saints, 1985 Hymns)
    || !measures[0].querySelector('verse') // No lyrics in first measure (ex: Families Can Be Together Forever, 1985 Hymns)
    || (meiParsed.querySelector('verse:not([n="1"])') && numVerses === 0) // Multiple lyric lines but no verse labels
    || numVerses === 0
  ) {
    hasComplexSections = true;
  }

  return [hasComplexSections, hasInitialChorus, expansionIds];
}

// Get piano introduction brackets in a document, as { start, end } pairs with the element, chord position, tstamp and measure number. Incomplete bracket pairs are dropped, for example, in "The Lord's My Shepherd" (HHC).
ChScore.prototype._getIntroBrackets = function (meiParsed) {
  const introBrackets = [];
  let openBracket = null;
  for (const element of meiParsed.querySelectorAll('[ch-intro-bracket]')) {
    const bracket = {
      element: element,
      chordPosition: Number.parseInt(element.getAttribute('ch-chord-position')),
      tstamp: Number.parseFloat(element.getAttribute('tstamp')),
      measureNumber: element.closest('measure')?.getAttribute('n') ?? null,
    };
    if (element.getAttribute('ch-intro-bracket') === 'start') {
      openBracket = bracket;
    } else if (openBracket) {
      introBrackets.push({ start: openBracket, end: bracket });
      openBracket = null;
    }
  }
  return introBrackets;
}

ChScore.prototype._getIntroSectionFromBrackets = function (meiParsed, staffNumbers) {
  const introChordPositionRanges = this._getIntroBrackets(meiParsed).map(
    introBracket => [introBracket.start.chordPosition, introBracket.end.chordPosition]);
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
    // How long a run of single-line lyrics has to be to read as a chorus rather than a
    // verse carrying an extra syllable or two. Counted in melody syllables, not chord
    // positions: a position with no lyric on it isn't part of any run.
    const maxLyricGap = 3;
    // A chorus range snaps to the start or end of the song when only notes without
    // lyrics separate it from there — a verse can end in the last measure with a few
    // piano notes after it. Asking whether anything sung lies in between says what a
    // distance in chord positions only approximates, and can never swallow a syllable.
    const hasLyrics = (chordPosition) => String(chordPosition) in lineNumbersByCp;
    const nothingSungBefore = (chordPosition) => {
      for (let cp = 0; cp < chordPosition; cp++) if (hasLyrics(cp)) return false;
      return true;
    };
    const nothingSungAfter = (chordPosition) => {
      for (let cp = chordPosition + 1; cp < this._scoreData.numChordPositions; cp++) {
        if (hasLyrics(cp)) return false;
      }
      return true;
    };
    const lyricGaps = [[]];
    const lineNumbersByCp = {};
    const versesByCp = {};
    const lyrics = meiParsed.querySelectorAll(':is(note[ch-melody], chord:has([ch-melody])) verse:has(syl:not(:empty))');
    for (const lyric of lyrics) {
      const chordPosition = lyric.closest('note, chord').getAttribute('ch-chord-position');
      if (!(chordPosition in lineNumbersByCp)) {
        lineNumbersByCp[chordPosition] = [];
        versesByCp[chordPosition] = [];
      }
      const lineNumber = Number.parseInt(lyric.getAttribute('n'));
      lineNumbersByCp[chordPosition].push(lineNumber);
      versesByCp[chordPosition].push(lyric);
    }
    for (const [chordPosition, lineNumbers] of Object.entries(lineNumbersByCp)) {
      if (lineNumbers.length === 1) {
        lyricGaps.at(-1).push(chordPosition);
      } else {
        lyricGaps.push([]);
      }
    }
    // A capitalized syllable opening a word starts a new phrase, which is a second,
    // weaker signal that a run of single-line lyrics is a chorus rather than a verse
    // carrying an extra syllable or two. It only ever relaxes the gap threshold, so a
    // language that doesn't mark phrases with case is simply left on the threshold.
    const startsNewPhrase = (chordPosition) => {
      const syl = versesByCp[chordPosition]?.[0]?.querySelector('syl');
      if (!syl || ['m', 't'].includes(syl.getAttribute('wordpos'))) return false;
      return /^\p{Lu}/u.test(syl.textContent.trim());
    };

    for (const lyricGap of lyricGaps) {
      const allowedGap = startsNewPhrase(lyricGap[0]) ? maxLyricGap - 1 : maxLyricGap;
      if (lyricGap.length > allowedGap) {
        // Save chorus line numbers
        for (const chordPosition of lyricGap) {
          const lineNumbers = lineNumbersByCp[chordPosition];
          for (const lineNumber of lineNumbers) {
            chorusLineNumbers.add(lineNumber);
          }
        }
        // Handle notes without lyrics at the beginning or end of the song
        if (nothingSungBefore(Number.parseInt(lyricGap[0]))) {
          lyricGap[0] = '0';
        }
        if (nothingSungAfter(Number.parseInt(lyricGap.at(-1)))) {
          lyricGap[lyricGap.length - 1] = String(this._scoreData.numChordPositions - 1);
        }
        // Save chorus chord position ranges
        const start = Number.parseInt(lyricGap[0]);
        const end = Number.parseInt(lyricGap.at(-1)) + 1;
        chorusCpRanges.push(Array.from({length: end - start}, (_, i) => start + i));
      }
    }
  }

  // Get line numbers from secondary lyrics
  const additionalSecondaryLyricLineNumbers = new Set();
  const chorusChordPositions = new Set(chorusCpRanges.flat());
  for (const lyric of meiParsed.querySelectorAll('verse[ch-secondary]')) {
    const lineNumber = Number.parseInt(lyric.getAttribute('n'));
    if (chorusChordPositions.has(Number.parseInt(lyric.closest('note, chord').getAttribute('ch-chord-position')))) {
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
          cpEnd = nextChorusCpRange.at(-1) + 1;
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
    if (hasInitialChorus && verseNumber === verseNumbers.at(-1) && chordPositionRanges.length > 1) {
      chordPositionRanges.push(chordPositionRanges[chordPositionRanges.length - 2]);
    }

    // Get pause after
    let pauseAfter = true;
    const lastChordPositionElement = meiParsed.querySelector(`[ch-chord-position="${this._scoreData.numChordPositions - 1}"]:is(chord, note, rest)`);
    if (
      verseNumber === verseNumbers.at(-1) // Last verse
      || lastChordPositionElement.matches('rest') // Last note is a rest
      || !lastChordPositionElement.querySelector('verse') // Last note doesn't have lyrics
      || Number.parseInt(lastChordPositionElement.getAttribute('dur')) < 4 // Last note is longer than a quarter note
    ) {
      pauseAfter = false;
    }

    for (let cpr = 0; cpr < chordPositionRanges.length; cpr++) {
      const chordPositionRange = chordPositionRanges[cpr];
      if (chorusChordPositions.has(chordPositionRange.start)) {
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

// TODO: Some of the logic in _markSingleLineChordPositions overlaps chorus detection in _generateSectionsFromSimpleScore – maybe they can be unified.
ChScore.prototype._markSingleLineChordPositions = function (lyricChordPositionRanges, maxAllowedGap = 3) {
  const lyricLinesByStaffAndCp = {};
  const lyrics = Array.from(this._scoreData.meiParsed.querySelectorAll(':is(note[ch-melody], chord:has([ch-melody])) verse:has(syl:not(:empty))'));
  for (const lyric of lyrics) {
    const chordPosition = Number.parseInt(lyric.closest('[ch-chord-position]').getAttribute('ch-chord-position'));
    const lyricLineId = lyric.getAttribute('ch-lyric-line-id');
    const [staffNumber, lineNumber] = lyricLineId.split('.').map(i => Number.parseInt(i));
    if (!Object.hasOwn(lyricLinesByStaffAndCp, staffNumber)) lyricLinesByStaffAndCp[staffNumber] = {};
    if (!Object.hasOwn(lyricLinesByStaffAndCp[staffNumber], chordPosition)) lyricLinesByStaffAndCp[staffNumber][chordPosition] = new Set();
    lyricLinesByStaffAndCp[staffNumber][chordPosition].add(lineNumber);
  }

  const ecpToCp = [];
  for (const { chordPosition } of this._walkSungChordPositions(lyricChordPositionRanges)) {
    ecpToCp.push(chordPosition);
  }

  const singleLineCpRangesByStaff = {}
  for (const staffNumber of Object.keys(lyricLinesByStaffAndCp)) {
    let firstLyricEcp;
    const noLyricEcps = [];
    const oneLyricEcpRanges = [];
    const expandedChordPositions = [...ecpToCp.keys()];
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


/********************** Private methods: normalize lyrics **********************/

// Lyric elements sung on the melody, in document order. Restricted to notes and chords on
// purpose: <section> also carries @ch-chord-position — as a space-separated list — so
// matching the attribute alone would sweep in every verse in the section, melody or not.
ChScore.prototype._melodyVerseElements = function () {
  return this._scoreData.meiParsed.querySelectorAll(
    ':is(note[ch-melody], chord:has([ch-melody])) verse');
}

// The same elements grouped by chord position. Takes the flat list when the caller already
// has it, since the selector above is one of the more expensive queries in the file.
ChScore.prototype._getMelodyVerseElementsByChordPosition = function (verses) {
  const versesByChordPosition = new Map();
  for (const verse of verses ?? this._melodyVerseElements()) {
    // The note or chord the verse hangs off; both carry the same chord position
    const chordPosition = Number.parseInt(
      verse.closest('note, chord')?.getAttribute('ch-chord-position'));
    if (Number.isNaN(chordPosition)) continue;
    if (!versesByChordPosition.has(chordPosition)) versesByChordPosition.set(chordPosition, []);
    versesByChordPosition.get(chordPosition).push(verse);
  }
  return versesByChordPosition;
}

// Which verse element engraved at one chord position is sounding on this pass, as an
// index into the list (-1 for none). Score expansion and lyric extraction both need this
// answer, so it lives in one place. Pure over its arguments: expansion calls it over the
// cloned, expanded MEI, where the per-chord-position maps no longer line up.
// isSingleLine is caller-supplied because the two derive it differently.
ChScore.prototype._verseSoundingAt = function (verseElements, passNumber, isSingleLine) {
  const verses = Array.from(verseElements);
  if (verses.length === 0) return -1;

  // A pickup engraved inside a repeat carries only the verses it leads into, each
  // labelled ("2.", "3."), so @n doesn't line up with the pass count — take them in
  // engraved order. One labelled verse counts too, but only when its label names a verse
  // other than its own lyric line. Checked before the single-line rule, which would
  // otherwise always win and return 0.
  const allLabelled = verses.every(ve => ve.querySelector('label'));
  const namesAnotherVerse = () => this._markerNumber(verses[0].querySelector('label')?.textContent)
    !== Number.parseInt(verses[0].getAttribute('n'));
  if (allLabelled && (verses.length > 1 || namesAnotherVerse())) {
    // Out of range on later passes, which is correct: the pickup is sung once per verse
    const index = passNumber - 1;
    return index < verses.length ? index : -1;
  }

  if (isSingleLine) return 0;
  return verses.findIndex(ve => Number.parseInt(ve.getAttribute('n')) === passNumber);
}

// Round markers, by the chord position they're engraved at. The marker is the dir's own
// text; @ch-round-marker only flags which dirs are markers. Reading them by chord
// position is what re-emits each one on every pass through a repeat.
ChScore.prototype._getRoundMarkersByChordPosition = function () {
  const roundMarkersByChordPosition = new Map();
  for (const dir of this._scoreData.meiParsed.querySelectorAll('dir[ch-round-marker]')) {
    const chordPosition = Number.parseInt(dir.getAttribute('ch-chord-position'));
    if (Number.isNaN(chordPosition)) continue;
    if (!roundMarkersByChordPosition.has(chordPosition)) {
      roundMarkersByChordPosition.set(chordPosition, dir.textContent.trim());
    }
  }
  return roundMarkersByChordPosition;
}

// Lyric stanzas as sung, read off the score. Lyrics given to align against decide
// what the stanzas are; without them, the stanzas are read out of the score's own
// syllables.
ChScore.prototype._extractLyricStanzas = function (lyricChordPositionRanges, ecpStart) {
  const syllables = this._gatherSyllables(lyricChordPositionRanges, ecpStart);
  return this._scoreData.lyricsText
    ? this._alignSyllablesToLyrics(this._scoreData.lyricsText, syllables, this._scoreData.staffNumbers)
    : this._getLyricsFromSyllables(syllables);
}

// Walk the chord positions in sung order and pull out the syllable engraved at each,
// as a flat list — one entry per syllable, carrying where it's sung and what line it's on
ChScore.prototype._gatherSyllables = function (lyricChordPositionRanges, ecpStart) {
  let extractedLyricSyllables = [];
  // Seed entry: chord positions sung before the first syllable have nowhere else to go
  extractedLyricSyllables.push({
    label: null,
    text: '',
    suffix: '',
    chordPositions: [],
    chordPositionRuns: [],
    expandedChordPositions: [],
    lyricLineIds: [],
  });
  const melodyVerses = this._melodyVerseElements();
  const melodyVersesByChordPosition = this._getMelodyVerseElementsByChordPosition(melodyVerses);
  const roundMarkersByChordPosition = this._getRoundMarkersByChordPosition();
  let pendingRoundMarker = null;

  // In a 'Two-Part' score each part's verse is sung on its own pass, read by plain @n
  // matching in _verseSoundingAt; the later combined pass just repeats them, so it yields no
  // stanza and a trailing tag falls out as its own section. A labelled pickup into that
  // combined pass ("(3.)" in "A Child’s Prayer", 1989 CSB) would trip _verseSoundingAt's
  // "names another verse" rule and emit a spurious one-word verse, so pickups labelled
  // beyond the part count are dropped — whole words, since tail syllables carry no label of
  // their own and so are tracked per lyric line until the next word starts.
  const excludedVerses = new Set();
  if (this._scoreData.hasTwoPartMelody) {
    const partCount = this._scoreData.melodyPartIds.length;
    const skipStateByLine = {};
    for (const verse of melodyVerses) {
      const lineId = verse.getAttribute('ch-lyric-line-id');
      if (this._startsWord(verse)) {
        const labelNumber = this._verseLabelNumber(verse);
        skipStateByLine[lineId] = labelNumber != null && labelNumber > partCount;
      }
      if (skipStateByLine[lineId]) excludedVerses.add(verse);
    }
  }

  // Single-line when no chord position in the range carries more than one melody verse;
  // computed up front because the walk below is flat.
  for (const range of lyricChordPositionRanges) {
    range.hasSingleLine = true;
    for (let cp = range.start; cp < range.end; cp++) {
      if ((melodyVersesByChordPosition.get(cp) ?? []).length > 1) range.hasSingleLine = false;
    }
  }
  let isFirstSyllableOfSection = false;

  // Test cases:
  // "Gethsemane" (Hymns—For Home and Church), "This Is the Christ" (Hymns—For Home and Church), "Beautiful Savior" (1989 CSB) – complex sections
  // Japanese "When the Savior Comes Again" (Hymns—For Home and Church) – ruby text
  // "Have I Done Any Good?" (1985 Hymns) – simple verses and chorus, but verses have chord positions with only one lyric syllable. When there's only one lyric syllable, it should be extracted only in the correct verse.
  for (const { range, chordPosition: cp, expandedChordPosition: ecpCounter, passNumber }
    of this._walkSungChordPositions(lyricChordPositionRanges, { ecpStart })) {
    if (cp === range.start) isFirstSyllableOfSection = range.startsSection ?? false;
    // _markSingleLineChordPositions' isSingleLine is scoped per staff (built for divisi
    // sharing one staff, e.g. Soprano 1/2), so it reads true at every chord position of a
    // 'Two-Part' score — each part's own verse is alone on its own staff. That signal
    // doesn't apply here; only the melody-verse-count range.hasSingleLine (which does
    // count across staves) should gate the shortcut for a two-part score.
    const chordPositionIsSingleLine = this._scoreData.hasTwoPartMelody
      ? false : this._scoreData.chordPositions[cp].isSingleLine;
    let verseElements = melodyVersesByChordPosition.get(cp) ?? [];
    if (excludedVerses.size > 0) verseElements = verseElements.filter(ve => !excludedVerses.has(ve));
    const verseIndex = this._verseSoundingAt(verseElements, passNumber,
      chordPositionIsSingleLine || range.hasSingleLine);
    const verseElement = verseElements[verseIndex]; // undefined when -1

    // A round marker is engraved where the voice enters, which isn't always the chord
    // position its word starts on — it can land on a held note with no lyric, or on
    // the tail syllable of the word before. It belongs to the next word start.
    if (roundMarkersByChordPosition.has(cp) && !pendingRoundMarker) {
      pendingRoundMarker = roundMarkersByChordPosition.get(cp);
    }

    if (verseElement) {
      const label = verseElement.querySelector('label');
      const sylElements = Array.from(verseElement.querySelectorAll('syl'));
      const text = sylElements.map(syl => (syl.textContent.replace(/[\-\‑\s]+$/, '').trim() + ' ').trim()).join(' ').trim() || null;
      const startsWord = !['m', 't'].includes(sylElements[0]?.getAttribute('wordpos'));
      const roundMarker = startsWord ? pendingRoundMarker : null;
      if (roundMarker) pendingRoundMarker = null;
      extractedLyricSyllables.push({
        label: label ? label.textContent.trim() : null,
        text: text,
        // The syllables as engraved, kept for _getLyricsFromSyllables: joining
        // them back into words needs @wordpos, which the flattened text loses.
        // fontstyle/fontweight (set by _fixLyricStyling for MusicXML input, or
        // native to MEI input) mark words to wrap in <em>/<strong>.
        syls: sylElements.map(syl => ({
          text: syl.textContent.trim(),
          wordpos: syl.getAttribute('wordpos'),
          italic: syl.getAttribute('fontstyle') === 'italic',
          bold: syl.getAttribute('fontweight') === 'bold',
        })),
        verseLabel: verseElement.getAttribute('label'),
        // Kept out of text so _alignSyllablesToLyrics, which matches these against
        // lyrics that already carry their own markers, is unaffected
        roundMarker: roundMarker,
        chordPositions: [cp],
        chordPositionRuns: [[cp, cp + 1]],
        expandedChordPositions: [ecpCounter],
        lyricLineIds: [verseElement.getAttribute('ch-lyric-line-id')],
        startsSection: isFirstSyllableOfSection,
        sectionType: range.sectionType ?? null,
      });
      isFirstSyllableOfSection = false;
    } else {
      const currentSyllable = extractedLyricSyllables.at(-1);
      currentSyllable.chordPositions.push(cp);
      currentSyllable.expandedChordPositions.push(ecpCounter);
      // The walk already knows whether this position continues the run or starts a
      // new one — record that now rather than re-deriving it later by rescanning
      // chordPositions for gaps (see _getLyricsFromSyllables' use of this).
      const lastRun = currentSyllable.chordPositionRuns.at(-1);
      if (lastRun && cp === lastRun[1]) lastRun[1] = cp + 1;
      else currentSyllable.chordPositionRuns.push([cp, cp + 1]);
    }
  }

  if (this._scoreData.hasTwoPartMelody) {
    // A part's tail word engraved in a shared repeat ending is walked before that part
    // resumes its own verse body, so it lands ahead of the run it belongs with
    // ("here." in "Love Is Spoken Here", 1989 CSB). Spotted as two adjacent same-line
    // syllables running backwards, and moved to the end of the run it precedes.
    for (let i = 1; i < extractedLyricSyllables.length; i++) {
      const prev = extractedLyricSyllables[i - 1];
      const cur = extractedLyricSyllables[i];
      const lineId = prev.lyricLineIds[0];
      if (!lineId || lineId !== cur.lyricLineIds[0]) continue;
      if (cur.chordPositions[0] >= prev.chordPositions.at(-1)) continue;
      let runEnd = i;
      while (runEnd < extractedLyricSyllables.length && extractedLyricSyllables[runEnd].lyricLineIds[0] === lineId) runEnd++;
      const [moved] = extractedLyricSyllables.splice(i - 1, 1);
      extractedLyricSyllables.splice(runEnd - 1, 0, moved);
    }

    // That tail word can also be engraved again before a repeat-back or a tag with nothing
    // new to say ("thee."/"heav'n." in "A Child’s Prayer"). Compared against the last word on
    // the same lyric line rather than the immediately preceding one, since the other part's
    // whole verse can sit between the two in this flat, interleaved list.
    const lastTextByLineId = {};
    extractedLyricSyllables = extractedLyricSyllables.filter(entry => {
      const lineId = entry.lyricLineIds[0];
      if (!lineId || !entry.text) return true;
      const foldedText = entry.text.toLowerCase();
      if (lastTextByLineId[lineId] === foldedText) return false;
      lastTextByLineId[lineId] = foldedText;
      return true;
    });
  }

  return extractedLyricSyllables;
}

// Match the syllables sung in the score against lyrics given to align them to, and
// return those lyrics as stanzas, each syllable marked with where it's sung. Takes
// everything it needs as arguments, so it can be exercised without a loaded score.
ChScore.prototype._alignSyllablesToLyrics = function (expandedLyrics, syllables, staffNumbers) {
  if (!expandedLyrics) return [];
  if (!syllables || syllables.length === 0) return [];

  const stanzas = [];

  // Extract stanza headers
  expandedLyrics = expandedLyrics.replace(/\[([^\]]*)\]\n/g, (_, name) => {
    const parts = name.split(' ');
    stanzas.push({
      name,
      type: parts[0].toLowerCase(),
      marker: parts[1] ?? null,
      annotatedLyrics: '',
      chordPositionRanges: [],
      expandedChordPositions: [],
    });
    return '';
  });

  const { normText, posMap } = this._normalizeLyricsForMatching(expandedLyrics);
  let pos = 0;
  const insertions = [];
  let currentStanzaIndex = 0;

  // Match each syllable
  for (const syllable of syllables) {
    const normSylText = syllable.text?.normalize('NFD').replace(/[\u0300-\u036f\p{P}\p{N}]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
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
        const score = this._lyricSimilarity(normSylText, normText.substring(i, i + normSylText.length));
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
        for (const [start, end] of syllable.chordPositionRuns) {
          stanzas[currentStanzaIndex].chordPositionRanges.push({
            start: start,
            end: end,
            lyricLineIds: syllable.lyricLineIds,
            staffNumbers: staffNumbers,
          });
        }
        stanzas[currentStanzaIndex].expandedChordPositions.push(...syllable.expandedChordPositions);
      }

      pos = matchPos + normSylText.length;
    }
  }

  for (const stanza of stanzas) {
    stanza.chordPositionRanges = this._consolidateChordPositionRanges(stanza.chordPositionRanges);
    stanza.expandedChordPositions = [stanza.expandedChordPositions[0], stanza.expandedChordPositions.at(-1) + 1];
  }

  // Insert markers in reverse order
  for (let i = insertions.length - 1; i >= 0; i--) {
    const [idx, marker] = insertions[i];
    expandedLyrics = expandedLyrics.substring(0, idx) + marker + expandedLyrics.substring(idx);
  }

  const stanzasText = expandedLyrics.split('\n\n');
  for (let sz = 0; sz < stanzas.length; sz++) {
    stanzas[sz].annotatedLyrics = this._applyFindReplace(stanzasText[sz].trim());
  }

  return stanzas;
}

// Build a match-friendly version of the lyrics, with a map back to where each
// normalized character came from in the original text (HTML-aware).
// For <ruby> blocks, use the <rt> reading text for matching and map to the <ruby> tag position.
// For other HTML tags (<em>, <strong>, etc.), skip them entirely.
// For plain text, apply the existing normalization (strip accents, punctuation, digits; collapse whitespace).
ChScore.prototype._normalizeLyricsForMatching = function (expandedLyrics) {
  const normChars = [];
  const posMap = [];
  const rubyRegex = /<ruby[^>]*>[\s\S]*?<\/ruby>/gi;
  const stripRe = /[\u0300-\u036f\p{P}\p{N}]/u;
  let lastPlainIndex = 0;
  let rubyMatch;

  // Normalize a single character into normChars/posMap.
  // When collapseWhitespace is true, runs of whitespace become a single space.
  function addNormChar(char, position, collapseWhitespace) {
    const norm = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (norm && !/\s/.test(norm)) {
      for (const ch of norm) {
        normChars.push(ch);
        posMap.push(position);
      }
    } else if (collapseWhitespace && /\s/.test(norm) && normChars.at(-1) !== ' ') {
      normChars.push(' ');
      posMap.push(position);
    }
  }

  function addPlainText(text, startOriginalIndex) {
    for (let j = 0; j < text.length; j++) {
      const char = text[j];
      // Skip HTML tags (e.g. <em>, </strong>, <span class="...">)
      if (char === '<') {
        const closeIdx = text.indexOf('>', j);
        if (closeIdx !== -1) { j = closeIdx; continue; }
      }
      // Skip punctuation, digits, and combining marks
      if (stripRe.test(char)) continue;
      addNormChar(char, startOriginalIndex + j, true);
    }
  }

  while ((rubyMatch = rubyRegex.exec(expandedLyrics)) !== null) {
    if (rubyMatch.index > lastPlainIndex) {
      addPlainText(expandedLyrics.substring(lastPlainIndex, rubyMatch.index), lastPlainIndex);
    }
    const rtMatch = rubyMatch[0].match(/<rt>(.*?)<\/rt>/i);
    const reading = rtMatch ? rtMatch[1] : '';
    for (const char of reading) addNormChar(char, rubyMatch.index, false);
    lastPlainIndex = rubyRegex.lastIndex;
  }
  if (lastPlainIndex < expandedLyrics.length) {
    addPlainText(expandedLyrics.substring(lastPlainIndex), lastPlainIndex);
  }

  return { normText: normChars.join(''), posMap: posMap };
}

// Longest common substring similarity (like Python's SequenceMatcher)
ChScore.prototype._lyricSimilarity = function (str1, str2) {
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
  return str1.length + str2.length > 0 ? (maxLen * 2) / (str1.length + str2.length) : 0;
}

// Join chord position ranges that continue one another on the same staves and lyric line
ChScore.prototype._consolidateChordPositionRanges = function (ranges) {
  const result = [];
  for (const range of ranges) {
    const last = result.at(-1);
    if (last
        && last.end === range.start
        && last.staffNumbers.toString() === range.staffNumbers.toString()
        && last.lyricLineIds.toString() === range.lyricLineIds.toString()) {
      last.end = range.end;
      for (const id of range.lyricLineIds) {
        if (!last.lyricLineIds.includes(id)) last.lyricLineIds.push(id);
      }
    } else {
      result.push(range);
    }
  }
  return result;
}

// Build lyric stanzas from the syllables engraved in the score, when no lyrics were
// given to align against. A stanza is a run of syllables sharing one lyric line, in
// sung order, then any line playback never reached — and syllables aren't lines.
ChScore.prototype._getLyricsFromSyllables = function (syllables) {
  // Walk the syllables in the order they're sung
  const built = [];
  let current = null;
  let builder = null;
  for (const syllable of syllables) {
    const lyricLineId = syllable.lyricLineIds?.[0] ?? null;
    if (!lyricLineId || !syllable.text) continue;

    const chordPosition = syllable.chordPositions[0];
    // A section says what it is; fall back to the verse element's own label for
    // scores walked without sections to align to
    const type = syllable.sectionType ?? syllable.verseLabel ?? null;
    const label = syllable.label ?? null;

    // A stanza ends where its section does, when the lyric line changes, when the
    // verse type changes, when a verse label is reached, or when playback jumps
    // back into a repeat
    const startsNewStanza = !current
      || syllable.startsSection
      || current.lyricLineIds[0] !== lyricLineId
      || current.type !== type
      || Boolean(label)
      || chordPosition < current.chordPositionRanges.at(-1).end - 1;

    if (startsNewStanza) {
      current = this._newLyricStanza(lyricLineId, type, label, chordPosition, syllable.expandedChordPositions[0]);
      builder = this._wordBuilder();
      built.push({ stanza: current, builder: builder });
    }

    if (syllable.roundMarker) builder.addRoundMarker(syllable.roundMarker);

    // The syllables as engraved, carried over from _extractLyricStanzas, which
    // read them off the verse element: @wordpos is what joins them into words
    const syls = syllable.syls ?? [];
    if (syls.length > 0) {
      for (const syl of syls) builder.add(syl.text, syl.wordpos, syl.italic, syl.bold);
    } else {
      builder.add(syllable.text, null, false, false);
    }

    // A label reached mid-stanza names the stanza; it doesn't start a new one
    if (label && !current.marker) current.marker = label;

    // Record where the stanza is actually sung. chordPositionRuns already has a jump
    // (e.g. over a repeat's other ending) split out; a run starting past the current
    // range opens a new one. Only forward gaps split; backward jumps keep the old
    // behaviour, since some scores rely on the degenerate (start === end) ranges.
    for (const [runStart, runEnd] of syllable.chordPositionRuns) {
      const lastRange = current.chordPositionRanges.at(-1);
      if (runStart > lastRange.end) {
        current.chordPositionRanges.push({
          start: runStart,
          end: runEnd,
          staffNumbers: lastRange.staffNumbers,
          // Copied, not shared: _consolidateChordPositionRanges pushes into this
          lyricLineIds: [...lastRange.lyricLineIds],
        });
      } else {
        lastRange.end = runEnd;
      }
    }
    current.expandedChordPositions[1] = syllable.expandedChordPositions.at(-1) + 1;
  }

  // Join each stanza's words once it's complete, rather than on every syllable
  for (const { stanza, builder: words } of built) {
    stanza.annotatedLyrics = this._applyFindReplace(words.text());
  }

  const stanzas = this._mergePickupStanzas(built.map(entry => entry.stanza));
  for (const stanza of stanzas) stanza.name = this._stanzaName(stanza);
  return stanzas;
}

// Walk the song in sung order — through repeats, endings and jumps — yielding one entry
// per chord position visited, so the numbering is defined once. It's load-bearing:
// `ch-expanded-chord-position` indexes into `_scoreData.expandedChordPositions`.
//
// Ranges are passed in rather than read from `_scoreData.sections`, because extraction
// runs before those sections exist — the stanzas it produces are what create them. Each
// `{ start, end, ... }` range is handed back on every entry, so callers can carry their
// own payload. `countPass: false` numbers a range without advancing `passNumber`: an
// intro repeats the song's opening positions, and counting it would shift the verse that
// reuses them.
ChScore.prototype._walkSungChordPositions = function* (ranges, { ecpStart = 0 } = {}) {
  let expandedChordPosition = ecpStart;
  const passCounts = {};
  for (const range of ranges) {
    for (let chordPosition = range.start; chordPosition < range.end; chordPosition++) {
      let passNumber = passCounts[chordPosition] ?? 0;
      if (range.countPass !== false) {
        passNumber += 1;
        passCounts[chordPosition] = passNumber;
      }
      yield { range, chordPosition, expandedChordPosition, passNumber };
      expandedChordPosition += 1;
    }
  }
}

// Make every xml:id in a cloned subtree unique by appending a suffix, repointing the
// @startid/@endid/@plist references that follow it. References are indexed once up
// front: querying per ID instead costs a full subtree scan each time, which is
// quadratic. @plist (arpeg, beamSpan, etc.) holds a space-separated list rather than a
// single id, so references are tracked per token rather than per whole attribute value —
// @startid/@endid are just the one-token case of the same shape.
ChScore.prototype._suffixIds = function (element, suffix) {
  const referencesByTargetId = new Map();
  for (const attribute of ['startid', 'endid', 'plist']) {
    for (const referencingEl of element.querySelectorAll(`[${attribute}]`)) {
      const tokens = referencingEl.getAttribute(attribute).split(/\s+/);
      tokens.forEach((token, tokenIndex) => {
        if (!token.startsWith('#')) return;
        const targetId = token.substring(1);
        if (!referencesByTargetId.has(targetId)) referencesByTargetId.set(targetId, []);
        referencesByTargetId.get(targetId).push([referencingEl, attribute, tokens, tokenIndex]);
      });
    }
  }
  element.setAttribute('xml:id', element.getAttribute('xml:id') + suffix);
  for (const el of element.querySelectorAll('[*|id]')) {
    const previousId = el.getAttribute('xml:id');
    const newId = previousId + suffix;
    el.setAttribute('xml:id', newId);
    for (const [referencingEl, attribute, tokens, tokenIndex] of referencesByTargetId.get(previousId) ?? []) {
      tokens[tokenIndex] = `#${newId}`;
      referencingEl.setAttribute(attribute, tokens.join(' '));
    }
  }
}

// The sung sequence as the finished sections describe it, ready for
// _walkSungChordPositions. Each range carries the section it came from. An introduction
// doesn't advance the pass counter — it repeats the song's own opening positions.
ChScore.prototype._sectionChordPositionRanges = function () {
  const ranges = [];
  for (const sectionInfo of this._scoreData.sections) {
    // Below-sections (verses printed under the music, or a lyric line playback never
    // reached) aren't sung from the staff, even when they carry real chord-position
    // ranges — including them here fed phantom entries into the sung-order walk and
    // ran the full-score expansion replay off the end of its section list.
    if (sectionInfo.placement === 'below') continue;
    for (const chordPositionRange of sectionInfo.chordPositionRanges) {
      ranges.push({ ...chordPositionRange, sectionInfo, countPass: sectionInfo.type !== 'introduction' });
    }
  }
  return ranges;
}

// Chord position ranges carry the lyric line and staves they belong to, the same
// shape _extractLyricStanzas and generateDefaultSection produce — _expandSections
// reads both to link sections to their verse elements.
ChScore.prototype._newLyricStanza = function (lyricLineId, type, marker, chordPosition, expandedChordPosition) {
  const staffNumber = Number.parseInt(lyricLineId?.split('.')[0]);
  return {
    type: type,
    name: null, // set by _stanzaName once the stanza is complete
    marker: marker,
    annotatedLyrics: '',
    chordPositionRanges: [{
      start: chordPosition,
      end: chordPosition + 1,
      staffNumbers: Number.isNaN(staffNumber) ? this._scoreData.staffNumbers : [staffNumber],
      lyricLineIds: lyricLineId ? [lyricLineId] : [],
    }],
    expandedChordPositions: expandedChordPosition == null ? [] : [expandedChordPosition, expandedChordPosition + 1],
    lyricLineIds: lyricLineId ? [lyricLineId] : [],
  };
}

// Characters swapped out of derived lyrics once a stanza is assembled, so what a score
// engraves in a display font comes out as its canonical equivalent. Dingbat circled
// digits are how round markers are engraved; circled digits are what lyrics carry.
ChScore.prototype._findReplace = {
  '➀': '①', '➁': '②', '➂': '③', '➃': '④', '➄': '⑤',
  '➅': '⑥', '➆': '⑦', '➇': '⑧', '➈': '⑨',
};

ChScore.prototype._applyFindReplace = function (text) {
  let result = text;
  for (const [find, replace] of Object.entries(this._findReplace)) {
    result = result.replaceAll(find, replace);
  }
  return result;
}

// Dictionary of known words with hyphens for lookup when extracting lyrics  ("latter-day"), by language
ChScore.prototype._hyphenatedWords = {
  en: [
    'adam-ondi-ahman', 'all-gracious', 'all-pervading', 'birthday-time',
    'day-dawn', 'death-beds', 'earth-stains', 'easter-time', 'ever-circling',
    'ever-joyful', 'ever-living', 'ever-present', 'ever-sure', 'ever-tender',
    'far-called', 'far-flung', 'firm-rooted', 'get-the-work-done', 'habit-free',
    'heaven-born', 'heav’n-born', 'heav’n-rescued', 'heigh-dee-ho', 'latter-day',
    'life-giving', 'light-mindedness', 'long-awaited', 'long-expected',
    'love-light', 'nail-prints', 'never-fading', 'one-tenth', 'prayer-time',
    'purple-headed', 're-echoes', 'safe-folded', 'self-control', 'soul-cheering',
    'star-spangled', 'stepping-stones', 'storm-tossed', 'tempest-tossed',
    'thank-off’rings', 'under-shepherds', 'valley-o', 'war-cry', 'well-fought',
    'where-e’er', 'white-robed', 'zip-a-dee-ay',
  ],
};

// Each language's dictionary, indexed by the word with its hyphens removed, to the
// character positions (into that stripped word) a hyphen goes back at. Built once
// per language and cached, since _wordBuilder consults it once per syllable.
ChScore.prototype._hyphenPositionsByLanguage = {};

ChScore.prototype._hyphenPositions = function (language) {
  if (!this._hyphenPositionsByLanguage[language]) {
    const positions = {};
    for (const word of this._hyphenatedWords[language] ?? []) {
      const hyphenPositions = [];
      let position = 0;
      for (const part of word.split('-').slice(0, -1)) {
        position += part.length;
        hyphenPositions.push(position);
      }
      positions[word.replace(/-/g, '')] = hyphenPositions;
    }
    this._hyphenPositionsByLanguage[language] = positions;
  }
  return this._hyphenPositionsByLanguage[language];
}

// Restore a known compound word's hyphen(s) once its syllables are rejoined, so
// "latterday" becomes "latter-day" again. Case is left as the syllables spelled
// it; only where the hyphens go is looked up.
ChScore.prototype._insertKnownHyphens = function (word, language = 'en') {
  const hyphenPositions = this._hyphenPositions(language)[word.toLowerCase()];
  if (!hyphenPositions) return word;

  let result = word;
  for (const position of hyphenPositions.slice().reverse()) {
    result = `${result.slice(0, position)}-${result.slice(position)}`;
  }
  return result;
}

// Joins syllables into words. MEI marks each syllable's position within its
// word with @wordpos: i(nitial), m(edial), t(erminal), s(ingle).
ChScore.prototype._wordBuilder = function () {
  const self = this;
  const trailingHyphen = /[-‑\s]+$/;
  const words = []; // { text, italic, bold }, styling merged into <em>/<strong> spans in text()
  let partial = '';
  let partialItalic = false;
  let partialBold = false;

  return {
    add(text, wordpos, italic, bold) {
      const syllable = text.replace(trailingHyphen, '');
      if (!syllable) return;
      if (wordpos === 'i' || wordpos === 'm') {
        partial += syllable;
        partialItalic = partialItalic || italic;
        partialBold = partialBold || bold;
      } else if (partial) {
        // A hyphen means the word continues, even where a score marks the
        // continuing syllable inconsistently — @wordpos="s" in a second ending
        // where the first ending marks the same syllable "t".
        words.push({
          text: self._insertKnownHyphens(partial + syllable),
          italic: partialItalic || italic,
          bold: partialBold || bold,
        });
        partial = '';
        partialItalic = false;
        partialBold = false;
      } else {
        words.push({ text: self._insertKnownHyphens(syllable), italic, bold });
      }
    },
    // A round marker stands on its own before the word it marks, and is never styled
    // with it
    addRoundMarker(text) {
      if (!text) return;
      if (partial) partial = `${text} ${partial}`;
      else words.push({ text: text, italic: false, bold: false });
    },
    text() {
      const all = partial
        ? words.concat({ text: self._insertKnownHyphens(partial), italic: partialItalic, bold: partialBold })
        : words;

      // A styling change doesn't happen mid-word, so consecutive words with the
      // same styling are one <em>/<strong> span — "one, two, three." stays a
      // single run instead of three, matching how it's engraved.
      const runs = [];
      for (const word of all) {
        const current = runs.at(-1);
        if (current && current.italic === word.italic && current.bold === word.bold) {
          current.text += ` ${word.text}`;
        } else {
          runs.push({ text: word.text, italic: word.italic, bold: word.bold });
        }
      }

      return runs.map(({ text, italic, bold }) => {
        if (bold) text = `<strong>${text}</strong>`;
        if (italic) text = `<em>${text}</em>`;
        return text;
      }).join(' ').trim();
    },
  };
}

// Merge pickup fragments into the verse they belong to. A hymn often engraves the
// next verse's first syllables on a pickup before a repeat, so they arrive as a short
// stanza labelled "2." while sitting on lyric line 1 — sung before the verse it names.
ChScore.prototype._mergePickupStanzas = function (stanzas) {
  const merged = [];

  for (let s = 0; s < stanzas.length; s++) {
    const stanza = stanzas[s];
    const next = stanzas[s + 1];
    const number = this._markerNumber(stanza.marker);
    const lineNumber = Number.parseInt(stanza.lyricLineIds[0]?.split('.')[1]);
    const nextLineNumber = Number.parseInt(next?.lyricLineIds[0]?.split('.')[1]);

    const isPickup = number !== null
      && number !== lineNumber
      && next
      && next.type === stanza.type
      && this._markerNumber(next.marker) === null
      && nextLineNumber === number;

    if (isPickup) {
      next.marker = stanza.marker;
      next.annotatedLyrics = `${stanza.annotatedLyrics} ${next.annotatedLyrics}`.trim();
      next.chordPositionRanges = stanza.chordPositionRanges.concat(next.chordPositionRanges);
      if (stanza.expandedChordPositions.length) next.expandedChordPositions[0] = stanza.expandedChordPositions[0];
      continue;
    }
    merged.push(stanza);
  }

  return merged;
}

ChScore.prototype._markerNumber = function (marker) {
  const match = /(\d+)/.exec(marker ?? '');
  return match ? Number.parseInt(match[1]) : null;
}

// Whether a verse (or syllable) opens a word rather than continuing one. Continuations
// carry no label of their own, so callers tracking a word-level mark reset on a word start.
ChScore.prototype._startsWord = function (verseOrSyl) {
  const syl = verseOrSyl.matches('syl') ? verseOrSyl : verseOrSyl.querySelector('syl');
  return !['m', 't'].includes(syl?.getAttribute('wordpos'));
}

// The number a verse's own label carries ("2." → 2), or null where it has none
ChScore.prototype._verseLabelNumber = function (verse) {
  return this._markerNumber(verse.querySelector('label')?.textContent);
}

// The verse a labelled pickup leads into, or null when the verse carries no numbered label
// or its label just names the lyric line it already sits on ("1." opening verse 1). "(3.)"
// printed on verse 1's line is the pickup case.
ChScore.prototype._pickupVerseNumber = function (verse) {
  const labelNumber = this._verseLabelNumber(verse);
  return labelNumber === Number.parseInt(verse.getAttribute('n')) ? null : labelNumber;
}

// What a stanza is called: "Verse 2", "Chorus", or "Unknown" where the score says
// nothing. Settles what the name is read from as it goes — a numbered lyric line is a
// verse even with no verse@label, and a marker keeps only its digits. Stanza or section.
ChScore.prototype._stanzaName = function (stanza) {
  if (!stanza.type && stanza.marker) stanza.type = 'verse';
  if (stanza.marker) stanza.marker = this._cleanMarker(stanza.marker);

  if (stanza.type === 'verse') {
    // The lyric line stands in for display only. Leaving @marker alone keeps it
    // honest: a repeated passage that prints one lyric line is verse 1's words
    // sung again, not evidence of which verse is meant.
    const lineNumber = stanza.lyricLineIds?.[0]?.split('.')[1];
    return `Verse ${stanza.marker || lineNumber || ''}`.trim();
  }
  // Types are stored lowercase ("chorus", "bridge") and displayed capitalized
  return stanza.type ? stanza.type.charAt(0).toUpperCase() + stanza.type.slice(1) : 'Unknown';
}

// A verse number as engraved carries the punctuation that goes with it: "2.", "(3."
ChScore.prototype._cleanMarker = function (marker) {
  return String(marker ?? '').replace(/[().]/g, '').trim();
}


/********************** Private methods: utilities **********************/

// Semitones above C for each pitch name, and what each accidental adds to it
ChScore.prototype._pitchClasses = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
ChScore.prototype._accidOffsets = {
  n: 0, s: 1, f: -1, ss: 2, x: 2, ff: -2, sx: 3, xs: 3, ts: 3, tf: -3, ns: 1, nf: -1,
};

// Get MIDI pitch from note element attributes (Verovio provides this in getMIDIValuesForElement(), but calculating it here is more performant than many repeated requests across the WASM-boundary)
ChScore.prototype._getMeiPitch = function (meiElement) {
  const pname = meiElement.getAttribute('pname');
  if (!pname) return undefined;
  const pitchClass = this._pitchClasses[pname.toLowerCase()];
  if (pitchClass === undefined) return undefined;
  const octave = Number.parseInt(meiElement.getAttribute('oct.ges') ?? meiElement.getAttribute('oct'));
  if (Number.isNaN(octave)) return undefined;
  // The accidental can be written on the note or on a child <accid> element
  const accidElement = meiElement.querySelector('accid');
  const accid = meiElement.getAttribute('accid.ges')
    ?? accidElement?.getAttribute('accid.ges')
    ?? meiElement.getAttribute('accid')
    ?? accidElement?.getAttribute('accid');
  return 12 * (octave + 1) + pitchClass + (accid ? (this._accidOffsets[accid] ?? 0) : 0);
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
      arr.sort((a, b) => a - b);
    } else {
      arr.sort((a, b) => a[key] - b[key]);
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
  return tempo?.qpm ?? Number.parseInt(this._scoreData.meiParsed.querySelector('tempo').getAttribute('midi.bpm'));
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
ChScore.prototype._addStylesheet = function (stylesheetKey) {
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
  if (!this._stylesheets) return;
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
  try { // Avoid an error if the window loses focus
    elements = document.elementsFromPoint(x, y) ?? [];
  } finally {}
  for (const element of elements) {
    if (element === this._container) break;

    if (element.dataset.chChordPosition) {
      pointData.chordPosition = Number.parseInt(element.dataset.chChordPosition);
    }
    if (element.dataset.chExpandedChordPosition) {
      pointData.expandedChordPositions = element.dataset.chExpandedChordPosition.split(' ').map(ecp => Number.parseInt(ecp));
    }
    if (element.dataset.chSectionId) {
      pointData.sectionIds = element.dataset.chSectionId.split(' ');
    }
    if (element.dataset.chLyricLineId) {
      pointData.lyricLineId = element.dataset.chLyricLineId;
    }
    if (element.dataset.chStaffNumber) {
      pointData.staffNumber = Number.parseInt(element.dataset.chStaffNumber);
    }
    if (element.dataset.related || element.parentElement?.dataset?.related) {
      for (const relatedElementId of (element.dataset.related || element.parentElement.dataset.related).split(' ')) {
        const relatedElement = document.getElementById(relatedElementId);
        if (relatedElement.classList.contains('system')) {
          pointData.systemId = relatedElementId;
        } else if (relatedElement.classList.contains('measure')) {
          pointData.measureId = relatedElementId;
        } else if (relatedElement.classList.contains('staff')) {
          pointData.staffNumber = Number.parseInt(relatedElement.dataset.n);
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


/********************** Other **********************/

// Make Chorister.js available to JavaScript module (chorister.mjs)
globalThis.ChScore = ChScore;
