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
      column-gap: 0.8em;
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

ChScore.prototype.load = async function (format, { scoreId = null, scoreUrl = null, midiUrl = null, lyricsUrl = null, scoreContent = null, midiNoteSequence = null, lyricsText = null, parts = null, partsTemplate = null, sections = null, chordSets = null, fermatas = null, lang = 'en' }, options = this._defaultOptions) {
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

  // Instantiate Verovio toolkit (releasing the previous instance if needed)
  this._container.dataset.chStatus = 'processing';
  this._releaseVrvToolkit();
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
      scoreContent = this._optimizeMusicXml(scoreContent);
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
    scoreMetadata: {},
    features: {
      hasLyrics: false, hasPartInfo: false, hasMelodyInfo: false, hasChordSets: false,
      hasExpansion: false, hasRepeatOrJump: false, hasIntroBrackets: false,
      hasFingeringMarks: false, hasLyricSectionIds: false, hasTwoPartMelody: false,
      hasRound: false, hasOstinato: false, hasDescant: false, hasObbligato: false,
      hasPickupMeasure: false, hasInlineVerseNumbers: false,
    },
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
    harmStaffNumber: '1',
    trebleClefStaffNumbersSelector: '',
    fermatas: fermatas ?? [],
  };

  // Process MEI, draw SVG, and load MIDI
  this._parseAndAnnotateMei(scoreId, lang);
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

// Free the Verovio toolkit's WASM-side object. It is an Emscripten object the module holds
// until destroyed, so without this, loading score after score into one page leaves every
// previous toolkit behind and each load gets slower. Safe to call when there is none.
ChScore.prototype._releaseVrvToolkit = function () {
  try { this._vrvToolkit?.destroy(); } catch (error) { /* already gone */ }
  this._vrvToolkit = null;
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
  this._releaseVrvToolkit();
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

// Extract font styles from font names
ChScore.prototype._normalizeFontStyling = function (element) {
  const fontFamily = (element.getAttribute('font-family') || '').toLowerCase();
  const currentStyle = element.getAttribute('font-style');
  const currentWeight = element.getAttribute('font-weight');
  let changed = false;
  if ((!currentStyle || currentStyle === 'normal') && fontFamily.includes('italic')) {
    element.setAttribute('font-style', 'italic');
    changed = true;
  }
  if ((!currentWeight || currentWeight === 'normal') && fontFamily.includes('bold')) {
    element.setAttribute('font-weight', 'bold');
    changed = true;
  }
  return changed;
}

// The font name with the styling words taken back out, once they are carried by
// font-style/font-weight: "McKay Neue ldsLat Italic, text" names the same family as
// "McKay Neue ldsLat, text" and shouldn't sort as a family of its own.
ChScore.prototype._fontFamilyWithoutStyling = function (fontFamily) {
  if (!fontFamily) return null;
  return fontFamily
    .split(',')
    .map(name => name.replace(/\s*\b(italic|bold)\b/gi, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ') || null;
}

// Collapse each line's runs of whitespace and trim it, then drop leading and trailing
// blank lines. Printed text blocks are wrapped for the page, not for a reader.
ChScore.prototype._cleanBlockWhitespace = function (text) {
  return text
    .split('\n').map(line => line.replace(/[^\S\n]+/g, ' ').trim()).join('\n')
    .replace(/^\n+|\n+$/g, '');
}

// Keep styling whitespace outside its markup, so a run's tags sit against the words
// they style: "<em>Words: </em>Anon." reads as "<em>Words:</em> Anon.". Scores put the
// separating space inside the styled run as often as not, and where the tags fall
// shouldn't depend on that. Newlines count too: a run ending its own text with a blank
// line would otherwise close its tag *after* that line, putting the blank-line boundary
// _getScoreMetadata splits text blocks on inside the markup and orphaning the tag onto
// the next block.
ChScore.prototype._normalizeMarkupWhitespace = function (text) {
  return text
    .replace(/<(em|strong)>(\s+)/g, '$2<$1>')
    .replace(/(\s+)<\/(em|strong)>/g, '</$2>$1');
}

// The verses printed on the page rather than sung from the staff, as text blocks.
// The one place `type === 'stanza'` is spelled, for the several readers that want them.
ChScore.prototype._stanzaTextBlocks = function () {
  return (this._scoreData.scoreMetadata?.textBlocks ?? []).filter(block => block.type === 'stanza');
}

// Items bucketed by a key, in first-seen order.
ChScore.prototype._groupBy = function (items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return groups;
}

// Clean up MusicXML so it can be cleanly converted to MEI
ChScore.prototype._optimizeMusicXml = function (musicXml) {
  const hasIntroBrackets = musicXml.includes('⌜') || musicXml.includes('⌝');
  const hasLyrics = musicXml.includes('<lyric');
  const hasTextBlocks = musicXml.includes('<credit');
  const hasEndings = musicXml.includes('<ending');
  const hasTimeOnly = musicXml.includes('time-only');
  const hasStems = musicXml.includes('<stem>');
  const hasJumps = musicXml.includes('dalsegno=') || musicXml.includes('tocoda=');
  this._textBlockStyles = new Map();
  if (!hasIntroBrackets && !hasLyrics && !hasTextBlocks && !hasEndings && !hasTimeOnly && !hasStems
    && !hasJumps) return musicXml;

  const parsed = (new DOMParser()).parseFromString(musicXml, 'text/xml');
  if (parsed.querySelector('parsererror')) return musicXml;

  let changed = false;

  // Move intro brackets (⌜ ⌝) to the correct document order (based on x-position)
  // relative to surrounding notes. When converting MusicXML to MEI, Verovio uses
  // document order to determine element position.
  if (hasIntroBrackets) {
    const adjacentNote = (element, direction) => {
      let sibling = element[direction];
      while (sibling && sibling.nodeName !== 'note') sibling = sibling[direction];
      return sibling;
    }
    const previousNote = (element) => adjacentNote(element, 'previousElementSibling');
    const nextNote = (element) => adjacentNote(element, 'nextElementSibling');

    for (const direction of parsed.querySelectorAll('direction')) {
      if (!['⌜', '⌝'].includes(direction.textContent.trim())) continue;
      const positioned = direction.querySelector('[default-x]');
      const bracketX = positioned ? Number.parseFloat(positioned.getAttribute('default-x')) : null;
      if (bracketX === null || Number.isNaN(bracketX)) continue;

      for (let note = previousNote(direction); note && Number.parseFloat(note.getAttribute('default-x')) > bracketX; note = previousNote(direction)) {
        note.parentNode.insertBefore(direction, note);
        changed = true;
      }
      for (let note = nextNote(direction); note && Number.parseFloat(note.getAttribute('default-x')) < bracketX; note = nextNote(direction)) {
        note.parentNode.insertBefore(direction, note.nextSibling);
        changed = true;
      }
    }
  }

  // Verovio builds the expansion from an ending's @number and drops any ending it can't
  // read, so that ending's music is never played. Some engravings leave the attribute empty
  // or wrong while printing the real label as element text ("1. 2.").
  if (hasEndings) {
    // The stop carries no text of its own, and the numbers being repaired are exactly the
    // ones that can't be trusted to pair start with stop, so pairing is by document order.
    let correction = null;
    for (const ending of parsed.querySelectorAll('ending')) {
      const number = ending.getAttribute('number');
      if (number === null) continue;
      const isStart = ending.getAttribute('type') === 'start';
      if (isStart) {
        const printed = (ending.textContent.match(/\d+/g) ?? []).join(',');
        correction = printed && printed !== number.replace(/\s/g, '') ? printed : null;
      }
      if (!correction) continue;
      ending.setAttribute('number', correction);
      changed = true;
      if (!isStart) correction = null;
    }
  }

  // Verovio reads @time-only in preference to the jump beside it, so a "to Coda" marked
  // for one playthrough is left out of the expansion entirely. Dropping it takes the jump
  // on the last playthrough, which is what it meant. Example: Close as a Quiet Prayer (HHC)
  if (hasTimeOnly) {
    for (const sound of parsed.querySelectorAll('sound[tocoda][time-only]')) {
      sound.removeAttribute('time-only');
      changed = true;
    }
  }

  // A jump names its marker by id, and Verovio can't resolve one pointing at an id the file
  // no longer holds (German "Gethsemane", HHC, marks the segno at 17 and jumps to 11).
  // Repointed only where exactly one marker of that kind exists, so there is no question
  // which was meant; with none at all there is nothing to repoint.
  if (hasJumps) {
    for (const [jump, marker] of [['dalsegno', 'segno'], ['tocoda', 'coda']]) {
      const ids = new Set([...parsed.querySelectorAll(`sound[${marker}]`)]
        .map(sound => sound.getAttribute(marker)));
      if (ids.size !== 1) continue;
      const [only] = ids;
      for (const sound of parsed.querySelectorAll(`sound[${jump}]`)) {
        if (ids.has(sound.getAttribute(jump))) continue;
        sound.setAttribute(jump, only);
        changed = true;
      }
    }
  }

  // Two voices sharing a staff are numbered top down, and _annotateFromTimemap reads a note's
  // part from that. A measure engraved the other way round -- voice 1 stems down beneath
  // voice 2 stems up -- makes it call the lower voice the melody and read its words. Swapped
  // back where one measure disagrees with those around it (Guide Us, O Thou Great Jehovah).
  if (hasStems) changed = this._renumberFlippedVoices(parsed) || changed;

  // With the numbering right, the words a held melody leaves to the voice below it can be
  // read off that voice and put where they are sung. Example: Come unto Jesus (Hymns #117).
  if (hasLyrics) changed = this._moveHeldMelodyLyrics(parsed) || changed;

  // Convert bold and italic font names like "McKay Neue ldsLat Italic" to font style and weight attributes
  if (hasLyrics) {
    for (const text of parsed.querySelectorAll('lyric > text')) {
      changed = this._normalizeFontStyling(text) || changed;
    }
  }

  // Clean up text blocks
  if (hasTextBlocks) {
    const markUpRun = (run) => {
      let text = run.textContent;
      if (run.getAttribute('font-weight') === 'bold') text = `<strong>${text}</strong>`;
      if (run.getAttribute('font-style') === 'italic') text = `<em>${text}</em>`;
      return text;
    };
    const numericAttribute = (element, name) => {
      const value = Number.parseFloat(element.getAttribute(name));
      return Number.isNaN(value) ? null : value;
    };
    // What a credit says about itself that the conversion to MEI would otherwise lose:
    // Verovio doesn't consistently carry font information across; `halign` is a literal
    // MusicXML attribute some engravers (Finale) set to override Verovio's own
    // derivation from `justify`; and printed position survives nowhere in the MEI, but
    // is what _getScoreMetadata puts the blocks back in reading order by. Keyed by the
    // text the block will be read from, since that's all the two sides share.
    const setStyle = (run, position) => {
      this._textBlockStyles.set(this._cleanBlockWhitespace(run.textContent), {
        fontFamily: this._fontFamilyWithoutStyling(run.getAttribute('font-family')),
        fontSize: run.getAttribute('font-size') || null,
        halign: run.getAttribute('halign') ?? run.getAttribute('justify'),
        ...position,
      });
    };

    // Merge runs *within* each credit into one, marking up mixed styling as literal
    // <em>/<strong> text (stripped back out downstream by `_patterns.stylingMarkup`).
    for (const textBlock of parsed.querySelectorAll('credit')) {
      const originalPage = textBlock.getAttribute('page');
      if (originalPage !== '1') {
        textBlock.setAttribute('page', '1');
        changed = true;
      }

      const runs = [...textBlock.querySelectorAll('credit-words')];
      if (!runs.length) continue;
      for (const run of runs) changed = this._normalizeFontStyling(run) || changed;

      // A text block of one run needs no markup: its styling stays on the element, and
      // Verovio carries it to the <rend> the block is read from.
      if (runs.length > 1) {
        runs[0].textContent = this._normalizeMarkupWhitespace(runs.map(markUpRun).join(''));
        // The merged element now spans runs of mixed styling, so its own attributes can
        // no longer describe them.
        runs[0].setAttribute('font-style', 'normal');
        runs[0].setAttribute('font-weight', 'normal');
        for (const run of runs.slice(1)) run.remove();
        changed = true;
      }

      // The *original* page, before it was forced onto page 1 above. Which MEI
      // container Verovio then buckets the credit into is deliberately not relied on --
      // it splits them by y-position, so two lines of one printed block can land in
      // different containers; _getScoreMetadata reads header and footer together and
      // re-sorts by this position, which makes the split irrelevant.
      setStyle(runs[0], {
        page: Number.parseInt(originalPage) || 1,
        x: numericAttribute(runs[0], 'default-x'),
        y: numericAttribute(runs[0], 'default-y'),
      });
    }
  }

  return changed ? (new XMLSerializer()).serializeToString(parsed) : musicXml;
}

// A MusicXML element's own children of one name -- <lyric> holds a <text>, and <note> a
// <duration>, so a descendant search would read a note's lyric text as the note's own.
// The first such child, where only one is wanted -- no array built for the lookup.
function chChild(element, name) {
  for (const child of element.children) if (child.localName === name) return child;
  return null;
}
function chChildren(element, name) {
  return [...element.children].filter(child => child.localName === name);
}
const CH_VOICE_OF = (note) => chChild(note, 'voice')?.textContent.trim() ?? '1';

// Restore the top-down numbering of two voices sharing a staff, where one measure is written
// the other way round from the measures around it (see _optimizeMusicXml).
ChScore.prototype._renumberFlippedVoices = function (parsed) {
  // Which way round a measure's first two voices are written, as far as its stems say
  const voiceOrder = (measure) => {
    const stems = { 1: new Set(), 2: new Set() };
    for (const note of measure.querySelectorAll('note')) {
      const stem = chChild(note, 'stem')?.textContent.trim();
      if (stem) stems[CH_VOICE_OF(note)]?.add(stem);
    }
    const written = (voice, direction) => stems[voice].size === 1 && stems[voice].has(direction);
    if (written(1, 'up') && written(2, 'down')) return 'normal';
    if (written(1, 'down') && written(2, 'up')) return 'inverted';
    return null;
  };

  let changed = false;
  for (const part of parsed.querySelectorAll('part')) {
    const measures = [...part.querySelectorAll('measure')];
    const orders = measures.map(voiceOrder);
    // The nearest measure either side that says anything at all about its ordering
    const neighbor = (index, step) => {
      for (let i = index + step; i >= 0 && i < orders.length; i += step) if (orders[i]) return orders[i];
      return null;
    };

    for (const [index, order] of orders.entries()) {
      if (order !== 'inverted' || neighbor(index, -1) !== 'normal' || neighbor(index, 1) !== 'normal') continue;
      const notes = [...measures[index].querySelectorAll('note')]
        .filter(note => ['1', '2'].includes(CH_VOICE_OF(note)));
      // A chorded voice carries two parts rather than one line, so it is not half of a
      // swapped pair: a stem-down chord beneath a stem-up descant is written that way.
      if (notes.some(note => chChild(note, 'chord'))) continue;
      for (const note of notes) {
        const voice = chChild(note, 'voice');
        voice.textContent = voice.textContent.trim() === '1' ? '2' : '1';
      }
      changed = true;
    }
  }
  return changed;
}

// Where the melody holds a note with no words of its own and the voice below it moves, that
// voice is singing the melody's words ("may rest, may rest" in "Come unto Jesus"). Put them
// on the melody's own note, so everything downstream reads the melody and finds them there.
// Each guard below names the score that needs it.
ChScore.prototype._moveHeldMelodyLyrics = function (parsed) {
  const sungText = (lyric) => chChildren(lyric, 'text').map(text => text.textContent).join('').trim();
  const numberOf = (lyric) => lyric.getAttribute('number');
  const staffOf = (note) => chChild(note, 'staff')?.textContent.trim() ?? '1';
  let changed = false;

  // Only the parts where a voice below the first sings -- 14 scores in 1,378 have one at all,
  // and this is what keeps the timeline below off every other score
  const partsWithLowerVoiceLyrics = new Set([...parsed.querySelectorAll('note > lyric')]
    .map(lyric => lyric.parentElement)
    .filter(note => CH_VOICE_OF(note) !== '1')
    .map(note => note.closest('part')));

  for (const part of partsWithLowerVoiceLyrics) {
    // Every note on one timeline per staff, in divisions, so a run can cross a barline.
    // <backup>/<forward> move the cursor; a chord's notes share the onset that opened it.
    const byStaff = new Map();
    let measureStart = 0;
    for (const measure of part.querySelectorAll('measure')) {
      let cursor = 0, onset = 0, length = 0;
      for (const child of measure.children) {
        const duration = Number.parseInt(chChild(child, 'duration')?.textContent) || 0;
        if (child.localName === 'backup') cursor -= duration;
        else if (child.localName === 'forward') cursor += duration;
        else if (child.localName === 'note') {
          if (!chChild(child, 'chord')) { onset = cursor; cursor += duration; }
          const staff = staffOf(child);
          if (!byStaff.has(staff)) byStaff.set(staff, []);
          byStaff.get(staff).push({ note: child, onset: measureStart + onset });
        }
        length = Math.max(length, cursor);
      }
      measureStart += length;
    }

    for (const entries of byStaff.values()) {
      entries.sort((a, b) => a.onset - b.onset);
      const melodyNotes = new Map();
      for (const { note, onset } of entries) {
        if (CH_VOICE_OF(note) !== '1' || chChild(note, 'rest')) continue;
        if (chChildren(note, 'tie').some(tie => tie.getAttribute('type') === 'stop')) continue;
        if (!melodyNotes.has(onset)) melodyNotes.set(onset, note);
      }

      // Per lyric line: the last word it carried, and whether its run below the melody is
      // being taken
      const previous = new Map();
      const runs = new Map();
      let melodyLines = new Set();

      for (const { note, onset } of entries) {
        const lyrics = chChildren(note, 'lyric').filter(sungText);
        const isMelody = CH_VOICE_OF(note) === '1';
        if (isMelody && lyrics.length) melodyLines = new Set(lyrics.map(numberOf));

        for (const lyric of lyrics) {
          const number = numberOf(lyric);
          if (isMelody) {
            previous.set(number, lyric);
            runs.delete(number);
            continue;
          }
          // A word printed in parentheses is an aside the engraving has already marked as
          // another voice's ("(I'm gonna live)", "(Were you there?)"), whatever it lines up
          // with. Either bracket marks the word: they open and close on different syllables,
          // and a closing one can carry punctuation after it ("an y where).").
          const text = sungText(lyric);
          if (text.includes('(') || text.includes(')')) continue;
          const target = melodyNotes.get(onset);
          const held = Boolean(target)
            && !chChildren(target, 'lyric').some(other => numberOf(other) === number);
          // Answered on the run's first word, and only for a line the melody is mid-way
          // through: a run opening where the melody is mid-word is that voice singing its own
          // line ("(Were you there?)"), and a line the melody is not singing is that voice's
          // own ("Come home!", engraved as line 2 against a chorus the melody sings on line 1)
          if (!runs.has(number)) runs.set(number, held && melodyLines.has(number));
          if (!runs.get(number) || !held) continue;

          // The voice sings the word again as it finishes, and it is sung once -- the
          // repeat stays where it is engraved, on the voice that sings it
          const last = previous.get(number);
          if (last && this._foldWord(sungText(last)) === this._foldWord(sungText(lyric))) continue;
          const below = chChildren(target, 'lyric')
            .find(other => Number.parseInt(numberOf(other)) > Number.parseInt(number));
          target.insertBefore(lyric, below ?? null);
          previous.set(number, lyric);
          changed = true;
        }
      }
    }
  }
  return changed;
}

// Get metadata from the MEI fileDesc, pgHead, and pgFoot elements
ChScore.prototype._getScoreMetadata = function (meiParsed, scoreId, lang) {

  // Styling that stayed on the element rather than being marked up before conversion
  // (see _optimizeMusicXml): a text block styled as a whole, or a nested <rend> of
  // MEI-native input.
  const styleText = (text, rend) => {
    if (!text) return text;
    if (rend.getAttribute('fontweight') === 'bold') text = `<strong>${text}</strong>`;
    if (rend.getAttribute('fontstyle') === 'italic') text = `<em>${text}</em>`;
    return text;
  }

  // <lb> is a line break; other elements (<rend>, <ref>, ...) only wrap text
  const getText = (element) => {
    if (!element) return '';
    let text = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
      else if (node.nodeName === 'lb') text += '\n';
      else if (node.nodeName === 'rend') text += styleText(getText(node), node);
      else text += getText(node);
    }
    return this._cleanBlockWhitespace(text);
  }

  // A text block is where a blank line marks a real break within one credit's printed
  // text; a single '\n' is just another line of the same block.
  const textBlockPieces = text => text.split(/\n\s*\n/);

  // Pieces split from the same <rend> (the same original credit) share a group, so a
  // stanza-classified piece can pull its siblings along later (see groupsWithVerseMarker).
  let groupCounter = 0;
  const getTextBlocks = (containerName) => {
    const blocks = [];
    for (const container of meiParsed.querySelectorAll(containerName)) {
      for (const rend of container.querySelectorAll(':scope > rend')) {
        const text = getText(rend);
        if (!text) continue;
        const html = text.split('\n').map(line => styleText(line, rend)).join('\n');
        const textPieces = textBlockPieces(text);
        const htmlPieces = textBlockPieces(html);
        const group = groupCounter++;
        textPieces.forEach((textPiece, i) => {
          const htmlPiece = htmlPieces[i] ?? textPiece;
          const textBlockStyle = this._textBlockStyles?.get(htmlPiece);
          blocks.push({
            html: htmlPiece,
            text: textPiece.replace(this._patterns.stylingMarkup, ''),
            halign: textBlockStyle?.halign ?? rend.getAttribute('halign'),
            valign: rend.getAttribute('valign'),
            fontFamily: textBlockStyle?.fontFamily ?? rend.getAttribute('fontfam') ?? null,
            fontSize: textBlockStyle?.fontSize ?? rend.getAttribute('fontsize') ?? null,
            y: textBlockStyle?.y ?? null,
            page: textBlockStyle?.page ?? 1,
            x: textBlockStyle?.x ?? null,
            elementId: rend.getAttribute('xml:id'),
            group: group,
            type: null,
          });
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
  // pgHead/pgFoot concatenation is container order, not reading order, so sort by true
  // page/row/column position instead. Two blocks printed side by side rarely land at
  // *exactly* the same y, so treat anything within `_sameRowTolerance` as one row and
  // break the tie by x (left to right); beyond that, y wins outright.
  const textBlocks = getTextBlocks('pgHead').concat(getTextBlocks('pgFoot'))
    .sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      if (Math.abs(a.y - b.y) <= this._sameRowTolerance) return a.x - b.x;
      return b.y - a.y;
    });

  const isCapoBlock = block => this._patterns.capoMark.test(block.text.trim());
  const isNumberBlock = block => this._patterns.standaloneNumber.test(block.text.trim()) && Number.parseInt(block.text) > 0;
  const isFootnoteBlock = block => block.text.trimStart().startsWith('*');
  const attributionWords = [...this._attributionWords._any, ...(this._attributionWords[lang] ?? [])];
  const looksLikeAttributions = block => {
    if (contributors.some(({ name }) => name && block.text.includes(name))) return true;
    // French and Spanish typography puts a space before a colon ("Paroles : ..."), so
    // it comes off here rather than being listed as a second spelling of every phrase.
    const lowerText = block.text.toLowerCase().replace(/\s+:/g, ':');
    return attributionWords.some(phrase => lowerText.includes(phrase));
  };

  // A block naming a marker anywhere counts as a stanza in full, not just the piece the
  // marker itself sits in (see groupsWithVerseMarker), and a repeated line marks a
  // stanza even with no other signal. Both need the whole pool seen first, so this runs
  // as its own pass before classification.
  const looksLikeVerseMarker = block => this._patterns.verseMarker.test(block.text);
  const lineCounts = new Map();
  const groupsWithVerseMarker = new Set();
  for (const block of textBlocks) {
    for (const line of block.text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) lineCounts.set(trimmed, (lineCounts.get(trimmed) ?? 0) + 1);
    }
    if (looksLikeVerseMarker(block)) groupsWithVerseMarker.add(block.group);
  }
  const looksLikeStanza = block => {
    const lines = block.text.split('\n');
    if (lines.some(line => line.length > this._longLineThreshold)) return false;
    if (looksLikeVerseMarker(block)) return true;
    if (groupsWithVerseMarker.has(block.group)) return true;
    if (lines.length < 2) return false;
    return lines.some(line => lineCounts.get(line.trim()) > 1);
  };

  // Classify every text block, most literal/narrow match first: capo and number
  // markings, then footnotes, then attributions, then stanzas. Nothing left
  // unmatched stays `null` (ambiguous) rather than guessing.
  for (const block of textBlocks) {
    if (isCapoBlock(block)) block.type = 'capo';
    else if (isNumberBlock(block)) block.type = 'number';
    else if (isFootnoteBlock(block)) block.type = 'footnote';
    else if (looksLikeAttributions(block)) block.type = 'attribution';
    else if (looksLikeStanza(block)) block.type = 'stanza';
  }

  // Title is the largest centered heading among what's left unclassified (metadata
  // title fields are sometimes empty or outdated); centered blocks above/below it are
  // a supertitle/subtitle. Restricted to the title's own page, or a centered aside
  // printed at the top of a later page (e.g. "Optional verses for ...:") reads as a
  // subtitle candidate too.
  const titlePage = Math.min(...textBlocks.map(block => block.page));
  const headings = textBlocks.filter(block => block.type === null && block.halign === 'center' && block.page === titlePage);
  const sizes = headings.map(block => Number.parseFloat(block.fontSize));
  const largest = Math.max(...sizes.filter(size => !Number.isNaN(size)));
  const titleIndex = sizes.some(size => !Number.isNaN(size))
    ? sizes.indexOf(largest)
    : headings.findIndex(block => !block.html.includes('\n'));
  const printedTitle = headings[titleIndex];
  if (printedTitle) {
    printedTitle.type = 'title';
    // Multi-line stays `null` rather than 'supertitle'/'subtitle' -- reads like a
    // lyrics/credits block, not a subheading.
    for (const block of headings.slice(0, titleIndex)) {
      if (!block.html.includes('\n')) block.type = 'supertitle';
    }
    for (const block of headings.slice(titleIndex + 1)) {
      if (!block.html.includes('\n')) block.type = 'subtitle';
    }
  }

  // Anything still unclaimed (a scripture reference, a performance note, an
  // unrecognized aside) becomes a footnote rather than staying ambiguous.
  for (const block of textBlocks) {
    if (block.type === null) block.type = 'footnote';
  }

  // Column reading order (finish one column top to bottom before starting the next),
  // for a group whose blocks are otherwise in row order. A short column beside a taller
  // one interleaves under row order: in do-as-im-doing.mxl a two-block left column sits
  // beside a single-block right one, so by row the right block lands *between* the left
  // column's two, instead of after them.
  const columnOrder = blocks => {
    const ordered = [];
    const byPage = this._groupBy(blocks, block => block.page);
    for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
      const columns = [];
      for (const block of byPage.get(page).sort((a, b) => a.x - b.x)) {
        const column = columns.find(col => Math.abs(col[0].x - block.x) <= this._sameColumnTolerance);
        if (column) column.push(block); else columns.push([block]);
      }
      for (const column of columns) column.sort((a, b) => b.y - a.y);
      ordered.push(...columns.flat());
    }
    return ordered;
  };

  // Footnotes and attributions sort to the end (footnotes first) regardless of where
  // they printed -- both read like an aside wherever they sit. Everything else keeps
  // the reading order established above.
  const orderedTextBlocks = [
    ...textBlocks.filter(block => block.type !== 'footnote' && block.type !== 'attribution'),
    ...columnOrder(textBlocks.filter(block => block.type === 'footnote')),
    ...columnOrder(textBlocks.filter(block => block.type === 'attribution')),
  ];

  return {
    scoreId: scoreId,
    lang: lang,
    title: printedTitle?.html ?? (getText(meiParsed.querySelector('fileDesc titleStmt title')) || null),
    contributors: contributors,
    date: date ? (date.getAttribute('isodate') ?? getText(date)) : null,
    distributor: getText(meiParsed.querySelector('fileDesc pubStmt distributor')) || null,
    availability: getText(meiParsed.querySelector('fileDesc pubStmt availability')) || null,
    textBlocks: orderedTextBlocks,
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

ChScore.prototype._parseAndAnnotateMei = function (scoreId, lang) {
  this._scoreData.meiParsed = (new DOMParser()).parseFromString(this._scoreData.meiStringOriginal, 'text/xml');
  this._scoreData.scoreMetadata = this._getScoreMetadata(this._scoreData.meiParsed, scoreId, lang);

  /********** Clean up the MEI document **********/

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
    // One walk over the layers, bucketed by the staff holding them, rather than a
    // document query per staff
    const layersByStaffAndNumber = new Map();
    for (const layer of this._scoreData.meiParsed.querySelectorAll('staff layer')) {
      const staffNumber = Number.parseInt(layer.closest('staff').getAttribute('n'));
      if (!layersByStaffAndNumber.has(staffNumber)) layersByStaffAndNumber.set(staffNumber, {});
      const layersByNumber = layersByStaffAndNumber.get(staffNumber);
      const layerNumber = Number.parseInt(layer.getAttribute('n'));
      if (!Object.hasOwn(layersByNumber, layerNumber)) layersByNumber[layerNumber] = [];
      layersByNumber[layerNumber].push(layer);
    }
    for (const staff of this._scoreData.meiParsed.querySelectorAll('staffDef')) {
      const staffNumber = Number.parseInt(staff.getAttribute('n'));
      const layersByNumber = layersByStaffAndNumber.get(staffNumber) ?? {};
      const staffLayerNumbers = Object.keys(layersByNumber).map(Number).sort((a, b) => a - b);
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
  this._scoreData.tempos = this._normalizeTempos(tempoElements);

  // Correct syllables that carry a verse number before anything reads them, starting
  // with the syllable text gathered below. Help text is marked first, so a lyric line
  // that isn't sung doesn't count as one when the numbers are read.
  this._normalizeLyricElements(this._scoreData.meiParsed);

  // After _normalizeLyricElements: a stub copies its line's @label, which that pass creates
  // for a verse number engraved into the first syllable
  this._fixUnterminatedMelismas();

  /********** Read notes, rests and measures **********/

  // Gather information about each note and rest
  this._scoreData.notesAndRestsById = {}
  const tiedNoteEndIds = new Set(Object.values(tiedNotes));
  // [*|id] is a superset of note/rest, so the same walk builds the id index used later
  const elementsById = new Map();
  for (const meiElement of this._scoreData.meiParsed.querySelectorAll('[*|id]')) {
    const elementId = meiElement.getAttribute('xml:id');
    elementsById.set(elementId, meiElement);
    if (!meiElement.matches('note, rest')) continue;
    // Single traversal of the note's ancestors instead of separate closest() calls, for efficiency
    let meiChordElement = null;
    let meiLayerElement = null;
    let meiStaffElement = null;
    for (let ancestor = meiElement.parentElement; ancestor; ancestor = ancestor.parentElement) {
      switch (ancestor.tagName) {
        case 'chord': meiChordElement ??= ancestor; break;
        case 'layer': meiLayerElement = ancestor; break;
        case 'staff': meiStaffElement = ancestor; break;
      }
      if (meiLayerElement && meiStaffElement) break;
    }
    const isTiedNote = tiedNoteEndIds.has(elementId);
    const isRest = meiElement.matches('rest');
    const isCue = meiElement.getAttribute('cue') === 'true';

    // Anything kept here outlives this function, so it holds data or ids. meiElement and
    // meiChordElement are the exception: they are handles into meiParsedComplete, not the
    // live meiParsed, which _updateMei replaces with a clone. Resolve against meiParsed by
    // elementId if you need the drawn node.
    this._scoreData.notesAndRestsById[elementId] = {
      elementId: elementId,
      meiElement: meiElement,
      meiChordElement: meiChordElement,
      pitch: isRest ? undefined : this._getMeiPitch(meiElement), // _getMeiPitch is undefined for a rest anyway
      staffNumber: Number.parseInt(meiStaffElement.getAttribute('n')),
      layerNumber: Number.parseInt(meiLayerElement.getAttribute('n')),
      tiedNoteId: tiedNotes[elementId] ?? null,
      isTiedNote: isTiedNote,
      isRest: isRest,
      isCue: isCue,
      // Cue notes deliberately still count as audible: Verovio renders them into its MIDI,
      // and _loadMidi aligns by matching audible chord positions against MIDI note starts.
      // Excluding them breaks that match ("What God Calls Us To", "Close as a Quiet Prayer").
      isAudible: !(isRest || isTiedNote),
      partIds: [], // Added later
      expandedChordPositions: [], // Added later
      isMelody: null, // Added later
      startQ: null, // Added later. Q = time in quarter notes.
      endQ: null, // Added later
      durationQ: null, // Added later
      chordPosition: null, // Added later
    }
  }

  // Change cue notes to regular notes so they appear at regular size. Runs after the note
  // records above, which read @cue while it is still there to set isCue.
  for (const meiElement of this._scoreData.meiParsed.querySelectorAll('[cue="true"]')) meiElement.removeAttribute('cue');

  // Get measure info
  this._scoreData.measures = []
  this._scoreData.measuresById = {}
  // This walk visits every scoreDef and staffDef in document order, so it also enables
  // collapsing empty staves ("True to the Faith", 1985 Hymns) and collects the staff numbers
  const staffNumbers = [];
  let timeSignature = [0, 0];
  for (const element of this._scoreData.meiParsed.querySelectorAll('scoreDef, staffDef, meterSig, measure')) {
    if (element.matches('scoreDef')) element.setAttribute('optimize', 'true');
    else if (element.matches('staffDef')) staffNumbers.push(Number.parseInt(element.getAttribute('n')));
    if (element.matches('measure')) {
      const measure = element;
      const measureId = measure.getAttribute('xml:id');
      this._scoreData.measuresById[measureId] = {
        measureId: measureId,
        measureType: null, // Added later (after durationQ is known)
        timeSignature: [...timeSignature],
        isFirstMeasure: (this._scoreData.measures.length === 0),
        isLastMeasure: false, // Settled after the walk, on the measure that turns out to be last
        rightBarLine: measure.getAttribute('right') ?? 'single',
        startQ: null, // Added later
        endQ: null, // Added later
        durationQ: null, // Added later
        firstChordPosition: null, // Added later
      }
      this._scoreData.measures.push(this._scoreData.measuresById[measureId]);
    } else {
      // Time signature change
      timeSignature[0] = Number.parseInt(element.getAttribute('count') ?? element.getAttribute('meter.count') ?? timeSignature[0]);
      timeSignature[1] = Number.parseInt(element.getAttribute('unit') ?? element.getAttribute('meter.unit') ?? timeSignature[1]);
    }
  }
  if (this._scoreData.measures.length > 0) this._scoreData.measures.at(-1).isLastMeasure = true;
  this._scoreData.staffNumbers = staffNumbers;

  const vrvTimemap = this._vrvToolkit.renderToTimemap({ includeRests: true, includeMeasures: true, });
  if (!vrvTimemap || vrvTimemap.length === 0) {
    console.error('Error: Verovio returned an empty or invalid timemap. The score data may be malformed.');
    return;
  }
  this._scoreData.trebleClefStaffNumbersSelector = Array.from(this._scoreData.meiParsed.querySelectorAll('clef[shape="G"]'))
    .map(cf => `[n="${Number.parseInt(cf.closest('staffDef, staff').getAttribute('n'))}"]`).join(',');
  this._scoreData.features.hasLyrics = this._scoreData.meiParsed.querySelector('verse') !== null;
  // Whether the score numbers its own verses. Settled here, before _updateMei can hand back a
  // pruned document, so the answer does not depend on which sections are being shown.
  this._scoreData.features.hasInlineVerseNumbers = this._scoreData.meiParsed.querySelector('verse label') !== null;
  const chordPositionIndex = this._indexChordPositions(vrvTimemap);
  this._scoreData.numChordPositions = chordPositionIndex.qstamps.length - 1;
  this._normalizeParts(chordPositionIndex);

  // Normalize slurs by attaching them to chords when possible
  // This allows slurs to remain visible if notes are removed from the chord (such as when showing/hiding parts). This also makes the start and end points more precise (for example, in "The Morning Breaks" (1985 Hymns), without this change, the slur above "shadows" starts at the top of the note stem instead of close to the notehead).
  for (const slur of this._scoreData.meiParsed.querySelectorAll('slur')) {
    const measure = slur.parentElement;
    // A slur can be missing an end — one starting on a rest, for example — and a
    // slur attached by timestamp has neither
    const startId = slur.getAttribute('startid')?.substring(1);
    const endId = slur.getAttribute('endid')?.substring(1);
    // Resolved document-wide: a slur is a child of its start measure, so a slur spanning
    // measures has its endid in the next one. Example: "Amazing Grace" (Hymns for Home and
    // Church) ends two slurs on a chorded note in the following measure.
    const startElement = startId && elementsById.get(startId);
    const endElement = endId && elementsById.get(endId);
    if (startElement && startElement.parentElement.matches('chord')) {
      slur.setAttribute('startid', '#' + startElement.parentElement.getAttribute('xml:id'));
    }
    if (endElement && endElement.parentElement.matches('chord')) {
      slur.setAttribute('endid', '#' + endElement.parentElement.getAttribute('xml:id'));
    }
  }

  const chordPositionCounter = this._annotateFromTimemap(vrvTimemap, elementsById);

  /********** Annotate lyrics **********/

  // Add attributes to lyric elements: @ch-lyric-line-id, @ch-secondary
  // The same walk indexes the named elements by chord position and lyric line, so expansion
  // can look them up instead of running a document-wide selector for every chord position.
  // documentOrder is kept because a range naming several lyric lines wants them interleaved
  // as engraved, which is what one selector over both ids used to give.
  const lyricElementIndex = new Map();
  const documentOrder = new Map();
  for (const lyricElement of this._scoreData.meiParsed.querySelectorAll('verse')) {
    if (lyricElement.textContent.trim() === '') {
      // Keep empty syllables used to mark the end of a melisma underscore
      if (!lyricElement.querySelector('[ch-end-underscore]')) lyricElement.remove();
      continue;
    }
    const staffNumber = lyricElement.closest('staff').getAttribute('n');
    // A lyric line is named by the verse it is, not the row it's engraved on, so a
    // pronunciation guide between two verses doesn't shift the line below it. Help text
    // is left unnamed: it's never sung, so nothing looks it up by line.
    const parentNoteOrChord = lyricElement.closest('[ch-chord-position]');
    if (!lyricElement.hasAttribute('ch-help-text')) {
      const lyricLineId = `${staffNumber}.${this._verseLineNumber(lyricElement)}`;
      lyricElement.setAttribute('ch-lyric-line-id', lyricLineId);
      const chordPosition = Number.parseInt(parentNoteOrChord.getAttribute('ch-chord-position'));
      if (!Number.isNaN(chordPosition)) {
        if (!lyricElementIndex.has(chordPosition)) lyricElementIndex.set(chordPosition, new Map());
        const byLine = lyricElementIndex.get(chordPosition);
        if (!byLine.has(lyricLineId)) byLine.set(lyricLineId, []);
        byLine.get(lyricLineId).push(lyricElement);
        documentOrder.set(lyricElement, documentOrder.size);
      }
    }
    // Mark secondary lyrics (examples: "It Is Well with My Soul"; "Were You There?")
    if (!parentNoteOrChord.hasAttribute('ch-melody') && !parentNoteOrChord.querySelector('[ch-melody]')) {
      lyricElement.setAttribute('ch-secondary', '');
    }
  }
  const lyricElementsAt = (chordPosition, lyricLineIds) => {
    const byLine = lyricElementIndex.get(chordPosition);
    if (!byLine) return [];
    const found = [];
    for (const lyricLineId of lyricLineIds) found.push(...(byLine.get(lyricLineId) ?? []));
    return found.length > 1 ? found.sort((a, b) => documentOrder.get(a) - documentOrder.get(b)) : found;
  };

  /********** Annotate directions and key **********/

  this._annotateDirections(elementsById, chordPositionIndex.qstamps);
  this._markInstructedLyricLines();

  this._scoreData.features.hasExpansion = this._scoreData.meiParsed.querySelector('expansion[plist]') != null;
  this._scoreData.features.hasPickupMeasure = this._scoreData.measures[0]?.measureType === 'partial-pickup';
  // A part is named for the voice it carries, with a number when a voice is split ("alto-2")
  const partNames = this._scoreData.parts.map(part => part.partId.split('-')[0]);
  this._scoreData.features.hasDescant = partNames.includes('descant');
  this._scoreData.features.hasObbligato = partNames.includes('obbligato');
  // The melody as MIDI pitches, in the order it's printed
  this._scoreData.melodyPitches = this._scoreData.chordPositions
    .map(chordPositionInfo => chordPositionInfo.melodyNote?.pitch)
    .filter(pitch => Number.isInteger(pitch));
  this._normalizeSections(); // After parts and intro brackets are available
  this._normalizeChordSets(); // After <harm> elements have chord positions
  this._scoreData.harmStaffNumber = this._scoreData.meiParsed.querySelector('[ch-melody]')?.closest('staff')?.getAttribute('n') ?? '1';

  this._resolveKeySignatures();

  /********** Expand and finalize **********/

  this._buildExpandedChordPositions(chordPositionCounter, lyricElementsAt);

  // Improve appearance of secondary chorus lines (shift to line 2)
  // Example: "It Is Well with My Soul"
  // One walk over the chorus lines, bucketed by staff, rather than two document queries per staff
  const chorusByStaffNumber = new Map();
  for (const element of this._scoreData.meiParsed.querySelectorAll('staff [ch-chorus]')) {
    const staffNumber = element.closest('staff').getAttribute('n');
    if (!chorusByStaffNumber.has(staffNumber)) chorusByStaffNumber.set(staffNumber, []);
    chorusByStaffNumber.get(staffNumber).push(element);
  }
  for (const elements of chorusByStaffNumber.values()) {
    if (elements.some(element => element.getAttribute('n') === '2')) continue;
    // One row per distinct engraved line, keeping their order: a staff carrying two
    // secondary lines (tenor and bass in "Far, Far Away on Judea's Plains") needs two rows,
    // and collapsing both onto line 2 draws them on top of each other. The rows are settled
    // before any are written, so the reassignment doesn't read its own output.
    const secondary = elements.filter(element => element.hasAttribute('ch-secondary'));
    const engravedRows = [...new Set(secondary.map(element => Number.parseInt(element.getAttribute('n'))))]
      .sort((a, b) => a - b);
    const rowFor = new Map(engravedRows.map((engravedRow, index) => [engravedRow, 2 + index]));
    for (const element of secondary) {
      element.setAttribute('n', rowFor.get(Number.parseInt(element.getAttribute('n'))));
    }
  }

  // Check for various features
  this._scoreData.features.hasIntroBrackets = this._scoreData.meiParsed.querySelector('[ch-intro-bracket]') !== null;
  this._scoreData.features.hasChordSets = this._scoreData.chordSets.length > 0;
  this._scoreData.features.hasFingeringMarks = this._scoreData.meiParsed.querySelector('fing') !== null;
  this._scoreData.features.hasLyricSectionIds = this._scoreData.meiParsed.querySelector(':is(label, verse)[ch-section-id]') !== null;

  // Remove unneeded elements and attributes
  // Kept separate from the cleanup at the top of this function: these elements are read by
  // the passes above, so they can only go once everything has been annotated.
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

  // Only read by the expansion pass above, and it holds a lyric element per named stanza,
  // which would otherwise be pinned for the life of the score
  this._scoreData.stanzaNamedLyricElements = null;

  // Save the complete MEI string
  this._scoreData.meiStringComplete = (new XMLSerializer()).serializeToString(this._scoreData.meiParsed);
  this._scoreData.meiParsedComplete = this._scoreData.meiParsed;
  this._updateMei();
}

// Fix unterminated melisma underscores, by appending a stub <verse> holding an empty
// syllable to the event where the underscore should stop.
ChScore.prototype._fixUnterminatedMelismas = function () {
  // One walk over the events, bucketed by the staff number holding them, rather than a
  // document query per staff. A staff number spans every measure, so it is the bucket key
  // rather than the <staff> element.
  const eventsByStaffNumber = new Map();
  for (const element of this._scoreData.meiParsed.querySelectorAll('staff note, staff chord')) {
    if (element.parentElement.closest('chord')) continue;
    const staffNumber = element.closest('staff').getAttribute('n');
    if (!eventsByStaffNumber.has(staffNumber)) eventsByStaffNumber.set(staffNumber, []);
    eventsByStaffNumber.get(staffNumber).push(element);
  }
  for (const events of eventsByStaffNumber.values()) {
    const activeLineNumbers = new Set();
    for (const event of events) {
      const lyricElementsByLine = new Map([...event.children]
        .filter(child => child.matches('verse'))
        .map(lyricElement => [lyricElement.getAttribute('n'), lyricElement]));
      const realLyricElements = [...lyricElementsByLine.values()].filter(lyricElement => lyricElement.matches('verse:has(syl:not(:empty))'));

      if (realLyricElements.length > 0) {
        for (const lineNumber of activeLineNumbers) {
          if (lyricElementsByLine.has(lineNumber)) continue;
          const stubLyricElement = this._createMeiElement(this._scoreData.meiParsed, 'verse');
          stubLyricElement.setAttribute('n', lineNumber);
          const label = realLyricElements[0].getAttribute('label');
          if (label) stubLyricElement.setAttribute('label', label);
          // Syllable is left empty to not interfere with lyric line counting
          const stubSyl = this._createMeiElement(this._scoreData.meiParsed, 'syl');
          stubSyl.setAttribute('con', 's');
          stubSyl.setAttribute('ch-end-underscore', '');
          stubLyricElement.appendChild(stubSyl);
          event.appendChild(stubLyricElement);
          activeLineNumbers.delete(lineNumber);
        }
      }

      for (const [lineNumber, lyricElement] of lyricElementsByLine) {
        // The last syllable with words, not the first (so the right @con is used for elisions where there are multiple syllables on a note (common in languages like Spanish)
        const syl = Array.from(lyricElement.querySelectorAll('syl:not(:empty)')).at(-1);
        if (!syl) continue;
        if (syl.getAttribute('con') === 'u') activeLineNumbers.add(lineNumber);
        else activeLineNumbers.delete(lineNumber);
      }
    }
  }
}

// Improve appearance of dir elements.
// Adds attributes to intro brackets: @ch-intro-bracket.
// Adds attributes to dir, harm, and fermata: @ch-chord-position.
ChScore.prototype._annotateDirections = function (elementsById, chordPositionQstamps) {
  let currentMeasureId = null;
  this._scoreData.features.hasOstinato = (this._scoreData.scoreMetadata.textBlocks ?? [])
    .some(block => this._patterns.ostinato.test(block.text));

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
        chordPosition = Number.parseInt(refNote?.getAttribute('ch-chord-position'));
        if (Number.isNaN(chordPosition)) {
          // Handle fermatas placed on a space or barline
          qstamp = this._qstampOfUnnumbered(refNote);
          chordPosition = qstamp == null ? null : this._bisectLeft(chordPositionQstamps, qstamp);
        } else {
          qstamp = this._scoreData.chordPositions[chordPosition].startQ;
        }
      }

      // Set chord position
      if (chordPosition != null) element.setAttribute('ch-chord-position', chordPosition);

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
      } else if (this._patterns.roundMarker.test(elementText)) {
        element.setAttribute('ch-round-marker', '');
        this._scoreData.features.hasRound = true;
      }
      if (this._patterns.ostinato.test(elementText)) this._scoreData.features.hasOstinato = true;

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
}

// Get key signature info, and the nearby keys a score can be transposed into.
// On scores converted from MXL, use <keySig> attributes (sig, pname, accid, mode).
// On scores converted from ABC, use <scoreDef> attributes (key.sig, key.pname, key.accid, key.mode).
ChScore.prototype._resolveKeySignatures = function () {
  const keySignatureElement = this._scoreData.meiParsed.querySelector('keySig');
  const scoreDefElement = this._scoreData.meiParsed.querySelector('scoreDef');
  const meiSig = keySignatureElement?.getAttribute('sig') ?? scoreDefElement?.getAttribute('key.sig') ?? null;
  const meiPname = keySignatureElement?.getAttribute('pname') ?? scoreDefElement?.getAttribute('key.pname') ?? null;
  const meiAccid = keySignatureElement?.getAttribute('accid') ?? scoreDefElement?.getAttribute('key.accid') ?? null;
  const meiPnameAccid = meiPname ? (meiPname + (['f', 's'].includes(meiAccid) ? meiAccid : '')) : null;
  const tonality = keySignatureElement?.getAttribute('mode') ?? scoreDefElement?.getAttribute('key.mode') ?? 'major';
  const keySignatures = this._getKeySignatures(tonality);
  const defaultKeySignatureEntry = Object.entries(keySignatures).find(ks => (ks[1].meiSig === meiSig || ks[1].meiPnameAccid === meiPnameAccid));
  if (!defaultKeySignatureEntry) {
    console.error(`Error: Unrecognized key signature (sig: ${meiSig}, pname: ${meiPnameAccid}, mode: ${tonality}).`);
  }
  this._scoreData.keySignatures = this._getKeySignatureIds(tonality);
  const [defaultKeySignatureId, defaultKeySignatureInfo] = defaultKeySignatureEntry ?? [null, null];

  // Get nearby key signatures
  const nearbyKeySignatureIds = defaultKeySignatureEntry ? Object.keys(keySignatures) : [];
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
  this._scoreData.keySignatureInfo = defaultKeySignatureEntry ? {
    keySignatureId: defaultKeySignatureId,
    nearbyKeySignatures: nearbyKeySignatures,
    ...defaultKeySignatureInfo,
  } : null;
}

// Get expanded chord positions (expand verses, repeats, codas, etc. based on score map).
// An instruction printed in the gap between the staves, saying what a lyric line is for:
// "(*Optional)" in "My Covenants", "(4th verse)" in "Dear to the Heart of the Shepherd".
// Matched by shape rather than wording, so it reads the same in any language: a parenthetical
// or a phrase ending in a colon, carrying a footnote mark or a number.
const CH_LYRIC_INSTRUCTION = /^\(.*\)$|:$/;
const CH_FOOTNOTE_MARK = /[*\u2020\u2021]/;

// A line marked with a footnote mark is an alternate text for an occasion ("*Alternate text
// for baptism day."), not a verse sung in sequence. Its words are read out beside that
// footnote and the line and instruction then come out of the score.
// The pass an instruction names: a digit where it writes one, else a spelled-out number,
// which is the one thing here that has to be read in the score's own language.
ChScore.prototype._instructedPassNumber = function (text) {
  const digits = this._markerNumber(text);
  if (digits != null) return digits;
  const words = this._verseNumberWords[this._scoreData.scoreMetadata?.lang] ?? {};
  const spelled = new Set(text.toLowerCase().split(/[^\p{L}]+/u));
  for (const [number, word] of Object.entries(words)) {
    if (spelled.has(word)) return Number.parseInt(number);
  }
  return null;
}

ChScore.prototype._markInstructedLyricLines = function () {
  const meiParsed = this._scoreData.meiParsed;
  const melodyStaff = this._staffNumberOf(meiParsed.querySelector('[ch-melody]'));
  // The verse each instruction names, to be turned into the section it belongs to once
  // sections are derived (_buildExpandedChordPositions).
  this._scoreData.instructedVerseByDir = new Map();
  if (Number.isNaN(melodyStaff)) return;

  const chordPositionOf = (verse) =>
    Number.parseInt(verse.closest('note, chord')?.getAttribute('ch-chord-position'));
  const staffVerses = [...meiParsed.querySelectorAll(`staff[n="${melodyStaff}"] verse`)];
  const sungVerses = staffVerses.filter(verse => verse.querySelector('syl:not(:empty)'));
  const textBlocks = this._scoreData.scoreMetadata?.textBlocks ?? [];

  // An instruction over a staff above the melody's can say which verse that optional descant
  // or obbligato joins in on ("Optional descant (with verse 3)"). It sings from there on, so
  // the staff and any line it carries belong to that verse and the ones after it.
  const directionsAbove = [...meiParsed.querySelectorAll('dir[place="above"][staff]')];
  this._scoreData.staffEntersAtVerse = new Map();
  for (const dir of directionsAbove) {
    const staff = Number.parseInt(dir.getAttribute('staff'));
    if (staff >= melodyStaff) continue;
    const entersAt = this._instructedPassNumber(dir.textContent.trim().replace(/\s+/g, ' '));
    if (!(entersAt > 1)) continue;
    this._scoreData.staffEntersAtVerse.set(staff, entersAt);
    this._scoreData.instructedVerseByDir.set(dir, entersAt);
  }

  for (const dir of directionsAbove) {
    if (Number.parseInt(dir.getAttribute('staff')) <= melodyStaff) continue;
    const text = dir.textContent.trim().replace(/\s+/g, ' ');
    if (!CH_LYRIC_INSTRUCTION.test(text)) continue;
    // A mark points at a footnote, making the line an alternate text; a number names the pass
    // it is sung on ("(4th verse)"). Anything else is not an instruction about a lyric line.
    const mark = CH_FOOTNOTE_MARK.exec(text)?.[0];
    const footnoteIndex = mark
      ? textBlocks.findIndex(block => block.text.trimStart().startsWith(mark)) : -1;
    const pass = mark ? 0 : this._instructedPassNumber(text);
    if (footnoteIndex === -1 && !(pass > 0)) continue;
    const from = Number.parseInt(dir.getAttribute('ch-chord-position'));
    if (Number.isNaN(from)) continue;

    // The extra line where the instruction is printed: the lowest line the melody staff is
    // still singing there, the verses above it being the ones sung in sequence
    const at = sungVerses.filter(verse => chordPositionOf(verse) >= from);
    const lineNumber = Math.max(...at.map(verse => Number.parseInt(verse.getAttribute('n'))));
    if (!Number.isFinite(lineNumber)) continue;

    const instructed = at.filter(verse => Number.parseInt(verse.getAttribute('n')) === lineNumber);
    // A line sung on one named pass stays in the lyrics, on that pass alone
    if (pass) {
      for (const verse of instructed) verse.setAttribute('ch-pass', pass);
      this._scoreData.instructedVerseByDir.set(dir, pass);
      continue;
    }
    const words = [];
    for (const verse of instructed) {
      for (const syl of verse.querySelectorAll('syl:not(:empty)')) {
        const continues = !this._startsWord(syl);
        if (continues && words.length) words[words.length - 1] += syl.textContent.trim();
        else words.push(syl.textContent.trim());
      }
    }
    // Onto the footnote it belongs to, as another line of the same block -- the way a score
    // that prints its alternate words rather than engraving them reads ("*Alternate phrases:"
    // in "If You're Happy")
    if (words.length) {
      const footnote = textBlocks[footnoteIndex];
      footnote.text += `\n${words.join(' ')}`;
      footnote.html += `\n${words.join(' ')}`;
    }
    // The words are read out, so the line and its instruction come out of the score and
    // nothing downstream has to skip them. The line goes whole: a verse holding only an empty
    // syllable is a melisma's closing stub, which sings nothing but still draws a lyric row.
    for (const verse of staffVerses) {
      if (Number.parseInt(verse.getAttribute('n')) === lineNumber
        && chordPositionOf(verse) >= from) verse.remove();
    }
    dir.remove();
  }
}

// Adds attributes to lyric elements: @ch-section-id, @ch-chorus.
ChScore.prototype._buildExpandedChordPositions = function (chordPositionCounter, lyricElementsAt) {
  this._scoreData.expandedChordPositions = [];
  this._scoreData.audibleExpandedChordPositions = [];
  let expandedChordPositionQStartCounter = 0;
  // A range left without an end runs to the end of the score; settle that before walking.
  for (const sectionInfo of this._scoreData.sections) {
    for (const chordPositionRange of sectionInfo.chordPositionRanges) {
      if (!chordPositionRange.end) chordPositionRange.end = chordPositionCounter;
    }
  }
  // An instruction naming a verse belongs to the passage it is *printed in*, on the pass it
  // names: "(4th verse)" is printed in the chorus, so it belongs to the fourth chorus rather
  // than to verse 4. Keyed by chord position, to be named in the walk below.
  const instructionsAt = this._groupBy([...this._scoreData.instructedVerseByDir ?? []],
    ([dir]) => Number.parseInt(dir.getAttribute('ch-chord-position')));

  // Records the numbering `ch-expanded-chord-position` indexes into; expansion replays
  // this sequence rather than deriving it again.
  for (const { range, chordPosition, expandedChordPosition: expandedChordPositionCounter, passNumber }
    of this._walkSungChordPositions(this._sectionChordPositionRanges())) {
    const sectionInfo = range.sectionInfo;
    const staffNumbers = range.staffNumbers ?? this._scoreData.staffNumbers;

    // Add attribute: dir@ch-section-id
    for (const [dir, verse] of instructionsAt.get(chordPosition) ?? []) {
      if (verse === passNumber) this._addSectionId(dir, sectionInfo.sectionId);
    }

    const lyricLabels = [];
    const lyricSyllables = [];
    if (range.lyricLineIds) {
      const lyricElements = lyricElementsAt(chordPosition, range.lyricLineIds);
      for (const lyricElement of lyricElements) {
        // Add attribute: verse@ch-section-id, for lyric elements no stanza named -- a tail word
        // dropped as a duplicate, or the parenthesized copy of a pickup. Those are still
        // drawn, so they keep the section their music sits in.
        if (!this._scoreData.stanzaNamedLyricElements?.has(lyricElement)) {
          this._addSectionId(lyricElement, sectionInfo.sectionId);
        }

        // Add attribute: verse@ch-chorus
        if (sectionInfo.type === 'chorus' || lyricElement.getAttribute('label') === 'chorus') {
          lyricElement.setAttribute('ch-chorus', '');
          lyricElement.removeAttribute('label');
        }

        for (const label of lyricElement.querySelectorAll('label')) {
          const text = label.textContent.trim();
          if (text) lyricLabels.push(text);
        }
        for (const syl of lyricElement.querySelectorAll('syl:not(:empty)')) {
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
}

// Get chord position, note, rest, and measure info from Verovio timemap.
// Adds attributes to chords, notes, and rests: @ch-chord-position, @ch-part-id, @ch-melody.
// Verovio timemap should include regular notes, tied notes, cue notes, and rests (may also
// include grace notes -- need to test). Returns the number of chord positions written.
ChScore.prototype._annotateFromTimemap = function (vrvTimemap, elementsById) {
  this._scoreData.chordPositions = []
  this._scoreData.audibleChordPositions = [];
  const staffPartIdsCache = new Map();
  // Durations up front, from the on/off pairs in the timemap. The sort below needs them
  // while a chord position is being built, which is before the note's own off entry is
  // reached and elementInfo.durationQ is filled in.
  const durationQById = new Map();
  const onQById = new Map();
  for (const entry of vrvTimemap) {
    for (const elementId of (entry.on ?? []).concat(entry.restsOn ?? [])) {
      onQById.set(elementId, entry.qstamp);
    }
    for (const elementId of (entry.off ?? []).concat(entry.restsOff ?? [])) {
      if (onQById.has(elementId)) durationQById.set(elementId, entry.qstamp - onQById.get(elementId));
    }
  }
  const totalDurationQ = (note) => (durationQById.get(note.elementId) ?? 0)
    + (note.tiedNoteId ? durationQById.get(note.tiedNoteId) ?? 0 : 0);
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
        previousMeasureInfo.measureType = this._measureType(previousMeasureInfo);
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

      // Sort notes to make aligning with MIDI notes easier: by pitch, then by how long the
      // note sounds, counting the note it ties into
      notesAndRests.sort((a, b) => a.pitch - b.pitch || totalDurationQ(a) - totalDurationQ(b));

      // Assign notes to parts
      // Order of notes is reversed to align with parts, which are sorted highest to lowest
      if (notesAndRests.length > 0) this._scoreData.features.hasPartInfo = true;
      let melodyNote = null;
      const numNotesByChord = {};
      const chordSizes = {};
      for (const note of notesAndRests.slice().reverse()) {
        let positionInChord = null;
        const layerNumber = note.layerNumber;
        const staffNumber = note.staffNumber;

        if (note.meiChordElement) {
          const chordId = note.meiChordElement.getAttribute('xml:id');
          if (!(chordId in numNotesByChord)) {
            numNotesByChord[chordId] = 0;
            chordSizes[chordId] = note.meiChordElement.querySelectorAll('note').length;
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
            staffPartIndex = positionInChord - chordSizes[note.meiChordElement.getAttribute('xml:id')];
          } else {
            staffPartIndex = -1;
          }
        }

        const [staffPartIds, melodyPartIds] = this._staffPartIds(staffNumber, chordPositionCounter, this._scoreData.parts, staffPartIdsCache);
        note.partIds = staffPartIds.length > Math.abs(staffPartIndex) ? staffPartIds.at(staffPartIndex) : [];
        note.meiElement.setAttribute('ch-part-id', note.partIds.join(' '));

        if (melodyPartIds.length && note.partIds.some(partId => melodyPartIds.includes(partId))) {
          // Two-part songs have multiple melodies (example: A Child’s Prayer). Tag notes from both melodies, but choose the first for melodyNote, which is expected to be singular downstream.
          note.meiElement.setAttribute('ch-melody', '');
          note.isMelody = true;
          this._scoreData.features.hasMelodyInfo = true;
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
  previousMeasureInfo.measureType = this._measureType(previousMeasureInfo);
  if (previousMeasureInfo.firstChordPosition != null) { // Will be null if the measure is empty
    this._scoreData.chordPositions[previousMeasureInfo.firstChordPosition].isDownbeat = !['partial-end', 'partial-pickup'].includes(previousMeasureInfo.measureType);
  }
  previousChordPositionInfo.endQ = vrvTimemap.at(-1).qstamp;
  previousChordPositionInfo.durationQ = previousChordPositionInfo.endQ - previousChordPositionInfo.startQ;
  return chordPositionCounter;
}

// Get measure type: full, partial-pickup, partial-pickdown, partial-start, partial-end
ChScore.prototype._measureType = function (measureInfo) {
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

// The parts sounding on a staff at a chord position, as a list of lists indexed by staff
// part index, plus whichever of them carry the tune. `cache` is supplied by the caller and
// keyed by chord position and staff, since the answer only changes where the parts do.
ChScore.prototype._staffPartIds = function (staffNumber, chordPosition, parts, cache) {
  const cacheKey = `${chordPosition}:${staffNumber}`;
  const cached = cache.get(cacheKey);
  if (cached) return [cached[0].map(staffPartIds => [...staffPartIds]), cached[1]];

  const partIdsDict = { 1: [], 2: [], 3: [], 4: [] };
  const fullPartIds = [];
  // Whichever parts carry the tune on this staff at this chord position, under whatever
  // name ('alto' where the tune has moved down a voice). Not _scoreData.twoPartMelodyPartIds,
  // which is the whole score's 'Two-Part' answer and holds only part-N.
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

  cache.set(cacheKey, [partIds, melodyPartIds]);
  return [partIds.map(cachedPartIds => [...cachedPartIds]), melodyPartIds];
}

// Mark help text and settle verse numbers on the score's lyric elements. One walk over the
// <verse> elements serves both: the second half regroups the survivors by the verse number
// the first half just assigned, rather than querying the document again.
ChScore.prototype._normalizeLyricElements = function (meiParsed) {
  const lyricElementsByStaffAndLine = new Map();
  const staffNumberOf = new Map();
  for (const lyricElement of meiParsed.querySelectorAll('verse')) {
    const staffNumber = lyricElement.closest('staff')?.getAttribute('n') ?? '';
    staffNumberOf.set(lyricElement, staffNumber);
    const key = `${staffNumber}.${lyricElement.getAttribute('n')}`;
    if (!lyricElementsByStaffAndLine.has(key)) lyricElementsByStaffAndLine.set(key, []);
    lyricElementsByStaffAndLine.get(key).push(lyricElement);
  }

  this._markHelpTextLyrics(lyricElementsByStaffAndLine);
  this._normalizeLyricVerseNumbers(meiParsed, lyricElementsByStaffAndLine, staffNumberOf);
}

// Parenthesized text that helps a singer rather than being sung: a pronunciation guide on
// its own lyric line ("(grah-see-ahs)" under "Gracias." in "Children All over the World"),
// or a performance label elided onto a verse's first syllable ("(Girls)" in "Love Is Spoken
// Here"). Marked @ch-help-text -- on the verse for a whole line, on the syllable for a
// label sharing its verse with sung words -- and skipped everywhere the words are read.
// A whole parenthesized group, since a syllable's own parentheses open and close on
// different syllables ("(grah" / "see-" / "ahs)")
const CH_PARENTHESIZED = /\([^)]*\)/g;
// A verse marker in parentheses: "(3.)" printed over a repeat's pickup names the verse it
// leads into, so it isn't help text
const CH_PARENTHESIZED_MARKER = /^\(\s*\d+\s*[.)]?\s*\)$/;
ChScore.prototype._markHelpTextLyrics = function (lyricElementsByStaffAndLine) {
  // A whole lyric line of nothing but parentheses, on a staff that has another line to
  // sing. A staff whose every line reads that way is taken at face value instead.
  const helpLineKeys = new Set();
  for (const [key, lyricElements] of lyricElementsByStaffAndLine) {
    const lineText = lyricElements
      .flatMap(lyricElement => [...lyricElement.querySelectorAll('syl:not(:empty)')])
      .map(syl => syl.textContent.trim()).join(' ');
    if (!lineText.includes('(')) continue;
    if (/[\p{L}\p{N}]/u.test(lineText.replace(CH_PARENTHESIZED, ''))) continue;
    helpLineKeys.add(key);
  }
  const countByStaff = (keys) => {
    const counts = new Map();
    for (const key of keys) {
      const staffNumber = key.split('.')[0];
      counts.set(staffNumber, (counts.get(staffNumber) ?? 0) + 1);
    }
    return counts;
  };
  const helpLinesOnStaff = countByStaff(helpLineKeys);
  const linesOnStaff = countByStaff(lyricElementsByStaffAndLine.keys());
  for (const key of helpLineKeys) {
    const staffNumber = key.split('.')[0];
    if (helpLinesOnStaff.get(staffNumber) === linesOnStaff.get(staffNumber)) continue;
    for (const lyricElement of lyricElementsByStaffAndLine.get(key)) lyricElement.setAttribute('ch-help-text', '');
  }

  // A label elided onto the first syllable of a verse that goes on to be sung
  for (const [key, lyricElements] of lyricElementsByStaffAndLine) {
    if (helpLineKeys.has(key)) continue;
    for (const [index, lyricElement] of lyricElements.entries()) {
      const syls = [...lyricElement.querySelectorAll('syl:not(:empty)')];
      if (syls.length < 2) continue;
      const text = syls[0].textContent.trim();
      if (!/^\([^()]*\)$/.test(text) || CH_PARENTHESIZED_MARKER.test(text)) continue;
      syls[0].setAttribute('ch-help-text', '');

      // The label's own italics get engraved onto the syllable elided with it, which is a
      // question of styling rather than of what the word is. Moved back onto the label,
      // unless the line carries on styled -- there the emphasis belongs to the words.
      const nextSyl = lyricElements[index + 1]?.querySelector('syl:not(:empty)');
      if (nextSyl?.getAttribute('fontstyle') || nextSyl?.getAttribute('fontweight')) continue;
      for (const syl of syls.slice(1)) {
        syl.removeAttribute('fontstyle');
        syl.removeAttribute('fontweight');
      }
    }
  }

  // Which verse each remaining line is, counting the help lines out. Ranked over the
  // score's line numbers rather than each staff's, since a two-part score gives each part
  // its own staff and its own line number ("2.2" is the second part's verse 2). @n is left
  // as engraved -- Verovio draws a verse on the row @n names, and renumbering would print
  // verse 2's words over the pronunciation guide belonging to verse 1. With no help text
  // this comes back to @n, so a score without any is unchanged.
  const sungLineNumbers = new Set();
  for (const lyricElements of lyricElementsByStaffAndLine.values()) {
    if (lyricElements[0].hasAttribute('ch-help-text')) continue;
    const lineNumber = Number.parseInt(lyricElements[0].getAttribute('n'));
    if (!Number.isNaN(lineNumber)) sungLineNumbers.add(lineNumber);
  }
  this._verseNumbersByLineNumber = new Map([...sungLineNumbers]
    .sort((a, b) => a - b).map((lineNumber, index) => [lineNumber, index + 1]));
}

// Which verse a lyric line is, from the ranking _markHelpTextLyrics worked out with the help
// text counted out. Falls back to the engraved line number, which is what it is on a score
// with no help text, and what a help line is itself. Always a number, never null: callers
// build `staff.line` ids from it, and null passes a Number.isNaN guard to give "1.null".
ChScore.prototype._verseLineNumber = function (lyricElement) {
  const lineNumber = Number.parseInt(lyricElement.getAttribute('n'));
  if (lyricElement.hasAttribute('ch-help-text')) return lineNumber;
  return this._verseNumbersByLineNumber?.get(lineNumber) ?? lineNumber;
}

// Clean up verse numbers that were engraved as part of a lyric syllable
// Example: "Venid a Mí" (Spanish Hymns #61)
const CH_INLINE_VERSE_NUMBER = /^\s*\(?(\d+\s*[.)])\s*/;
ChScore.prototype._normalizeLyricVerseNumbers = function (meiParsed, lyricElementsByStaffAndLine, staffNumberOf) {
  // Regrouped from the walk in _normalizeLyricElements, by the verse number
  // _markHelpTextLyrics just assigned rather than by the engraved line
  const lyricElementsByStaff = new Map();
  for (const lyricElements of lyricElementsByStaffAndLine.values()) {
    for (const lyricElement of lyricElements) {
      if (lyricElement.hasAttribute('ch-help-text')) continue;
      if (lyricElement.textContent.trim() === '') continue;
      const lineNumber = this._verseLineNumber(lyricElement);
      if (Number.isNaN(lineNumber)) continue;
      const staffNumber = staffNumberOf.get(lyricElement);
      if (!lyricElementsByStaff.has(staffNumber)) lyricElementsByStaff.set(staffNumber, new Map());
      const lyricElementsByLineNumber = lyricElementsByStaff.get(staffNumber);
      if (!lyricElementsByLineNumber.has(lineNumber)) lyricElementsByLineNumber.set(lineNumber, []);
      lyricElementsByLineNumber.get(lineNumber).push(lyricElement);
    }
  }

  // What names a line as its own verse: a label already carrying the number, or the number
  // engraved into the line's first syllable. One score can do both — Verovio reads a
  // number elided onto the first word as a label, but not one written into the word itself
  // ("2." on line 3 of "Feliz Cumpleaños", against "1.“Fe" on line 1).
  const inlineNumberMatch = (lyricElements) => {
    const syl = lyricElements?.[0].querySelector('syl:not(:empty)');
    return (syl && CH_INLINE_VERSE_NUMBER.exec(syl.textContent)) || null;
  };
  const numberOf = (lyricElements, lineNumber) => {
    const label = lyricElements?.[0].querySelector('label');
    if (label) return this._markerNumber(label.textContent);
    const match = inlineNumberMatch(lyricElements);
    return match ? Number.parseInt(match[1]) : null;
  };

  for (const lyricElementsByLineNumber of lyricElementsByStaff.values()) {
    // The verses run from the first line, and what follows them is unnumbered — a chorus
    // printed on its own lyric line. A number appearing again after the run says the lines
    // aren't verse numbers at all, so nothing is moved.
    let numberedLines = 0;
    while (numberOf(lyricElementsByLineNumber.get(numberedLines + 1), numberedLines + 1)
      === numberedLines + 1) numberedLines++;
    if (numberedLines === 0) continue;
    let hasNumberAfterVerses = false;
    for (let lineNumber = numberedLines + 1; lineNumber <= lyricElementsByLineNumber.size; lineNumber++) {
      if (numberOf(lyricElementsByLineNumber.get(lineNumber), lineNumber) !== null) {
        hasNumberAfterVerses = true;
      }
    }
    if (hasNumberAfterVerses) continue;

    // Each stanza's number moves out of the syllable it was engraved in
    for (const [lineNumber, lyricElements] of lyricElementsByLineNumber) {
      if (lineNumber > numberedLines) continue;
      for (const lyricElement of lyricElements) {
        if (lyricElement.querySelector('label')) continue;
        const syl = lyricElement.querySelector('syl:not(:empty)');
        const match = syl && CH_INLINE_VERSE_NUMBER.exec(syl.textContent);
        if (!match) continue;
        const labelElement = this._createMeiElement(meiParsed, 'label');
        labelElement.textContent = match[1].replace(/\s+/g, '');
        lyricElement.insertBefore(labelElement, lyricElement.firstChild);
        syl.textContent = syl.textContent.slice(match[0].length);
      }
    }
  }
}

// Move the melody's words onto the melody itself, for showMelodyOnly to keep when it strips
// everything else away: a lower voice carrying the tune ('SATB#A') keeps its words engraved
// on the voice above, which is about to go. Which verses are the melody's is
// _melodyLyricElementIndex' question, asked here too so rendering and extraction agree.
ChScore.prototype._moveMelodyLyricsOntoMelody = function () {
  const melodyByChordPosition = new Map();
  const melodyRests = new Set();
  for (const element of this._scoreData.meiParsed.querySelectorAll(':is(note, rest)[ch-melody]')) {
    const chordPosition = Number.parseInt(element.getAttribute('ch-chord-position'));
    if (Number.isNaN(chordPosition)) continue;
    // The chord, when there is one: a note inside it is removed, but the chord stays
    if (element.matches('rest')) melodyRests.add(chordPosition);
    else if (!melodyByChordPosition.has(chordPosition)) melodyByChordPosition.set(chordPosition, element.closest('chord') ?? element);
  }

  const melodyLayers = this._melodyLayerByStaffAndChordPosition();
  const lyricElementsByChordPosition = new Map();
  for (const lyricElement of this._scoreData.meiParsed.querySelectorAll(':is(note, chord) verse')) {
    const holder = lyricElement.closest('note, chord');
    if (this._carriesMelody(holder)) continue;
    // Extraction reads a verse above the melody on the melody's own staff, since words below
    // it there are a second voice's. Rendering removes whole staves too, so the same
    // convention applies a level up: a staff above the tune's holds its words ('SS+A#A').
    const chordPosition = Number.parseInt(holder.getAttribute('ch-chord-position'));
    // One staff lookup for the holder, shared with _isAboveMelody, and the melody's staff
    // only where the first test did not already settle it
    const staffNumber = this._staffNumberOf(holder);
    if (!this._isAboveMelody(holder, melodyLayers, staffNumber)
      && !(staffNumber < this._staffNumberOf(melodyByChordPosition.get(chordPosition)))) continue;
    if (!lyricElementsByChordPosition.has(chordPosition)) lyricElementsByChordPosition.set(chordPosition, []);
    lyricElementsByChordPosition.get(chordPosition).push(lyricElement);
  }

  const lateEntry = this._lateMelodyLyricTargets(melodyByChordPosition, melodyRests, lyricElementsByChordPosition);
  for (const [chordPosition, lyricElements] of lyricElementsByChordPosition) {
    const target = melodyByChordPosition.get(lateEntry.get(chordPosition) ?? chordPosition);
    for (const lyricElement of lyricElements) {
      if (!target || target === lyricElement.closest('note, chord')) continue;
      // Verses stack in @n order, so put it in place rather than on the end
      const lineNumber = Number.parseInt(lyricElement.getAttribute('n'));
      const below = Array.from(target.children).find(child => child.matches('verse')
        && Number.parseInt(child.getAttribute('n')) > lineNumber);
      target.insertBefore(lyricElement, below ?? null);
      // These are the melody's own words now, engraved on the voice above only because the
      // tune moved down. showMelodyOnly drops what is still secondary after this.
      lyricElement.removeAttribute('ch-secondary');
    }
  }
}

// Which note each chord position's words belong on where the melody rests under a word: the
// voice carrying the tune entered late and is catching up, so pair its notes with the words
// in order until the counts come back level. No corpus score reaches this — theirs is
// answered by the parts template naming the part that holds the words — but filtering to an
// arbitrary part (see the TODO in _updateMei) has no template to rely on.
ChScore.prototype._lateMelodyLyricTargets = function (melodyByChordPosition, melodyRests, lyricElementsByChordPosition) {
  // A stretch longer than this is two phrases read as one, not a voice catching up
  const CH_MAX_LATE_ENTRY_SPAN = 24;
  const lastChordPosition = this._scoreData.numChordPositions - 1;
  const targets = new Map();
  let consumedThrough = -1;

  for (const start of [...melodyRests].filter(cp => lyricElementsByChordPosition.has(cp)).sort((a, b) => a - b)) {
    if (start <= consumedThrough) continue;

    // Walk forward, collecting the words still owed a note and the notes still owed a word,
    // until the two balance — the melody has then said everything the words say
    const owed = [];
    const notes = [];
    const balanced = () => notes.length > 0 && notes.length === owed.length;
    let at = start;
    for (; at <= lastChordPosition && at - start < CH_MAX_LATE_ENTRY_SPAN; at++) {
      if (lyricElementsByChordPosition.has(at)) owed.push(at);
      if (melodyByChordPosition.has(at)) notes.push(at);
      if (balanced()) break;
    }
    if (!balanced()) continue;

    for (let i = 0; i < owed.length; i++) targets.set(owed[i], notes[i]);
    consumedThrough = at;
  }
  return targets;
}

// Clean up and add metadata to MEI document based on rendering options
ChScore.prototype._updateMei = function () {
  this._scoreData.meiParsed = this._scoreData.meiParsedComplete.cloneNode(true);

  // Set chord set visibility
  // Add attributes to chord symbols: @ch-superscript
  if (this._scoreData.features.hasChordSets) {
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
          chordInfo.textMarkup = this._chordSymbolMarkup(chordInfo);
          chordSet.chordInfoList.push(chordInfo);
        }
      }
      for (const chordInfo of chordSet.chordInfoList) {
        const harm = this._createMeiElement(this._scoreData.meiParsed, 'harm');
        harm.setAttribute('staff', this._scoreData.harmStaffNumber);
        harm.innerHTML = chordInfo.textMarkup ??= this._chordSymbolMarkup(chordInfo);
        harm.setAttribute('tstamp', chordInfo.tstamp);
        harm.setAttribute('ch-chord-position', chordInfo.chordPosition);
        this._scoreData.meiParsed.querySelector(`measure[*|id="${chordInfo.measureId}"]`).append(harm);
        // <harm> elements can be positioned using a note ID (commented line below) or tstamp. tstamp requires more calculation, but it remains stable when notes are hidden (for example, when showing the melody only).
        // harm.setAttribute('startid', '#' + note.getAttribute('xml:id'));
      }
    }
  }

  // Set fingering mark visibility
  if (this._scoreData.features.hasFingeringMarks && !this._currentOptions.showFingeringMarks) {
    for (const fingeringMark of this._scoreData.meiParsed.querySelectorAll('fing')) {
      fingeringMark.remove();
    }
  }

  // Set measure number visibility
  const scoreDef = this._scoreData.meiParsed.querySelector('scoreDef');
  scoreDef.setAttribute('mnum.visible', !!this._currentOptions.showMeasureNumbers);

  // Show melody only
  // Edge cases for testing: "I Am a Child of God" (1989 Children’s Songbook); "The Morning Breaks" (1985 Hymns)
  // A melody carrying no lyrics of its own is handled by _moveMelodyLyricsOntoMelody: its
  // words are engraved on the part above, which is about to be removed.
  // TODO: Allow filtering to any part(s). Challenges: If layer/voice 1 in a staff is removed, the layer that remains may have empty spaces that need to be filled in with notes or rests copied from layer 1. Also, lyrics need to be attached to a part that remains visible.
  // See https://github.com/music-encoding/music-encoding/issues/1709
  if (this._currentOptions.showMelodyOnly && this._scoreData.features.hasMelodyInfo) {
    // Before anything is removed: where a lower voice carries the tune, its words are
    // engraved on the voice above it, and that voice is about to go
    this._moveMelodyLyricsOntoMelody();

    // Another voice's words go with that voice. Most sit on notes the sweep below removes,
    // but a second voice sharing the melody's staff would otherwise keep its lyrics.
    for (const lyricElement of this._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]')) {
      lyricElement.remove();
    }

    const deletedElementIds = [];
    // Remove non-melody notes and rests
    for (const element of this._scoreData.meiParsed.querySelectorAll(`note:not([ch-melody]), rest:not([ch-melody]), mRest`)) {
      deletedElementIds.push(element.getAttribute('xml:id'));
      element.remove();
    }
    // Independent melody lines are already one per staff, so consolidating onto one would
    // lose all but the first
    if (this._scoreData.twoPartMelodyPartIds.length <= 1) {
      // Move melody notes to a single staff and layer (preferring treble clef staff if any melody notes are on one)
      // A men's-choir score has no treble staff to prefer, and an empty :is() throws, so
      // the preference is only expressed when there is one to express
      const trebleStaves = this._scoreData.trebleClefStaffNumbersSelector;
      let melodyStaffNumber = trebleStaves
        ? this._scoreData.meiParsed.querySelector(`staff:is(${trebleStaves}) [ch-melody]`)?.closest('staff')?.getAttribute('n') ?? null
        : null;
      for (const [chordPosition, chordPositionInfo] of this._scoreData.chordPositions.entries()) {
        if (!chordPositionInfo.melodyNote) continue;
        if (!melodyStaffNumber) melodyStaffNumber = chordPositionInfo.melodyNote.staffNumber;
        // Melody element may be a note, rest, or chord — and must be the one carrying the
        // melody, not merely the first at this chord position. Removing the other parts
        // leaves an emptied <chord> shell behind on the staves above until the orphan sweep
        // below, and gathering the words onto that shell would delete them with it.
        const melodyElement = this._scoreData.meiParsed.querySelector(
          `[ch-chord-position="${chordPosition}"]:is(chord:has([ch-melody]), note[ch-melody], rest[ch-melody])`);
        if (!melodyElement) continue;
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
    if (this._currentOptions.expandScore === 'full-score' && this._scoreData.features.hasExpansion) {
      const singleLineSectionIds = new Set();
      const isTwoPart = this._scoreData.features.hasTwoPartMelody;

      // Gather section contents
      // TODO: No need to get previous element siblings if this is fixed in Verovio code. Example: "This Is the Christ" (Hymns—For Home and Church)
      // https://github.com/rism-digital/verovio/pull/4250
      const parentSection = expansion.parentElement;
      const sectionsById = {};
      const sectionIdCounter = {};
      // Built before the loop below starts detaching sections, which would hide them from it
      const melodyLyricElements = this._melodyLyricElementIndex();
      for (const section of parentSection.querySelectorAll('section, ending')) {
        const sectionId = section.getAttribute('xml:id');

        // Check if section element has multiple simultaneous lyric lines, by the same
        // per-chord-position measure extraction uses (see _hasStackedMelodyLyrics)
        const sectionChordPositions = (section.getAttribute('ch-chord-position') ?? '')
          .trim().split(/\s+/).filter(Boolean).map(cp => Number.parseInt(cp));
        const hasMultipleLyricLines = sectionChordPositions
          .some(cp => this._hasStackedMelodyLyrics(cp, melodyLyricElements));
        if (!hasMultipleLyricLines) singleLineSectionIds.add(sectionId);

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

      // Create new section elements, tagged with which playthrough of the song each is
      let iterationNumber = 0;
      const sectionIdsThisIteration = new Set();
      for (const sectionId of sectionIds) {
        if (iterationNumber === 0 || sectionIdsThisIteration.has(sectionId)) {
          iterationNumber += 1;
          sectionIdsThisIteration.clear();
        }
        sectionIdsThisIteration.add(sectionId);
        sectionIdCounter[sectionId] += 1;
        for (const element of sectionsById[sectionId]) {
          const newElement = element.cloneNode(true);
          this._suffixIds(newElement, `-rend${sectionIdCounter[sectionId]}`);
          if (newElement.matches('section, ending')) {
            newElement.setAttribute('ch-iteration', iterationNumber);
          }
          parentSection.append(newElement);
        }
      }

      // Clean up endings
      for (const ending of this._scoreData.meiParsed.querySelectorAll('ending')) {
        const endingSection = this._createMeiElement(this._scoreData.meiParsed, 'section');
        endingSection.setAttribute('xml:id', ending.getAttribute('xml:id'));
        endingSection.setAttribute('ch-chord-position', ending.getAttribute('ch-chord-position'));
        if (ending.hasAttribute('ch-iteration')) {
          endingSection.setAttribute('ch-iteration', ending.getAttribute('ch-iteration'));
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
      let currentIteration = 0;
      const sectionElements = this._scoreData.meiParsed.querySelectorAll('section[type="introduction"], section:not([type="introduction"]) > section');

      // For a two-part song, @ch-iteration indicates which part is singing, not the walk's pass number. The walk counts visits per chord position, so a repeat ending whose positions no body range covered reads as pass 1 however many iterations precede it. _gatherSyllables' tail-word handling works around the same mismatch.
      const iterationOf = section => Number.parseInt(section.getAttribute('ch-iteration')) || 0;
      const twoPartMelodyPartIds = this._scoreData.twoPartMelodyPartIds;
      // A chord takes its part from the notes inside it
      const partIdOf = element => element.getAttribute('ch-part-id')
        ?? element.querySelector('note[ch-part-id]')?.getAttribute('ch-part-id');

      // A labelled pickup ("(3.)" in "A Child’s Prayer", 1989 CSB) leads into the verse it
      // names, so it sounds at the end of the iteration before that one, not with its part.
      // The label sits on the word's first syllable only, so the state runs on until the
      // next word start resets it. Keyed by note rather than verse, and built up front,
      // because the replay prunes verses.
      const pickupIterationByElement = new Map();
      if (isTwoPart) {
        for (const section of sectionElements) {
          const pickupIterationByLine = {};
          for (const lyricElement of section.querySelectorAll('verse')) {
            const lyricLineId = lyricElement.getAttribute('ch-lyric-line-id');
            if (this._startsWord(lyricElement)) {
              const pickupVerse = this._pickupVerseNumber(lyricElement);
              pickupIterationByLine[lyricLineId] = pickupVerse == null ? null : pickupVerse - 1;
            }
            const pickupIteration = pickupIterationByLine[lyricLineId];
            if (pickupIteration == null) continue;
            const noteOrChord = lyricElement.closest('note, chord');
            if (!noteOrChord) continue;
            pickupIterationByElement.set(noteOrChord, pickupIteration);
            // A chord is rested out as a whole, so it needs the mark its notes carry
            const chord = noteOrChord.parentElement?.closest('chord');
            if (chord) pickupIterationByElement.set(chord, pickupIteration);
          }
        }
      }
      // Whether a part's note is sung in a given iteration: a pickup only in the iteration
      // it leads out of, anything else whenever its own part is singing — and once every
      // part has had its pass, they all sing.
      const soundsInIteration = (element, iteration) => {
        const pickupIteration = pickupIterationByElement.get(element);
        if (pickupIteration != null) return iteration === pickupIteration;
        const singingPartId = twoPartMelodyPartIds[iteration - 1]; // undefined once all have sung
        return !singingPartId || partIdOf(element) === singingPartId;
      };
      // Replay the sequence recorded at parse time rather than walking it again.
      // `ch-expanded-chord-position` indexes into this very array, so writing it while
      // reading it keeps the two in step by construction.
      // Secondary lyrics sit below the melody's row when expanded, one row per line so two
      // voices don't overlap. Ranked per staff across the whole score: tenor and bass sit on
      // different notes, so a rank taken per note would put both on row 2.
      // A line the melody also sings is a per-verse copy of the words ("Were You There?"),
      // and every pass puts it on row 2. A line that is only ever secondary is a voice of its
      // own ("Far, Far Away on Judea's Plains") and earns its own row.
      const melodyLineIds = new Set();
      for (const el of this._scoreData.meiParsed.querySelectorAll('verse:not([ch-secondary]):not([ch-help-text])')) {
        const lineId = el.getAttribute('ch-lyric-line-id');
        if (lineId) melodyLineIds.add(lineId);
      }
      const secondaryRowByLineId = new Map();
      const secondaryLinesByStaff = new Map();
      for (const el of this._scoreData.meiParsed.querySelectorAll('verse[ch-secondary]:not([ch-help-text])')) {
        const lineId = el.getAttribute('ch-lyric-line-id');
        if (!lineId || melodyLineIds.has(lineId)) continue;
        const staffNumber = el.closest('staff')?.getAttribute('n');
        if (!secondaryLinesByStaff.has(staffNumber)) secondaryLinesByStaff.set(staffNumber, new Set());
        secondaryLinesByStaff.get(staffNumber).add(lineId);
      }
      for (const lineIds of secondaryLinesByStaff.values()) {
        [...lineIds]
          .sort((a, b) => Number.parseInt(a.split('.')[1]) - Number.parseInt(b.split('.')[1]))
          .forEach((lineId, index) => secondaryRowByLineId.set(lineId, 2 + index));
      }

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
          currentIteration = iterationOf(currentSection);
          elements = currentSection.querySelectorAll(selector);
        }
        currentExpandedChordPositions.push(ecpCounter);

        // Add expanded chord positions and remove unneeded lyrics
        const isIntroduction = sectionInfo.type === 'introduction';
        // The per-staff signal needs the two-part guard; the section signal does not
        // (see _hasStackedMelodyLyrics). Same shape as _gatherSyllables.
        const isSingleLine = (isTwoPart ? false
          : expandedChordPositionInfo.chordPositionInfo.isSingleLine)
            || singleLineSectionIds.has(currentSectionOriginalId);
        for (const element of elements) {
          element.setAttribute('ch-expanded-chord-position', ecpCounter);
          const lyricElements = element.querySelectorAll('verse');
          if (lyricElements.length > 0 && !isIntroduction) {
            // A note belonging to no melody part (an accompaniment staff carrying words)
            // falls through to the ordinary per-pass rule
            const isTwoPartMelodyNote = isTwoPart && twoPartMelodyPartIds.includes(partIdOf(element));
            let keptLyricIndex = -1;
            if (isTwoPartMelodyNote) {
              if (soundsInIteration(element, currentIteration)) keptLyricIndex = 0;
            } else {
              keptLyricIndex = this._lyricElementSoundingAt(lyricElements, passNumber, isSingleLine);
            }
            // Secondary lyrics are another voice's words, so matching over the whole stack
            // would drop them. Match within the secondary stack instead, which separates two
            // shapes. A score engraving the same secondary line once per verse ("Were You
            // There?") stacks lines numbered like the verses, so one matches this pass and
            // only that copy is kept. A second voice with its own continuous words ("Far,
            // Far Away on Judea's Plains", lines 5 and 6 against four verses) matches no
            // pass, and every line is kept -- dropping any would break that voice mid-phrase.
            const secondaryElements = Array.from(lyricElements).filter(el =>
              el.hasAttribute('ch-secondary') && !el.hasAttribute('ch-help-text'));
            const secondarySounding = secondaryElements.length > 1
              ? this._lyricElementSoundingAt(secondaryElements, passNumber, false) : -1;
            const keptSecondary = secondaryElements[secondarySounding] ?? null;

            // Help text belongs to the line engraved above it, and shows on the pass that
            // line does ("(fay-lees…)" under verse 1 of "Feliz Cumpleaños")
            let helpTextOwnerIndex = -1;
            for (let i = 0; i < lyricElements.length; i++) {
              const lyricElement = lyricElements[i];
              const isHelpText = lyricElement.hasAttribute('ch-help-text');
              if (!isHelpText) helpTextOwnerIndex = i;
              if (i === keptLyricIndex
                || (isHelpText && keptLyricIndex >= 0 && helpTextOwnerIndex === keptLyricIndex)
                || (!isHelpText && lyricElement.hasAttribute('ch-secondary')
                    && (!keptSecondary || lyricElement === keptSecondary))) {
                // Secondary lyrics never take row 1: a per-verse stack collapses to row 2
                // (only this pass's copy survives), separate voices keep their staff rank
                const isSecondary = !isHelpText && lyricElement.hasAttribute('ch-secondary');
                lyricElement.setAttribute('n', isSecondary
                  ? (secondaryRowByLineId.get(lyricElement.getAttribute('ch-lyric-line-id')) ?? 2)
                  : (i === keptLyricIndex ? 1 : 2));
                lyricElement.setAttribute('ch-section-id', sectionInfo.sectionId);
              } else {
                lyricElement.remove();
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
          const iteration = iterationOf(section);
          for (const element of section.querySelectorAll('note, chord')) {
            // A chord is rested out as a whole, so its own notes aren't handled separately
            if (element.matches('note') && element.parentElement.closest('chord')) continue;
            if (!twoPartMelodyPartIds.includes(partIdOf(element))) continue;
            if (!soundsInIteration(element, iteration)) silentSet.add(element);
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

        // Collapse rests from beamed or tuplet notes into a single rest. Example: "A Child’s Prayer" (Children’s Songbook)
        for (const layer of layers) {
          for (const container of Array.from(layer.querySelectorAll('beam, tuplet')).reverse()) {
            if (!container.parentNode) continue;
            const events = this._layerEvents(container);
            if (events.length === 0 || !events.every(event => event.matches('rest'))) continue;
            const durations = events.map(event => this._wholeNotesOf(event));
            if (durations.some(duration => duration == null)) continue;
            const attributes = this._restAttributesFor(durations.reduce((sum, d) => sum + d, 0));
            if (!attributes) continue;
            const rest = restLike(events[0], ['ch-chord-position', 'ch-expanded-chord-position']);
            rest.setAttribute('dur', attributes.dur);
            if (attributes.dots) rest.setAttribute('dots', attributes.dots);
            container.replaceWith(rest);
          }
        }

        // Drop beams and spanning elements that pointed at a note that was replaced by a rest
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
      // renders as a second row of words under the staff. An expanded score shows one
      // verse per staff per iteration, so every surviving melody verse belongs on line 1 —
      // a genuine secondary line and help text, both already renumbered to 2 above, are the
      // only exceptions.
      for (const lyricElement of this._scoreData.meiParsed.querySelectorAll(
        ':is(note[ch-melody], chord:has([ch-melody])) verse:not([ch-secondary]):not([ch-help-text])')) {
        lyricElement.setAttribute('n', 1);
      }

      // The replay has replaced every section the plist names, so it now describes a score
      // that doesn't exist and Verovio warns per unmatched target. meiParsedComplete keeps it.
      expansion.remove();
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
    // Which lines survive is settled first: a claimed line needs to know whether the line it
    // replaces is still drawn beside it, which the elements after it in document order decide.
    const keptElements = [];
    const drawsReplacedLineAt = new Set();
    for (const element of this._scoreData.meiParsed.querySelectorAll(':is(label, verse)[ch-section-id]')) {
      const sectionIds = element.getAttribute('ch-section-id').split(' ');
      if (!sectionIds.some(sectionId => sectionIdsToKeep.has(sectionId))) {
        element.remove();
        continue;
      }
      const chordPosition = Number.parseInt(element.closest('[ch-chord-position]').getAttribute('ch-chord-position'));
      keptElements.push({ element, chordPosition });
      if (!element.hasAttribute('ch-pass')) drawsReplacedLineAt.add(chordPosition);
    }
    const oldToNewLineNumber = {}
    for (const { element, chordPosition } of keptElements) {
      const lineNumber = element.getAttribute('n');
      if (!Object.hasOwn(oldToNewLineNumber, lineNumber)) {
        oldToNewLineNumber[lineNumber] = Object.keys(oldToNewLineNumber).length + 1;
      }
      // Renumber visible lyric lines (prevents spacing issues, for example if first verse line is n=2 and first chorus line is n=1)
      if (this._scoreData.chordPositions[chordPosition].isSingleLine) {
        // A line an instruction claimed for one pass is sung instead of the line printed over
        // it, not with it. It takes the row below only where that line is still drawn here --
        // left alone otherwise it would sit under an empty row, the shape "Dear to the Heart
        // of the Shepherd" has when only its fourth verse and chorus are shown.
        element.setAttribute('n', element.hasAttribute('ch-pass')
          && drawsReplacedLineAt.has(chordPosition) ? 2 : 1);
      } else if (!element.hasAttribute('ch-chorus')) {
        element.setAttribute('n', oldToNewLineNumber[lineNumber]);
      }
    }
  }

  if (this._currentOptions.hideSectionIds && this._currentOptions.hideSectionIds.length > 0) {
    // An instruction naming a verse has nothing left to say once the section it belongs to is
    // hidden. Removed before the staff rewriting below, which would otherwise move it onto a
    // staff that is staying rather than take it away.
    for (const dir of this._scoreData.meiParsed.querySelectorAll('dir[ch-section-id]')) {
      const sectionIds = dir.getAttribute('ch-section-id').split(' ');
      if (!sectionIds.some(sectionId => sectionIdsToKeep.has(sectionId))) dir.remove();
    }
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
  if (this._scoreData.features.hasChordSets && this._currentOptions.showChordSet) {
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
    // Single traversal of the note's descendants instead of separate querySelector() calls, for efficiency
    let accid, notehead, dot, stem, flag;
    for (const el of note.querySelectorAll('*')) {
      if (!accid && el.matches('g.accid')) accid = el;
      else if (!notehead && el.matches('g.notehead')) notehead = el;
      else if (!dot && el.matches('.dots ellipse')) dot = el;
      else if (!stem && el.matches('.stem path')) stem = el;
      else if (!flag && el.matches('g.flag')) flag = el;
      if (accid && notehead && dot && stem && flag) break;
    }
    accid?.setAttribute('data-related', note.id);
    notehead?.setAttribute('data-related', note.id);
    dot?.setAttribute('data-related', note.id);
    stem?.setAttribute('data-related', note.id);
    flag?.setAttribute('data-related', note.id);
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
  if (this._scoreData.features.hasLyrics) {
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

  // Parse header and footer content. Set as innerHTML on an element rather than parsed as
  // a document: that is the fragment-parsing path every DOM implements the same way, where
  // DOMParser('text/html') on a fragment differs -- linkedom makes the fragment's first
  // element the documentElement and leaves <body> empty, so the content never arrives.
  const contentNodes = (html) => {
    if (!html) return [];
    const holder = document.createElement('div');
    holder.innerHTML = html;
    return Array.from(holder.childNodes);
  };
  const headerNodes = contentNodes(this._currentOptions.headerContent);
  const footerNodes = contentNodes(this._currentOptions.footerContent);

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
  if (!this._scoreData.features.hasRepeatOrJump && verseNumbers.length > 1) {
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
    import('https://cdn.jsdelivr.net/npm/verovio@6.2.0/dist/verovio-toolkit-wasm.min.js'),
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
    'dir@ch-intro-bracket', 'dir@ch-round-marker', 'rend@ch-superscript', 'syl@ch-end-underscore',
    'verse@ch-help-text', 'syl@ch-help-text',
    // Chorister.js advanced attributes (based on parts and sections data)
    'chord@ch-expanded-chord-position', 'note@ch-expanded-chord-position', 'rest@ch-expanded-chord-position',
    'dir@ch-expanded-chord-position', 'harm@ch-expanded-chord-position', 'fermata@ch-expanded-chord-position',
    'note@ch-part-id', 'note@ch-melody',
    'rest@ch-part-id', 'rest@ch-melody',
    'verse@ch-section-id', 'verse@ch-secondary', 'verse@ch-chorus',
    'section@ch-iteration', 'ending@ch-iteration',
    'dir@ch-section-id',
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

ChScore.prototype._tempoNotes = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth' };
ChScore.prototype._tempoNoteChars = {
  '': 'whole', '': 'half', '': 'half', '': 'quarter',
  '': 'quarter', '': 'eighth', '': 'eighth',
};
ChScore.prototype._tempoAugmentationDot = '';

// The note a metronome mark counts in, read off the glyph it's engraved with
ChScore.prototype._glyphTempoNote = function (text) {
  for (const character of text ?? '') {
    const tempoNote = this._tempoNoteChars[character];
    if (tempoNote) {
      return text.includes(this._tempoAugmentationDot) ? `${tempoNote}-dotted` : tempoNote;
    }
  }
  return null;
}

// Set default tempo by averaging upper and lower tempo numbers
ChScore.prototype._normalizeTempos = function (tempoElements) {
  const tempos = [];
  for (const tempoElement of tempoElements) {
    const range = this._patterns.tempoRange.exec(tempoElement.textContent);
    if (!range) continue;
    const tempoLower = Number.parseInt(range[1]);
    const tempoUpper = range[2] ? Number.parseInt(range[2]) : tempoLower;
    const tempoDefault = Math.trunc((tempoLower + tempoUpper) / 2);
    const meiUnit = Number.parseInt(tempoElement.getAttribute('mm.unit'));
    const meiDots = Number.parseInt(tempoElement.getAttribute('mm.dots')) || 0;
    const meiNote = this._tempoNotes[meiUnit] ?? null;
    const glyphNote = this._glyphTempoNote(tempoElement.textContent);

    if (meiNote) {
      // A dot adds half of what came before it, so a double-dotted note counts 1.75 beats
      let dottedMultiplier = 1;
      for (let d = 0; d < meiDots; d++) dottedMultiplier += 0.5 ** (d + 1);
      tempoElement.setAttribute('mm', tempoDefault);
      tempoElement.setAttribute('midi.bpm', Math.trunc(tempoDefault * (4 / meiUnit) * dottedMultiplier));
    }

    tempos.push({
      tempoNote: (meiNote && meiDots === 1) ? `${meiNote}-dotted` : (meiNote ?? glyphNote),
      tempoLower: tempoLower,
      tempoUpper: tempoUpper,
      tempoDefault: tempoDefault,
    });
  }
  return tempos;
}

// Every key the score is written in, as slugs ("e-flat-major"), in printed order
ChScore.prototype._getKeySignatureIds = function (tonality = 'major') {
  const keySignatures = Object.entries(this._getKeySignatures(tonality));
  const keySignatureIds = [];
  for (const element of this._scoreData.meiParsed.querySelectorAll('keySig, scoreDef[key\\.sig], staffDef[key\\.sig]')) {
    const meiSig = element.getAttribute('sig') ?? element.getAttribute('key.sig');
    const meiPname = element.getAttribute('pname') ?? element.getAttribute('key.pname');
    const meiAccid = element.getAttribute('accid') ?? element.getAttribute('key.accid');
    const meiPnameAccid = meiPname ? (meiPname + (['f', 's'].includes(meiAccid) ? meiAccid : '')) : null;
    const entry = keySignatures.find(ks => (ks[1].meiSig === meiSig || ks[1].meiPnameAccid === meiPnameAccid));
    if (entry && entry[0] !== keySignatureIds.at(-1)) keySignatureIds.push(entry[0]);
  }
  return keySignatureIds;
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
    const lyricElement = verseLabel.closest('verse');
    const verseNumber = Number.parseInt(this._cleanMarker(verseLabel.textContent));
    const lineNumber = this._verseLineNumber(lyricElement);
    // Only the first label of a lyric line names the line. A score that lays its
    // stanzas out one after another numbers the same line again further in, and that
    // number is the stanza's, not the line's.
    const lyricLineId = `${lyricElement.closest('staff')?.getAttribute('n') ?? ''}.${lineNumber}`;
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

// Render a chord symbol's text as MEI markup. A pure function of @text and @prefix, so the
// result is cached on the chordInfo and reused on every reload.
ChScore.prototype._chordSymbolMarkup = function (chordInfo) {
  let text = chordInfo.text ?? '';
  text = text.replaceAll(this._patterns.chordFlat, '\u200A<rend glyph.auth="smufl">♭</rend>\u200A');
  text = text.replaceAll(this._patterns.chordSharp, '\u200A<rend glyph.auth="smufl">♯</rend>\u200A');
  text = text.replace(this._patterns.chordDigits, '<rend ch-superscript="">$&</rend>');
  if (chordInfo.prefix) text = chordInfo.prefix + ' ' + text;
  return text;
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
      chordInfo.textMarkup = this._chordSymbolMarkup(chordInfo);
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
  // Parts supplied by the caller win; otherwise build them from a template, deriving one
  // from the engraving when none was given. _derivePartsTemplate always names something --
  // a score with nothing sung is 'I' -- so there is no template-less case to fall back to.
  if (this._scoreData.parts.length === 0) {
    this._scoreData.partsTemplate ||= this._derivePartsTemplate(chordPositionIndex);
    this._scoreData.parts = this._buildPartsFromTemplate(
      this._scoreData.partsTemplate, this._scoreData.staffNumbers,
      this._scoreData.numChordPositions, this._scoreData.features.hasLyrics
    );
  }

  this._scoreData.partsById = {};
  for (const part of this._scoreData.parts) {
    this._scoreData.partsById[part.partId] = part;
  }

  // A 'Two-Part' template's melody lines ('P+P', independent lines on separate staves), in
  // the order they sing: part-N sings iteration N, so the order is load-bearing. More than
  // one means two-part; 'Duet' ('PP', one shared staff) yields one. Only ever holds part-N,
  // so a named-voice score ('SATB') leaves it empty however its melody is voiced — which
  // part carries the tune at a given chord position is _staffPartIds' own local list.
  this._scoreData.twoPartMelodyPartIds = Object.values(this._scoreData.partsById)
    .filter(part => /^part-\d+$/.test(part.partId) && Object.values(part.chordPositionRefs).some(ref => ref.isMelody))
    .map(part => part.partId);
  this._scoreData.features.hasTwoPartMelody = this._scoreData.twoPartMelodyPartIds.length > 1;
}

// Derive a likely parts template heuristically, from what each staff looks like
ChScore.prototype._derivePartsTemplate = function (chordPositionIndex) {
  // Nothing is sung, so every staff is an instrument — answered without reading the
  // engraving, which also lets this be asked of a score that has none
  if (!this._scoreData.features.hasLyrics) return 'I';

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
  const melodyBoundaries = this._getMelodySwitchBoundaries(measureData, wholeStaves, chordPositionIndex);
  const boundaries = this._mergeSegmentBoundaries(
    this._getPartsSegmentBoundaries(measureData, wholeStaves, chordPositionIndex), melodyBoundaries);
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
    // A voice that has handed the tune over is resting, not gone, so a section it sits out
    // is voiced as the song is; only who carries the tune has changed
    const melodyChar = boundaries[b].melodyChar;
    const voicing = melodyChar ? whole : joinPartsTemplate(this._deriveStaffPartsChars(
      measureData, boundaries[b].measureIndex, endMeasure, songFacts));
    // The marker goes last in the section: _buildPartsFromTemplate splits a section on '#'
    // before it splits it on '+', so anything after the marker would be read as part of it
    const template = melodyChar && voicing !== 'I' ? `${voicing}#${melodyChar}` : voicing;
    const previous = segments.at(-1);
    // A section that reads the same as the one before it wasn't a change, and an
    // interlude nobody sings says nothing about how the singing around it is voiced
    if (previous && (template === previous.template || voicing === 'I')) continue;
    segments.push({ chordPosition: boundaries[b].chordPosition, template: template });
  }

  // Nothing changed after all, so answer for the whole song
  if (segments.length < 2) return whole;
  return segments.map(segment => `${segment.chordPosition}:${segment.template}`).join('; ');
}

// Where the tune moves off the voice that has been carrying it, as boundaries naming the
// voice that takes it up ("0:SATB; 21:SATB#A; 32:SATB" — the sopranos rest for three
// measures while the altos sing the line). Read from the music rather than from a
// direction, since nothing is written over the staff to announce it.
ChScore.prototype._getMelodySwitchBoundaries = function (measureData, wholeStaves, chordPositionIndex) {
  // Whose tune it is when nothing says otherwise, read the way _buildPartsFromTemplate
  // reads an unmarked template — the first likely melody character. Not staff.isMelodyStaff,
  // which answers for the staff that leads and so names the lower one on a song the men
  // open ("What Was Witnessed in the Heavens"), leaving the switch invisible from there.
  const melodyStaff = wholeStaves.find(staff => staff.hasLyrics
    && [...(staff.partsChars ?? '')].some(char => 'MSP'.includes(char)))
    ?? wholeStaves.find(staff => staff.isMelodyStaff);
  if (!melodyStaff || !chordPositionIndex) return [];

  // A run this short is a voice crossing or a held note, not the tune changing hands
  const CH_MIN_MELODY_SWITCH_MEASURES = 2;

  // Read once per staff: the fallback below asks about every singing staff, and rebuilding
  // this inside that loop would rescan the whole score for each measure of each staff
  const singingLayers = new Map(wholeStaves.map(staff =>
    [staff.staffNumber, this._singingLayersByMeasure(measureData, staff.staffNumber)]));
  const carriedBy = singingLayers.get(melodyStaff.staffNumber);
  const topLayer = Math.min(...carriedBy.flatMap(measure => measure.layersWithNotes));
  if (!Number.isFinite(topLayer)) return [];

  // Who carries the tune in each measure the voice that usually carries it is written
  // nothing in. A voice merely resting for a beat leaves the words where they were, so this
  // asks about whole measures — the same reading as "a run of measures with no syllables".
  const carriers = carriedBy.map((measure, mi) => {
    if (measure.layersWithNotes.includes(topLayer)) return null;
    const below = measure.layersWithSyllables.filter(layer => layer > topLayer);
    if (below.length > 0) return { staffNumber: melodyStaff.staffNumber, layer: Math.min(...below) };
    // Nothing at all on the melody's staff: the tune has gone to another staff's singers
    const staff = wholeStaves.find(other => other !== melodyStaff && other.hasLyrics
      && singingLayers.get(other.staffNumber)[mi].layersWithSyllables.length > 0);
    return staff ? { staffNumber: staff.staffNumber, layer: null } : null;
  });

  const boundaries = [];
  const sameCarrier = (a, b) => a && b && a.staffNumber === b.staffNumber && a.layer === b.layer;
  for (let mi = 0; mi < carriers.length;) {
    if (!carriers[mi]) { mi++; continue; }
    let end = mi;
    while (end < carriers.length && sameCarrier(carriers[end], carriers[mi])) end++;

    const carrier = carriers[mi];
    const melodyChar = end - mi < CH_MIN_MELODY_SWITCH_MEASURES
      ? null : this._partsCharForCarrier(wholeStaves, topLayer, carrier);
    if (melodyChar) {
      // Where the voice taking the tune over comes in. Its phrase can start as a pickup in
      // the measure before, which the voice handing over is still singing in, so that
      // measure is searched too — from after the last word sung there by the voice above.
      const sungFrom = Math.max(0, mi - 1);
      const handedOverAt = this._sungChordPositions(
        measureData, chordPositionIndex, melodyStaff.staffNumber, topLayer, sungFrom, mi).at(-1) ?? -1;
      const takesOver = this._sungChordPositions(
        measureData, chordPositionIndex, carrier.staffNumber, carrier.layer, sungFrom, end)
        .find(chordPosition => chordPosition > handedOverAt) ?? null;
      const handsBack = end < carriers.length ? this._sungChordPositions(
        measureData, chordPositionIndex, melodyStaff.staffNumber, topLayer, end, carriers.length, 1)[0] ?? null : null;
      if (takesOver !== null) boundaries.push({ measureIndex: mi, chordPosition: takesOver, melodyChar: melodyChar });
      if (handsBack !== null) boundaries.push({ measureIndex: end, chordPosition: handsBack, melodyChar: null });
    }
    mi = end;
  }
  return boundaries;
}

// The chord positions one voice of a staff sings a syllable at, over a range of measures, in
// order. Read from the index rather than from @ch-chord-position, which isn't annotated yet
// when the template is being derived. `limit` stops the scan once a caller wanting only the
// first few has them, since the range can be the rest of the score.
ChScore.prototype._sungChordPositions = function (measureData, chordPositionIndex, staffNumber, layer, startMeasure, endMeasure, limit = Infinity) {
  const inLayer = layer === null ? '' : ` layer[n="${layer}"]`;
  const selector = `staff[n="${staffNumber}"]${inLayer} :is(note, chord):has(syl:not(:empty))`;
  const chordPositions = [];
  for (let mi = startMeasure; mi < endMeasure && chordPositions.length < limit; mi++) {
    for (const element of measureData.measures[mi].querySelectorAll(selector)) {
      // A verse hangs off the chord as readily as off a note, and only notes are indexed
      const note = element.matches('chord') ? element.querySelector('note') : element;
      const chordPosition = chordPositionIndex.byElementId[note?.getAttribute('xml:id')];
      if (chordPosition !== undefined) chordPositions.push(chordPosition);
    }
  }
  return chordPositions;
}

// Which voices of one staff are written notes, and which of them are given syllables, in
// each measure. Read straight from the engraving: @ch-melody is assigned from the template
// this is helping to derive, so it can't be leaned on here.
ChScore.prototype._singingLayersByMeasure = function (measureData, staffNumber) {
  return measureData.measures.map(measure => {
    const layersWithNotes = [];
    const layersWithSyllables = [];
    const staff = measure.querySelector(`staff[n="${staffNumber}"]`);
    for (const layer of staff?.querySelectorAll('layer') ?? []) {
      const layerNumber = Number.parseInt(layer.getAttribute('n'));
      if (Number.isNaN(layerNumber) || !layer.querySelector('note')) continue;
      layersWithNotes.push(layerNumber);
      if (layer.querySelector('syl:not(:empty)')) layersWithSyllables.push(layerNumber);
    }
    return { layersWithNotes, layersWithSyllables };
  });
}

// The template character naming the voice that has taken the tune over — a lower voice of
// the melody's own staff, or the top voice of another staff. Numbered when the same
// character stands for more than one voice in the template ("T2" for Tenor 2 of "TT+BB"),
// which is how _buildPartsFromTemplate's getPartId tells them apart.
ChScore.prototype._partsCharForCarrier = function (wholeStaves, topLayer, carrier) {
  const staff = wholeStaves.find(other => other.staffNumber === carrier.staffNumber);
  const chars = staff?.partsChars ?? '';
  const index = carrier.layer === null ? 0 : carrier.layer - topLayer;
  const char = chars[index];
  if (!char) return null;

  const occurrences = text => [...text].filter(c => c === char).length;
  const allChars = wholeStaves.map(other => other.partsChars ?? '').join('');
  if (occurrences(allChars) < 2) return char;

  const before = chars.slice(0, index)
    + wholeStaves.slice(0, wholeStaves.indexOf(staff)).map(other => other.partsChars ?? '').join('');
  return `${char}${occurrences(before) + 1}`;
}

// Boundaries from the directions and from the tune changing hands, in measure order, each
// carrying whichever melody marker is in force there. A boundary of either kind opens a
// section, so the marker has to be carried across the ones that don't name it.
ChScore.prototype._mergeSegmentBoundaries = function (directionBoundaries, melodyBoundaries) {
  if (melodyBoundaries.length === 0) return directionBoundaries;
  const namesMelody = new Set(melodyBoundaries);

  const boundaries = [];
  let melodyChar = null;
  for (const boundary of [...directionBoundaries, ...melodyBoundaries].sort((a, b) => a.measureIndex - b.measureIndex)) {
    if (namesMelody.has(boundary)) melodyChar = boundary.melodyChar;
    const previous = boundaries.at(-1);
    if (previous && previous.measureIndex === boundary.measureIndex) previous.melodyChar = melodyChar;
    else boundaries.push({ ...boundary, melodyChar: melodyChar });
  }
  return boundaries;
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
      hasLyricElement: false,
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
      if (staff.querySelector('verse')) measure.hasLyricElement = true;
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
      if (firstLyricMeasure === null && measure.hasLyricElement) firstLyricMeasure = mi;
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

// When an element carrying no chord position of its own sounds, as a qstamp. Its onset is
// everything before it in its own layer, which is the only thing that places an invisible
// <space>: it isn't in Verovio's timemap, so nothing else says where it is.
//
// Takes its measure from the element rather than the caller's walk, so it doesn't depend
// on that walk having reached the right one.
ChScore.prototype._qstampOfUnnumbered = function (element) {
  const layer = element?.closest('layer');
  const measureId = element?.closest('measure')?.getAttribute('xml:id');
  const measureInfo = this._scoreData.measuresById?.[measureId];
  if (!layer || measureInfo?.startQ == null) return null;

  let wholeNotes = 0;
  for (const timed of layer.querySelectorAll('note, rest, space, chord')) {
    if (timed === element) break;
    // A chord carries the duration its notes share, so the notes inside don't count again
    if (timed.matches('note') && timed.parentElement?.matches('chord')) continue;
    wholeNotes += this._wholeNotesOf(timed) ?? 0;
  }
  return measureInfo.startQ + (wholeNotes * 4);
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
  for (const lyricElement of melodyLayer.querySelectorAll('verse')) {
    lineNumbers.add(lyricElement.getAttribute('n') ?? '1');
  }
  // Syllable positions, not lyric elements: a note carrying four stanzas is
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

// Add a section id to a verse (or label) element's space-separated @ch-section-id, if not
// already present.
ChScore.prototype._addSectionId = function (element, sectionId) {
  const existing = element.getAttribute('ch-section-id')?.split(' ').filter(Boolean) ?? [];
  if (existing.includes(sectionId)) return;
  element.setAttribute('ch-section-id', [...existing, sectionId].join(' '));
}

ChScore.prototype._normalizeSections = function () {
  // Generate sections based on lyric stanzas
  // Name a stanza's lyric elements with the section that took its words -- the link as the
  // stanza made it, rather than one re-derived from chord positions, which loses any stanza
  // whose range came out degenerate. A verse sung in several sections accumulates the ids.
  this._scoreData.stanzaNamedLyricElements = new Set();
  const nameLyricElements = (section, lyricStanza) => {
    for (const lyricElement of lyricStanza.lyricElements ?? []) {
      this._scoreData.stanzaNamedLyricElements.add(lyricElement);
      this._addSectionId(lyricElement, section.sectionId);
    }
  };

  const generateSectionsFromLyricStanzas = (lyricStanzas, staffNumbers) => {
    const sections = [];
    let sectionCounter = 0;
    for (const lyricStanza of lyricStanzas) {
      const stanzaStaffNumbers = this._stavesPlayingIn(lyricStanza.marker);
      sections.push({
        sectionId: `section-${sectionCounter}`,
        type: lyricStanza.type,
        name: lyricStanza.name,
        marker: lyricStanza.marker,
        placement: lyricStanza.chordPositionRanges.length === 0 ? 'below' : 'inline',
        pauseAfter: false,
        chordPositionRanges: lyricStanza.chordPositionRanges.map(range => ({
          ...range, staffNumbers: stanzaStaffNumbers,
        })),
        annotatedLyrics: lyricStanza.annotatedLyrics,
      });
      nameLyricElements(sections.at(-1), lyricStanza);
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

  this._scoreData.features.hasRepeatOrJump = !!this._scoreData.meiParsed.querySelector('repeatMark, coda, segno, ending, measure:is([left="rptstart"], [left="rptboth"], [right="rptend"], [right="rptboth"]), dir:is([type="coda"], [type="tocoda"], [type="segno"], [type="dalsegno"], [type="dacapo"], [type="fine"])')

  let hasPrebuiltSections = this._scoreData.sections.length > 0;
  // How many verses to play through: the labels where a score numbers its verses, the
  // verses stacked on the notes where it doesn't. Kept out of _getInlineVerseNumbers, whose
  // other readers act on a larger count in ways this shouldn't trigger.
  const labelledVerseNumbers = this._getInlineVerseNumbers(this._scoreData.meiParsed);
  const melodyLyricElements = this._melodyLyricElementIndex();
  const stackedVerseLines = this._stackedVerseLines(melodyLyricElements);
  const verseNumbers = stackedVerseLines.length > labelledVerseNumbers.length
    ? stackedVerseLines : labelledVerseNumbers;
  const hasIntroBrackets = this._getIntroBrackets(this._scoreData.meiParsed).length > 0;
  const [hasComplexSections, hasInitialChorus, expansionIds] = this._updateExpansionElement(
    this._scoreData.meiParsed, verseNumbers.length, hasIntroBrackets,
    this._scoreData.features.hasRepeatOrJump,
    { stackedLines: stackedVerseLines, numChordPositions: this._scoreData.numChordPositions },
    melodyLyricElements);

  let introSection;
  let otherSections = [];
  // Use existing sections
  if (hasPrebuiltSections) {
    introSection = this._scoreData.sections[0].type === 'introduction' ? this._scoreData.sections[0] : null;
    otherSections = introSection ? this._scoreData.sections.slice(1) : this._scoreData.sections;
  // Generate sections based on simple score structure
  } else {
    introSection = this._getIntroSectionFromBrackets(this._scoreData.meiParsed, this._scoreData.staffNumbers);
    if (!hasComplexSections) otherSections = this._generateSectionsFromSimpleScore(verseNumbers, hasInitialChorus, melodyLyricElements);
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
    for (const [sectionIndex, sectionInfo] of otherSections.entries()) {
      for (let cpr = 0; cpr < sectionInfo.chordPositionRanges.length; cpr++) {
        const chordPositionRange = sectionInfo.chordPositionRanges[cpr];
        lyricChordPositionRanges.push({
          start: chordPositionRange.start,
          end: chordPositionRange.end,
          sectionType: sectionInfo.type,
          // Which section, not just what type of one: a section whose ranges read different
          // lyric lines is still one stanza (a chorus with one line reworded for the last
          // verse), so the run must not break where the line changes inside it.
          sectionIndex: sectionIndex,
          lyricLineIds: chordPositionRange.lyricLineIds,
          startsSection: cpr === 0,
        });
      }
    }
  } else if (this._scoreData.features.hasExpansion) {
    const expansion = this._scoreData.meiParsed.querySelector('expansion[plist]');
    const expansionSectionElementIds = expansion.getAttribute('plist').trim().split(' ').map(sid => sid.substring(1));
    // Separate repeated sections (choruses)
    const timesPlayed = new Map();
    for (const id of expansionSectionElementIds) {
      timesPlayed.set(id, (timesPlayed.get(id) ?? 0) + 1);
    }
    // The lines a section carries, as ids in line-number order, where the pass count can't
    // reach them (Spanish "Gethsemane", HHC, engraves its chorus on lines 2 and 3). Memoized
    // and keyed by id: a plist names the same section once per playthrough, and the answer
    // depends only on the section.
    const lineIdsBySectionId = new Map();
    const lineIdsOf = (sectionId, sectionElement) => {
      if (!lineIdsBySectionId.has(sectionId)) {
        const lineNumbers = [...(melodyLyricElements.linesBySection.get(sectionElement) ?? [])]
          .sort((a, b) => a - b);
        const byLineNumber = new Map();
        for (const lyricElement of melodyLyricElements.bySection.get(sectionElement) ?? []) {
          byLineNumber.set(this._verseLineNumber(lyricElement),
            lyricElement.getAttribute('ch-lyric-line-id'));
        }
        lineIdsBySectionId.set(sectionId, this._lineNumbersArePassNumbers(lineNumbers)
          ? [] : lineNumbers.map(lineNumber => byLineNumber.get(lineNumber)));
      }
      return lineIdsBySectionId.get(sectionId);
    };
    const playthroughs = new Map();
    for (const expansionSectionElementId of expansionSectionElementIds) {
      const sectionElement = this._scoreData.meiParsed.querySelector(`[*|id="${expansionSectionElementId}"]`);
      const sectionElementChordPositions = sectionElement.getAttribute('ch-chord-position').trim().split(' ').map(cp => Number.parseInt(cp));
      const playthrough = (playthroughs.get(expansionSectionElementId) ?? 0) + 1;
      playthroughs.set(expansionSectionElementId, playthrough);
      const range = {
        start: sectionElementChordPositions[0],
        end: sectionElementChordPositions.at(-1) + 1,
        startsRepeatedSection: timesPlayed.get(expansionSectionElementId) > 1,
      };
      // One line is sung by everyone, and a section played more often than it has lines has
      // nothing left to name -- both leave the pass count to answer, as before.
      const lineIds = lineIdsOf(expansionSectionElementId, sectionElement);
      if (lineIds.length > 1 && playthrough <= lineIds.length) {
        range.lyricLineIds = [lineIds[playthrough - 1]];
      }
      lyricChordPositionRanges.push(range);
    }
  } else {
    lyricChordPositionRanges.push({ start: 0, end: this._scoreData.numChordPositions });
  }

  // Get annotated lyric stanzas
  this._markSingleLineChordPositions(lyricChordPositionRanges, melodyLyricElements);
  const lyricStanzas = this._extractLyricStanzas(lyricChordPositionRanges, firstLyricExpandedChordPosition, melodyLyricElements);

  // Generate sections based on lyric stanzas, falling back to default sections
  if (otherSections.length === 0) {
    if (lyricStanzas.length > 0) {
      otherSections = generateSectionsFromLyricStanzas(lyricStanzas, this._scoreData.staffNumbers);
      const firstLyricChordPosition = lyricStanzas[0].chordPositionRanges[0].start;
      if (!introSection && firstLyricChordPosition != null && firstLyricChordPosition !== 0) {
        const introChordPositionRanges = [[0, firstLyricChordPosition]];
        // Nobody is singing yet, so every staff plays what is written for it -- a staff that
        // waits for a later verse is engraved as rests here and contributes nothing anyway.
        introSection = this._getIntroSectionFromChordPositions(introChordPositionRanges, this._scoreData.staffNumbers, false);
      }
    } else {
      otherSections = generateDefaultSection(lyricChordPositionRanges, this._scoreData.staffNumbers);
    }
  }

  // A stanza that isn't sung from the staff: a lyric line playback never reached, or
  // a verse printed under the music. It stays 'below' even when the stanza carries real
  // chord positions: the full-score expansion replays what the sections describe and has no
  // section element for this one (see _sectionChordPositionRanges).
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
    const startsHere = (index) => otherSections[index].chordPositionRanges[0]?.start === stanzaStart;
    // A section already carrying words isn't this stanza's. Several stanzas can start at the
    // same chord position, where one lyric line holds two stanzas in a row, so keep looking
    // for a section still empty.
    while (pi < otherSections.length && (!startsHere(pi) || otherSections[pi].annotatedLyrics)) pi += 1;
    const foundByPosition = pi < otherSections.length;
    const section = foundByPosition ? otherSections[pi] : otherSections[ls];

    if (section?.type === lyricStanza.type && !section.annotatedLyrics) {
      section.annotatedLyrics = lyricStanza.annotatedLyrics;
      nameLyricElements(section, lyricStanza);
      if (foundByPosition) si = pi + 1;
    } else if (!section) {
      otherSections.push(newSectionBelow(sectionBelowCounter, lyricStanza));
      nameLyricElements(otherSections.at(-1), lyricStanza);
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
  // For comparing a below verse's own text -- which keeps the page's own line breaks --
  // against the sung chorus's normalized single line ("nearer-my-god-to-thee", where the
  // printed verse already ends with its own copy of the refrain). This is printed text
  // against sung text typeset by different hands, which is exactly what
  // _foldForMatching is for: it is HTML-aware (a block's `html` carries <em>/<strong>,
  // whose tag *names* are letters and would otherwise survive a letters-only fold) and
  // it drops the accents and verse-number digits the two sides spell differently.
  const foldWords = text => this._foldForMatching(text, 'remove');
  const foldedReferenceChorus = foldWords(referenceChorus?.annotatedLyrics);
  const stanzaBlocks = this._stanzaTextBlocks();
  for (const block of stanzaBlocks) {
    const stanzaText = block.html;
    // A verse marker is 1 or 2 digits at the beginning of a line (skipping text in parentheses)
    const [, prefix, marker, lyrics] = /^([\s\S]*?)(?:^|\n)\s*(\d{1,2})\s*[.)]\s*([\s\S]*)$/.exec(stanzaText) ?? [];

    let annotatedLyrics;
    let sectionMarker = null;
    let sectionName;
    if (lyrics) {
      annotatedLyrics = prefix ? `${prefix.trim()}\n${lyrics}` : lyrics;
      sectionMarker = marker;
      sectionName = `Verse ${marker}`;

      // Skip lyric elements that are already sung from the staff
      const alreadyPresent = otherSections.some(section => this._cleanMarker(section.marker) === marker);
      if (alreadyPresent) continue;
    } else {
      // No numeric marker — e.g. "Optional verse:" or a "(Child)"/"(Mother)" speaker
      // label introducing the verse instead of a number. The whole block is the verse;
      // with no marker to dedupe on, compare folded text against what's already sung
      // from the staff instead.
      annotatedLyrics = stanzaText;
      sectionName = 'Verse';
      const foldedStanza = foldWords(stanzaText);
      const alreadyPresent = otherSections.some(section => foldWords(section.annotatedLyrics) === foldedStanza);
      if (alreadyPresent) continue;
    }

    otherSections.push(newSectionBelow(sectionBelowCounter, {
      type: 'verse',
      name: sectionName,
      marker: sectionMarker,
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

  // A song with one stanza has nothing for a chorus to alternate with and nothing for a verse
  // number to tell it apart from; all 116 such English corpus rows are headed "Verse".
  // Counted over printed stanzas as well as sung, so a score singing one verse and printing
  // three keeps its numbering, and never applied to sections a caller stated the types of.
  if (!hasPrebuiltSections && otherSections.length === 1 && otherSections[0].annotatedLyrics) {
    otherSections[0].type = 'verse';
    otherSections[0].name = 'Verse';
    otherSections[0].marker = null;
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

// `verses` describes what has to be sung, for the plist extension below:
// { stackedLines, numChordPositions }. Both are read off the score by the caller, so this
// stays a function of its arguments; left out, the extension simply doesn't apply.
ChScore.prototype._updateExpansionElement = function (meiParsed, numVerses, hasIntroBrackets, hasRepeatOrJump, lyricElements = {}, melodyLyricElements = null) {
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
      // An initial chorus is sung between the verses, so it takes more than one to interleave
      // with; with a single verse the rewrite below only reproduces Verovio's own plist. The
      // replay is a jump there ("D.C. al fine" in "I Believe in Being Honest", 1989 CSB), and
      // leaving it complex is what keeps the plist rather than a one-section simple score.
      if (numVerses > 1 &&
          firstSectionMeasures.at(-1).getAttribute('right') === 'end' &&
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

    // Patch expansion plist IDs to handle "to Coda" better. Example: Teacher, Do You Love Me (Children’s Songbook)
    // TODO: See if this can be fixed in Verovio, which generated the original expansion plist
    const toCodaChordPosition = Number.parseInt(
      meiParsed.querySelector('dir[type="tocoda"]')?.getAttribute('ch-chord-position'));
    if (expansionIds.length > 2 && !Number.isNaN(toCodaChordPosition)) {
      const span = (ref) => {
        const chordPositions = meiParsed.querySelector(`[*|id="${ref.substring(1)}"]`)
          ?.getAttribute('ch-chord-position')?.trim().split(' ') ?? [];
        return [Number.parseInt(chordPositions[0]), Number.parseInt(chordPositions.at(-1))];
      };
      let cut = expansionIds.length - 1;
      if (span(expansionIds[cut])[0] > toCodaChordPosition) {
        while (cut > 1 && span(expansionIds[cut - 1])[0] > toCodaChordPosition) cut -= 1;
        const [markSectionStart, markSectionEnd] = span(expansionIds[cut - 1]);
        if (markSectionStart <= toCodaChordPosition && toCodaChordPosition <= markSectionEnd) {
          expansionIds = [...expansionIds.slice(0, cut - 1), expansionIds.at(-1)];
          expansion.setAttribute('plist', expansionIds.join(' '));
        }
      }
    }
  } else if (
    hasRepeatOrJump
    || measures.at(-1).getAttribute('right') !== 'end' // Last measure isn't end of song
    || meiParsed.querySelectorAll('measure[right="end"]').length > 1 // Multiple end barlines (ex: For All the Saints, 1985 Hymns)
    || !measures[0].querySelector('verse') // No lyrics in first measure (ex: Families Can Be Together Forever, 1985 Hymns)
    || numVerses === 0 // Nothing says how many times to play the sections
  ) {
    hasComplexSections = true;
  }

  // A complex score keeps the playthrough count Verovio read out of the barlines, which is
  // the repeat's, not the verses'. Done last, so the plist the trims above produced is what
  // gets repeated.
  if (hasComplexSections && expansion && expansionIds.length > 0) {
    const extendedIds = this._extendPlistForVerses(meiParsed, expansionIds,
      lyricElements.stackedLines ?? [], lyricElements.numChordPositions ?? 0, melodyLyricElements);
    // The same array back means nothing to repeat, and the plist is left as it was
    if (extendedIds !== expansionIds) {
      expansionIds = extendedIds;
      expansion.setAttribute('plist', expansionIds.join(' '));
    }
  }

  return [hasComplexSections, hasInitialChorus, expansionIds];
}

// Play the music once per verse, where Verovio read fewer playthroughs than there are
// verses. _verseSoundingAt picks the verse by visit count, so a verse whose line number is
// never reached is never sung. Returns the plist unchanged unless that has happened.
ChScore.prototype._extendPlistForVerses = function (meiParsed, expansionIds, stackedLines, numChordPositions, melodyLyricElements = null) {
  if (stackedLines.length < 2 || expansionIds.length === 0) return expansionIds;
  // How many times to play: the highest line number, not how many lines are stacked.
  // _verseSoundingAt sings the line whose number equals the visit count, so a stack numbered
  // [2, 3] still needs three passes -- the first sings nothing.
  const target = stackedLines.at(-1);

  // Memoized: expansionIds commonly repeats the same ref once per playthrough, and each
  // lookup below re-derives a section's stacked lines from it.
  const sectionByRef = new Map();
  const sectionOf = ref => {
    if (!sectionByRef.has(ref)) sectionByRef.set(ref, meiParsed.querySelector(`[*|id="${ref.substring(1)}"]`));
    return sectionByRef.get(ref);
  };
  // The melody's lines only: a section element's own verses include the harmony parts', which
  // reads a single-line chorus as verse-carrying music. The index is keyed on
  // _scoreData.meiParsed, so another document would quietly answer "no lines" for every section.
  if (meiParsed !== this._scoreData.meiParsed) {
    throw new Error('_extendPlistForVerses was given a document other than _scoreData.meiParsed');
  }
  // The melody lyric line numbers a section or ending element carries, sorted. The index is
  // resolved on first use, so a caller that never reaches this doesn't pay to build one.
  let melodyIndex = melodyLyricElements;
  const sungLinesOf = (element) => {
    melodyIndex ??= this._melodyLyricElementIndex();
    const lines = element ? melodyIndex.linesBySection.get(element) : null;
    return new Set(lines ? [...lines].sort((a, b) => a - b) : []);
  };

  // A section played k times gives its chord positions visits 1..k, and a stacked verse is
  // sung on the visit its own line number names -- so it has to come round as many times as
  // its highest line. A one-line section sings it whenever reached, so it isn't asked.
  const timesPlayed = {};
  for (const ref of expansionIds) timesPlayed[ref] = (timesPlayed[ref] ?? 0) + 1;
  const isEnding = ref => sectionOf(ref)?.localName === 'ending';
  const stackedLinesByRef = new Map();
  const stackedLinesOf = (ref) => {
    if (!stackedLinesByRef.has(ref)) {
      const lines = sungLinesOf(sectionOf(ref));
      stackedLinesByRef.set(ref, stackedLines.filter(line => lines.has(line)));
    }
    return stackedLinesByRef.get(ref);
  };
  // Only the body of the verse is asked: an ending is a few notes closing one pass, and a
  // shared "1, 2" ending carries two lines without being played twice
  const carriesVerses = ref => !isEnding(ref) && stackedLinesOf(ref).length > 1;
  // How often a section must come round to sing all its lines: the highest line where the
  // numbers are pass numbers, and how many there are where they aren't, since those are named
  // per playthrough instead (see _normalizeSections). Asking for the highest either way plays
  // the Italian "Gethsemane" chorus a third time for a line already sung.
  const passesNeeded = (ref) => {
    const lines = stackedLinesOf(ref);
    return this._lineNumbersArePassNumbers(lines) ? lines.at(-1) : lines.length;
  };
  const isUnderPlayed = ref => carriesVerses(ref) && passesNeeded(ref) > timesPlayed[ref];
  if (!expansionIds.some(isUnderPlayed)) return expansionIds;

  // Refuse where visit-counted passes can't describe the answer: a plist covering only part
  // of the score, or an ending Verovio left out of it.
  const coveredChordPositions = new Set();
  for (const ref of new Set(expansionIds)) {
    for (const cp of (sectionOf(ref)?.getAttribute('ch-chord-position') ?? '').trim().split(' ')) {
      if (cp) coveredChordPositions.add(cp);
    }
  }
  if (coveredChordPositions.size < numChordPositions) return expansionIds;
  const endingElements = [...meiParsed.querySelectorAll('ending')];
  const playedIds = new Set(expansionIds.map(ref => ref.substring(1)));
  if (endingElements.some(ending => !playedIds.has(ending.getAttribute('xml:id')))) return expansionIds;

  // Split into the run of sections each verse is sung over. A rendition starts wherever
  // the music carrying the stacked verses comes round again.
  const firstBody = expansionIds.findIndex(carriesVerses);
  if (firstBody === -1) return expansionIds;
  const prefix = expansionIds.slice(0, firstBody);
  const renditions = [];
  for (const ref of expansionIds.slice(firstBody)) {
    if (carriesVerses(ref) || renditions.length === 0) renditions.push([]);
    renditions.at(-1).push(ref);
  }
  if (renditions.length >= target) return expansionIds;

  // One rendition means the repeats inside it are the music's own, not one per verse. Play it
  // through once per verse, endings and all -- substituting an ending by verse would break
  // the repeat it actually closes.
  if (renditions.length === 1) {
    const rendition = renditions[0];
    const repeated = [...prefix];
    for (let pass = 0; pass < target; pass++) repeated.push(...rendition);
    return repeated;
  }

  // Which ending closes each verse, computed once rather than re-scanning every ending per
  // pass. Read from the lyric lines the ending carries rather than @n, which Verovio spells
  // "1", "1, 2" and nothing at all for the same construct.
  const refForPass = new Map();
  for (const ending of endingElements) {
    const lines = sungLinesOf(ending);
    const ref = `#${ending.getAttribute('xml:id')}`;
    const passNumbers = lines.size > 0 ? lines : [this._markerNumber(ending.getAttribute('n'))];
    for (const passNumber of passNumbers) {
      if (!refForPass.has(passNumber)) refForPass.set(passNumber, ref);
    }
  }
  const extended = [...prefix];
  for (let passNumber = 1; passNumber < target; passNumber++) {
    const rendition = renditions[Math.min(passNumber - 1, renditions.length - 2)];
    for (const ref of rendition) {
      extended.push(isEnding(ref) ? (refForPass.get(passNumber) ?? ref) : ref);
    }
  }
  extended.push(...renditions.at(-1));
  return extended;
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
  // A bracket is printed on the staff the introduction is played from, so it plays on that
  // staff and the ones below it -- one on the piano's top staff means the voices above sit it
  // out. Each bracket answers for its own range: the two in "True to the Faith" sit on
  // different staves, the first over the whole texture and the second over the piano alone.
  const introChordPositionRanges = this._getIntroBrackets(meiParsed).map(introBracket => {
    const staff = Number.parseInt(introBracket.start.element.getAttribute('staff'));
    const played = staffNumbers.filter(staffNumber => staffNumber >= staff);
    return [introBracket.start.chordPosition, introBracket.end.chordPosition,
      played.length > 0 ? played : staffNumbers];
  });
  return this._getIntroSectionFromChordPositions(introChordPositionRanges, staffNumbers, true);
}

ChScore.prototype._getIntroSectionFromChordPositions = function (introChordPositionRanges, staffNumbers, pauseAfter) {
  let introSection;
  const chordPositionRanges = [];
  for (const [start, end, rangeStaffNumbers] of introChordPositionRanges) {
    chordPositionRanges.push({
      start: start,
      end: end,
      staffNumbers: rangeStaffNumbers ?? staffNumbers,
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

ChScore.prototype._generateSectionsFromSimpleScore = function (verseNumbers, hasInitialChorus, melodyLyricElements = this._melodyLyricElementIndex()) {
  const meiParsed = this._scoreData.meiParsed;
  const sections = [];

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
    const lyricElementsByCp = {};
    // Through the shared index, so chorus detection counts the same verses extraction does
    for (const chordPosition of melodyLyricElements.byChordPosition.keys()) {
      const lyricElements = this._stackedLyricElementsAt(chordPosition, melodyLyricElements);
      lineNumbersByCp[chordPosition] = lyricElements.map(lyricElement => this._verseLineNumber(lyricElement));
      lyricElementsByCp[chordPosition] = lyricElements;
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
      const syl = lyricElementsByCp[chordPosition]?.[0]?.querySelector('syl:not(:empty)');
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
  for (const lyric of meiParsed.querySelectorAll('verse[ch-secondary]:not([ch-help-text])')) {
    const lineNumber = this._verseLineNumber(lyric);
    if (chorusChordPositions.has(Number.parseInt(lyric.closest('note, chord').getAttribute('ch-chord-position')))) {
      chorusLineNumbers.add(lineNumber);
    } else if (!verseNumbers.includes(lineNumber)) {
      additionalSecondaryLyricLineNumbers.add(lineNumber);
    }
  }

  // Where an instruction claimed a lyric line for one pass ("(4th verse)"), so the section
  // that pass sings can name the line itself rather than leaving it to be found again
  const claims = new Map();
  for (const lyricElement of meiParsed.querySelectorAll('verse[ch-pass]')) {
    const pass = Number.parseInt(lyricElement.getAttribute('ch-pass'));
    const chordPosition = Number.parseInt(
      lyricElement.closest('note, chord')?.getAttribute('ch-chord-position'));
    if (Number.isNaN(pass) || Number.isNaN(chordPosition)) continue;
    const claim = claims.get(pass)
      ?? { lineNumber: this._verseLineNumber(lyricElement), start: chordPosition, end: chordPosition + 1 };
    claim.start = Math.min(claim.start, chordPosition);
    claim.end = Math.max(claim.end, chordPosition + 1);
    claims.set(pass, claim);
  }

  // One lyric line can lay out several printed verses, each opened by its own marker ("1. ...
  // 2. ..." in "Whenever I Think about Pioneers"), and each is a verse section. Only a label
  // that opens a verse nowhere else cuts the line: a line's own opening label names the line
  // ("All Things Bright and Beautiful"), and a repeated one is a pickup labelled again where
  // the verse really starts ("Were You There?").
  const labelled = [];
  const timesMarked = new Map();
  for (const lyricElement of meiParsed.querySelectorAll('verse:has(label)')) {
    const lineNumber = this._verseLineNumber(lyricElement);
    const marker = this._verseLabelNumber(lyricElement);
    const chordPosition = Number.parseInt(
      lyricElement.closest('note, chord')?.getAttribute('ch-chord-position'));
    if (marker == null || Number.isNaN(lineNumber) || Number.isNaN(chordPosition)) continue;
    labelled.push({ lineNumber: lineNumber, chordPosition: chordPosition, marker: marker });
    timesMarked.set(marker, (timesMarked.get(marker) ?? 0) + 1);
  }
  // Sorted here, so a line's first marker is the one that opens it
  const markersByLine = this._groupBy(labelled, marker => marker.lineNumber);
  for (const markers of markersByLine.values()) markers.sort((a, b) => a.chordPosition - b.chordPosition);

  // The lyric lines carried by a staff that only joins in at a later verse. Membership is all
  // that is needed: which verse it joins in on is answered by _stavesPlayingIn, which keeps
  // the staff itself out of every range before then.
  const lateEntryLineNumbers = new Set();
  for (const staffNumber of this._scoreData.staffEntersAtVerse?.keys() ?? []) {
    for (const lyricElement of meiParsed.querySelectorAll(`staff[n="${staffNumber}"] verse`)) {
      const lineNumber = this._verseLineNumber(lyricElement);
      if (!Number.isNaN(lineNumber)) lateEntryLineNumbers.add(lineNumber);
    }
  }

  // The staff/line pairings the score actually writes, since the ids below pair every singing
  // staff with every line number and a score rarely writes all of those. Help text is not one
  // of them: it is never sung. Derived rather than read off @ch-lyric-line-id, which says the
  // same thing, so this works on a document the annotation walk has not been over.
  const engravedLyricLineIds = new Set();
  for (const lyricElement of meiParsed.querySelectorAll('staff verse:not([ch-help-text])')) {
    const staffNumber = lyricElement.closest('staff')?.getAttribute('n');
    const lineNumber = this._verseLineNumber(lyricElement);
    if (staffNumber && !Number.isNaN(lineNumber)) {
      engravedLyricLineIds.add(`${staffNumber}.${lineNumber}`);
    }
  }

  let verseCounter = 0;
  for (const verseNumber of verseNumbers) {
    // Get chord position ranges
    const stavesPlaying = this._stavesPlayingIn(verseNumber);
    const verseLineNumbers = new Set([verseNumber]);
    // Lines that appear under the numbered verses are assumed to correspond to verse 1
    // (example: secondary lyrics in "Joy to the World", 1985 Hymns) -- unless an instruction
    // says which verse the staff carrying them joins in on, which _stavesPlayingIn answers.
    for (const num of additionalSecondaryLyricLineNumbers) {
      if (verseNumber === 1 || lateEntryLineNumbers.has(num)) verseLineNumbers.add(num);
    }
    const rangeEntries = [];
    const claim = claims.get(verseNumber);
    const lineMarkers = markersByLine.get(verseNumber) ?? [];
    const lineCuts = lineMarkers.slice(1).filter(marker => timesMarked.get(marker.marker) === 1);
    // Before the first cut, the verse is the one the line's own opening label names -- which
    // is not always the line number ("Whenever I Think about Pioneers" opens line 2 with "3.")
    const opensWith = lineMarkers[0]?.marker ?? verseNumber;
    const markerAt = (chordPosition) => lineCuts
      .filter(cut => cut.chordPosition <= chordPosition).at(-1)?.marker ?? opensWith;
    // The ids naming a set of lyric lines: every pairing of a staff playing in this verse
    // with one of those lines, kept only where the score engraves that pairing.
    const lyricLineIdsFor = (lineNumbers) => {
      const ids = [];
      for (const staffNumber of stavesPlaying) {
        for (const lineNumber of lineNumbers) {
          if (engravedLyricLineIds.has(`${staffNumber}.${lineNumber}`)) {
            ids.push(`${staffNumber}.${lineNumber}`);
          }
        }
      }
      return ids;
    };
    const addRange = (start, end, ids) => {
      // A chorus is shared by every verse, so a verse marker never cuts one
      const cuts = chorusChordPositions.has(start) ? []
        : lineCuts.map(cut => cut.chordPosition).filter(cp => cp > start && cp < end);
      let from = start;
      for (const to of [...cuts, end]) {
        rangeEntries.push({
          range: { start: from, end: to, staffNumbers: stavesPlaying, lyricLineIds: ids },
          marker: markerAt(from),
        });
        from = to;
      }
    };
    let nextChordPosition = 0;
    let nextChorusCpRangeIndex = 0;
    while (nextChordPosition < this._scoreData.numChordPositions) {
      const cpStart = nextChordPosition;
      let cpEnd = this._scoreData.numChordPositions;
      let lyricLinesIds = lyricLineIdsFor(verseLineNumbers);
      if (nextChorusCpRangeIndex < chorusCpRanges.length) {
        const nextChorusCpRange = chorusCpRanges[nextChorusCpRangeIndex];
        if (nextChorusCpRange[0] === nextChordPosition) {
          cpEnd = nextChorusCpRange.at(-1) + 1;
          lyricLinesIds = lyricLineIdsFor(chorusLineNumbers);
          nextChorusCpRangeIndex++;
        } else {
          cpEnd = nextChorusCpRange[0];
        }
      }
      // A line claimed for this pass is named by the stretch it covers, so the section says
      // what is sung there rather than depending on the claim being read again
      // Where the claim covers the whole range, that leaves one range naming the claimed line
      if (claim && claim.start >= cpStart && claim.end <= cpEnd) {
        const claimedIds = lyricLineIdsFor([claim.lineNumber]);
        if (claim.start > cpStart) addRange(cpStart, claim.start, lyricLinesIds);
        addRange(claim.start, claim.end, claimedIds);
        if (claim.end < cpEnd) addRange(claim.end, cpEnd, lyricLinesIds);
      } else {
        addRange(cpStart, cpEnd, lyricLinesIds);
      }
      nextChordPosition = cpEnd;
    }

    // Add extra chorus for songs with initial chorus
    if (hasInitialChorus && verseNumber === verseNumbers.at(-1) && rangeEntries.length > 1) {
      rangeEntries.push(rangeEntries.at(-2));
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

    // Ranges that run on from each other and are the same kind of music are one section: a
    // chorus whose middle stretch reads a different lyric line is still one chorus. Only
    // contiguous ones, so the repeated range an initial chorus adds stays a section of its own.
    const groups = [];
    for (const { range: chordPositionRange, marker } of rangeEntries) {
      const isChorus = chorusChordPositions.has(chordPositionRange.start);
      const group = groups.at(-1);
      if (group && group.isChorus === isChorus && group.marker === marker
        && group.ranges.at(-1).end === chordPositionRange.start) {
        group.ranges.push(chordPositionRange);
      } else {
        groups.push({ isChorus: isChorus, marker: marker, ranges: [chordPositionRange] });
      }
    }

    for (const [index, group] of groups.entries()) {
      const isLast = index === groups.length - 1;
      if (group.isChorus) {
        sections.push({
          sectionId: `chorus-${verseCounter}`,
          type: 'chorus',
          name: 'Chorus',
          marker: null,
          placement: 'inline',
          pauseAfter: isLast ? pauseAfter : false,
          chordPositionRanges: group.ranges,
          annotatedLyrics: null,
        });
      } else {
        verseCounter++;
        sections.push({
          sectionId: `verse-${verseCounter}`,
          type: 'verse',
          name: `Verse ${group.marker}`,
          marker: group.marker,
          placement: 'inline',
          pauseAfter: isLast ? pauseAfter : false,
          chordPositionRanges: group.ranges,
          annotatedLyrics: null,
        });
      }
    }
  }

  return sections;
}

// TODO: Some of the logic in _markSingleLineChordPositions overlaps chorus detection in _generateSectionsFromSimpleScore – maybe they can be unified.
ChScore.prototype._markSingleLineChordPositions = function (lyricChordPositionRanges, melodyLyricElements = this._melodyLyricElementIndex(), maxAllowedGap = 3) {
  const lyricLinesByStaffAndCp = {};
  // Through the shared melody lyric index, which already grouped the elements by chord
  // position. Reading only verses on the melody note would miss a lower voice's words
  // entirely, and the padding below would absorb those positions as though nothing were sung.
  for (const chordPosition of melodyLyricElements.byChordPosition.keys()) {
    for (const lyric of this._stackedLyricElementsAt(chordPosition, melodyLyricElements)) {
      if (!lyric.querySelector('syl:not(:empty)')) continue;
      const [staffNumber, lineNumber] = lyric.getAttribute('ch-lyric-line-id').split('.').map(i => Number.parseInt(i));
      if (!Object.hasOwn(lyricLinesByStaffAndCp, staffNumber)) lyricLinesByStaffAndCp[staffNumber] = {};
      if (!Object.hasOwn(lyricLinesByStaffAndCp[staffNumber], chordPosition)) lyricLinesByStaffAndCp[staffNumber][chordPosition] = new Set();
      lyricLinesByStaffAndCp[staffNumber][chordPosition].add(lineNumber);
    }
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
// Where a lower voice carries the tune ('SATB#A'), its words stay engraved on the voice
// above, so a verse there counts as the melody's. Above and same staff both matter: lyrics
// sit on a staff's top voice, so words *below* the melody are a second voice singing its
// own ("may rest, may rest" in "Come unto Jesus").
// Help text is left out; @ch-secondary is not, since a verse engraved above a lower voice
// carrying the tune is marked secondary and is still the melody's words.

// The melody's verses, in one pass: the flat list, the same verses by chord position, and the
// lyric line numbers each section carries. Memoized on the document. Ask this rather than a
// section's own verses, which include the harmony parts' and misread a single-line chorus.
ChScore.prototype._melodyLyricElementIndex = function () {
  const meiParsed = this._scoreData.meiParsed;
  const melodyLayers = this._melodyLayerByStaffAndChordPosition();
  const lyricElements = [];
  const byChordPosition = new Map();
  const bySection = new Map();
  const linesBySection = new Map();
  // A verse with nothing sung in it is the stub closing a melisma underscore, which is
  // there to be drawn, not sung. Left in, it reads as a lyric line of its own and cuts
  // the stanza at the note it sits on ("For Health and Strength", "Faith").
  for (const lyricElement of meiParsed.querySelectorAll(
    ':is(note, chord) verse:not([ch-help-text]):has(syl:not(:empty):not([ch-help-text]))')) {
    // One walk up for the note or chord the verse hangs off and the section holding it,
    // rather than a closest() call for each. The holder is always the nearer of the two.
    let holder = null;
    let section = null;
    for (let ancestor = lyricElement.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const name = ancestor.localName;
      if (!holder && (name === 'note' || name === 'chord')) holder = ancestor;
      else if (name === 'section' || name === 'ending') { section = ancestor; break; }
    }
    if (!holder) continue;
    if (!this._carriesMelody(holder) && !this._isAboveMelody(holder, melodyLayers)) continue;

    lyricElements.push(lyricElement);
    const chordPosition = Number.parseInt(holder.getAttribute('ch-chord-position'));
    if (!Number.isNaN(chordPosition)) {
      if (!byChordPosition.has(chordPosition)) byChordPosition.set(chordPosition, []);
      byChordPosition.get(chordPosition).push(lyricElement);
    }
    if (section) {
      if (!bySection.has(section)) bySection.set(section, []);
      bySection.get(section).push(lyricElement);
      const lineNumber = this._verseLineNumber(lyricElement);
      if (!Number.isNaN(lineNumber)) {
        if (!linesBySection.has(section)) linesBySection.set(section, new Set());
        linesBySection.get(section).add(lineNumber);
      }
    }
  }

  return { lyricElements, byChordPosition, bySection, linesBySection };
}

// Whether a note or chord is the one carrying the tune. Only a chord can hold the melody in
// a descendant; a bare note answers for itself.
ChScore.prototype._carriesMelody = function (element) {
  return element.matches('[ch-melody]')
    || (element.localName === 'chord' && element.querySelector('[ch-melody]') !== null);
}

// Whether a note or chord sits above the voice carrying the tune, on that voice's own staff.
ChScore.prototype._isAboveMelody = function (element, melodyLayers, staffNumber = this._staffNumberOf(element)) {
  const chordPosition = Number.parseInt(element.getAttribute('ch-chord-position'));
  const melodyLayer = melodyLayers.get(staffNumber)?.get(chordPosition);
  const layer = this._layerNumberOf(element);
  return layer !== null && melodyLayer !== undefined && layer < melodyLayer;
}

// Which staff an element is written on, as a number (NaN when it is on none, which compares
// false against every staff number rather than throwing).
ChScore.prototype._staffNumberOf = function (element) {
  return Number.parseInt(element?.closest('staff')?.getAttribute('n'));
}

// Which voice carries the tune on each staff, at every chord position it is being sung
// through — including the ones it doesn't articulate on, since a voice above it can be
// written more notes than it has ("In Deseret's" over a resting Tenor 2 in "High on the
// Mountain Top"). Across such a gap the answer is the lowest voice the tune is written in
// on either side of it, so a phrase's pickup is read the same way as the phrase.
ChScore.prototype._melodyLayerByStaffAndChordPosition = function () {
  const sungByStaff = new Map();
  for (const note of this._scoreData.meiParsed.querySelectorAll('note[ch-melody]')) {
    const staffNumber = this._staffNumberOf(note);
    const chordPosition = Number.parseInt(note.getAttribute('ch-chord-position'));
    const layer = this._layerNumberOf(note);
    if (Number.isNaN(staffNumber) || Number.isNaN(chordPosition) || layer === null) continue;
    if (!sungByStaff.has(staffNumber)) sungByStaff.set(staffNumber, new Map());
    const sung = sungByStaff.get(staffNumber);
    sung.set(chordPosition, Math.max(sung.get(chordPosition) ?? layer, layer));
  }

  const melodyLayers = new Map();
  const lastChordPosition = this._scoreData.numChordPositions - 1;
  for (const [staffNumber, sung] of sungByStaff) {
    const filled = new Map();
    const articulated = [...sung.keys()].sort((a, b) => a - b);
    for (let a = 0; a < articulated.length; a++) {
      const from = articulated[a];
      const next = articulated[a + 1];
      const gapLayer = Math.max(sung.get(from), sung.get(next) ?? sung.get(from));
      filled.set(from, sung.get(from));
      for (let cp = from + 1; cp < (next ?? lastChordPosition + 1); cp++) filled.set(cp, gapLayer);
    }
    melodyLayers.set(staffNumber, filled);
  }
  return melodyLayers;
}

// Which voice of its staff an element is written in. Odd layers are stems up (the upper
// voice), so a smaller number is the voice above — the same convention the parse reads
// stem direction from.
ChScore.prototype._layerNumberOf = function (element) {
  const layer = Number.parseInt(element.closest('layer')?.getAttribute('n'));
  return Number.isNaN(layer) ? null : layer;
}

// The verses stacked on the same notes, as their verse numbers -- how many times the music
// has to be played for all of them to be sung. Only lines sharing a note with another count:
// a refrain printed on its own line is sung on every pass, not once per verse.
ChScore.prototype._stackedVerseLines = function (melodyLyricElements = this._melodyLyricElementIndex()) {
  const stacked = new Set();
  for (const lyricElements of melodyLyricElements.byChordPosition.values()) {
    const sung = lyricElements.filter(lyricElement => lyricElement.querySelector('syl:not(:empty):not([ch-help-text])'));
    if (sung.length < 2) continue;
    for (const lyricElement of sung) {
      const lineNumber = this._verseLineNumber(lyricElement);
      if (!Number.isNaN(lineNumber)) stacked.add(lineNumber);
    }
  }
  return [...stacked].sort((a, b) => a - b);
}

// Whether more than one of the melody's lyric elements is engraved at the same moment.
// _verseSoundingAt takes the first line outright when a scope carries only one, instead of
// matching by pass, and this is the signal behind that.
//
// Counted per chord position, which spans staves. Anything scoped to one staff or one note
// reads "single line" throughout a 'Two-Part' score, where each part's own verse sits alone
// on its own staff -- so _scoreData.chordPositions[].isSingleLine (per staff, built for
// divisi like Soprano 1/2) needs a hasTwoPartMelody guard wherever it is used, and this
// signal does not.
ChScore.prototype._hasStackedMelodyLyrics = function (chordPosition, melodyLyricElements) {
  return this._stackedLyricElementsAt(chordPosition, melodyLyricElements).length > 1;
}

// The lyric lines the music carries at one chord position. A line an instruction claimed for
// a single pass ("(4th verse)") is not one of them: only it or the line it is printed over is
// ever sung there, so the music is single-line per pass. Kept only where a line remains --
// where the claimed line sings alone, it is still what the music carries.
ChScore.prototype._stackedLyricElementsAt = function (chordPosition, melodyLyricElements) {
  const lyricElements = melodyLyricElements.byChordPosition.get(chordPosition) ?? [];
  // Called per chord position per range, and almost no score claims a line for one pass, so
  // the common case answers without building a second array
  if (!lyricElements.some(lyricElement => lyricElement.hasAttribute('ch-pass'))) return lyricElements;
  const stacking = lyricElements.filter(lyricElement => !lyricElement.hasAttribute('ch-pass'));
  return stacking.length > 0 ? stacking : lyricElements;
}

// Whether a section's lyric line numbers can double as its pass numbers, which is the model
// _lyricElementSoundingAt works in: it matches line N against visit N, and visits start at 1.
// Lines starting above 1 need the line each playthrough reads named for them instead.
ChScore.prototype._lineNumbersArePassNumbers = function (lineNumbers) {
  return lineNumbers[0] === 1;
}

// Which lyric element engraved at one chord position is sounding on this pass, as an index into the list (-1 for none). Used for score expansion and lyric extraction.
// The index is into `verseElements` as passed, and the two callers filter it differently:
// extraction passes the melody's lyric elements at the chord position, minus skipped
// verses; expansion passes every <verse> on one note or chord, since it removes them from
// the DOM. So compare the two by element, never by index.
// isSingleLine is caller-supplied. Both measure it the same way (see
// _hasStackedMelodyLyrics), but extraction scopes it to a range and expansion to a section.
ChScore.prototype._lyricElementSoundingAt = function (lyricElements, passNumber, isSingleLine) {
  const engraved = Array.from(lyricElements);
  // Skip lyric elements with empty syllables (melisma underscore end), and ones that are help
  // text rather than words to sing
  const sungIndices = engraved
    .map((lyricElement, index) => index)
    .filter(index => engraved[index].matches(
      'verse:not([ch-help-text]):has(syl:not(:empty):not([ch-help-text]))'));
  const sungElements = sungIndices.map(index => engraved[index]);
  if (sungElements.length === 0) return -1;
  const soundingIndex = (index) => (index >= 0 && index < sungElements.length ? sungIndices[index] : -1);

  // A pickup engraved inside a repeat carries only the lyric elements it leads into, each
  // labelled ("2.", "3."), so @n doesn't line up with the pass count — take them in
  // engraved order. One labelled verse counts too, but only when its label names a verse
  // other than its own lyric line. Checked before the single-line rule, which would
  // otherwise always win and return 0.
  const allLabelled = sungElements.every(ve => ve.querySelector('label'));
  const namesAnotherVerse = () => this._markerNumber(sungElements[0].querySelector('label')?.textContent)
    !== this._verseLineNumber(sungElements[0]);
  if (allLabelled && (sungElements.length > 1 || namesAnotherVerse())) {
    // Out of range on later passes, which is correct: the pickup is sung once per verse
    return soundingIndex(passNumber - 1);
  }

  if (isSingleLine) return soundingIndex(0);
  return soundingIndex(sungElements.findIndex(ve => this._verseLineNumber(ve) === passNumber));
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
ChScore.prototype._extractLyricStanzas = function (lyricChordPositionRanges, ecpStart, melodyLyricElements = this._melodyLyricElementIndex()) {
  const syllables = this._gatherSyllables(lyricChordPositionRanges, ecpStart, melodyLyricElements);
  return this._scoreData.lyricsText
    ? this._alignSyllablesToLyrics(this._scoreData.lyricsText, syllables, this._scoreData.staffNumbers)
    : this._getLyricsFromSyllables(syllables);
}

// Walk the chord positions in sung order and pull out the syllable engraved at each,
// as a flat list — one entry per syllable, carrying where it's sung and what line it's on
ChScore.prototype._gatherSyllables = function (lyricChordPositionRanges, ecpStart, melodyLyricElements = this._melodyLyricElementIndex()) {
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
  const melodyLyricElementList = melodyLyricElements.lyricElements;
  const melodyLyricElementsByChordPosition = melodyLyricElements.byChordPosition;
  const roundMarkersByChordPosition = this._getRoundMarkersByChordPosition();
  let pendingRoundMarker = null;

  // In a 'Two-Part' score each part's verse is sung on its own pass, read by plain @n
  // matching in _verseSoundingAt; the later combined pass just repeats them, so it yields no
  // stanza and a trailing tag falls out as its own section. A labelled pickup into that
  // combined pass ("(3.)" in "A Child’s Prayer", 1989 CSB) would trip _verseSoundingAt's
  // "names another verse" rule and emit a spurious one-word verse, so pickups labelled
  // beyond the part count are dropped — whole words, since tail syllables carry no label of
  // their own and so are tracked per lyric line until the next word starts.
  const excludedLyricElements = new Set();
  if (this._scoreData.features.hasTwoPartMelody) {
    const partCount = this._scoreData.twoPartMelodyPartIds.length;
    const skipStateByLine = {};
    for (const lyricElement of melodyLyricElementList) {
      const lineId = lyricElement.getAttribute('ch-lyric-line-id');
      if (this._startsWord(lyricElement)) {
        const labelNumber = this._verseLabelNumber(lyricElement);
        skipStateByLine[lineId] = labelNumber != null && labelNumber > partCount;
      }
      if (skipStateByLine[lineId]) excludedLyricElements.add(lyricElement);
    }
  }

  // Single-line when no chord position in the range carries stacked melody lyrics;
  // computed up front because the walk below is flat.
  for (const range of lyricChordPositionRanges) {
    range.hasSingleLine = true;
    for (let cp = range.start; cp < range.end; cp++) {
      if (this._hasStackedMelodyLyrics(cp, melodyLyricElements)) range.hasSingleLine = false;
    }
  }
  let isFirstSyllableOfSection = false;
  // Carried alongside rather than folded into the flag above: this one must not break a
  // run before phrase detection has read it (see _splitRunsAtRepeatedSections).
  let isFirstSyllableOfRepeatedSection = false;

  // Test cases:
  // "Gethsemane" (Hymns—For Home and Church), "This Is the Christ" (Hymns—For Home and Church), "Beautiful Savior" (1989 CSB) – complex sections
  // Japanese "When the Savior Comes Again" (Hymns—For Home and Church) – ruby text
  // "Have I Done Any Good?" (1985 Hymns) – simple verses and chorus, but verses have chord positions with only one lyric syllable. When there's only one lyric syllable, it should be extracted only in the correct verse.
  for (const { range, chordPosition: cp, expandedChordPosition: ecpCounter, passNumber }
    of this._walkSungChordPositions(lyricChordPositionRanges, { ecpStart })) {
    if (cp === range.start) {
      isFirstSyllableOfSection = range.startsSection ?? false;
      isFirstSyllableOfRepeatedSection = range.startsRepeatedSection ?? false;
    }
    // The per-staff signal needs the two-part guard; range.hasSingleLine does not
    // (see _hasStackedMelodyLyrics)
    const chordPositionIsSingleLine = this._scoreData.features.hasTwoPartMelody
      ? false : this._scoreData.chordPositions[cp].isSingleLine;
    let lyricElements = melodyLyricElementsByChordPosition.get(cp) ?? [];
    if (excludedLyricElements.size > 0) lyricElements = lyricElements.filter(ve => !excludedLyricElements.has(ve));
    const lyricIndex = this._lyricElementSoundingAt(lyricElements, passNumber,
      chordPositionIsSingleLine || range.hasSingleLine);
    let lyricElement = lyricElements[lyricIndex]; // undefined when -1
    // A range names the lyric lines it reads, so where the pass count picked a line the range
    // doesn't name, the section's answer stands. Corrects the choice rather than narrowing
    // what is chosen from: the pickup rule above indexes the whole stack by pass number.
    // Where the pass count named no line at all -- it looked for a line number the music
    // never carries -- the range's answer stands in for it rather than only correcting it.
    if (range.lyricLineIds?.length
      && !(lyricElement && range.lyricLineIds.includes(lyricElement.getAttribute('ch-lyric-line-id')))) {
      lyricElement = lyricElements.find(ve => range.lyricLineIds.includes(ve.getAttribute('ch-lyric-line-id')))
        ?? lyricElement;
    }

    // A round marker is engraved where the voice enters, which isn't always the chord
    // position its word starts on — it can land on a held note with no lyric, or on
    // the tail syllable of the word before. It belongs to the next word start.
    if (roundMarkersByChordPosition.has(cp) && !pendingRoundMarker) {
      pendingRoundMarker = roundMarkersByChordPosition.get(cp);
    }

    if (lyricElement) {
      const label = lyricElement.querySelector('label');
      const sylElements = Array.from(
        lyricElement.querySelectorAll('syl:not(:empty):not([ch-help-text])'));
      const text = sylElements.map(syl => (syl.textContent.replace(/[\-\‑\s]+$/, '').trim() + ' ').trim()).join(' ').trim() || null;
      const startsWord = !['m', 't'].includes(sylElements[0]?.getAttribute('wordpos'));
      const roundMarker = startsWord ? pendingRoundMarker : null;
      if (roundMarker) pendingRoundMarker = null;
      extractedLyricSyllables.push({
        label: label ? label.textContent.trim() : null,
        text: text,
        syls: sylElements.map(syl => ({
          text: syl.textContent.trim(),
          wordpos: syl.getAttribute('wordpos'),
          italic: syl.getAttribute('fontstyle') === 'italic',
          bold: syl.getAttribute('fontweight') === 'bold',
        })),
        verseLabel: lyricElement.getAttribute('label'),
        // The element these words were read off, so the stanza they land in can name it
        // later without re-deriving the link from chord positions and lyric line ids
        lyricElement: lyricElement,
        // Kept out of text so _alignSyllablesToLyrics, which matches these against
        // lyrics that already carry their own markers, is unaffected
        roundMarker: roundMarker,
        chordPositions: [cp],
        chordPositionRuns: [[cp, cp + 1]],
        expandedChordPositions: [ecpCounter],
        lyricLineIds: [lyricElement.getAttribute('ch-lyric-line-id')],
        startsSection: isFirstSyllableOfSection,
        startsRepeatedSection: isFirstSyllableOfRepeatedSection,
        sectionType: range.sectionType ?? null,
        sectionIndex: range.sectionIndex ?? null,
      });
      isFirstSyllableOfSection = false;
      isFirstSyllableOfRepeatedSection = false;
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

  if (this._scoreData.features.hasTwoPartMelody) {
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
      lyricElements: [],
    });
    return '';
  });

  const { normText, posMap } = this._normalizeLyricsForMatching(expandedLyrics);
  let pos = 0;
  const insertions = [];
  let currentStanzaIndex = 0;

  // Where every blank line falls, found once up front for the walk below
  const stanzaBreakOffsets = [];
  for (let at = expandedLyrics.indexOf('\n\n'); at !== -1; at = expandedLyrics.indexOf('\n\n', at + 1)) {
    stanzaBreakOffsets.push(at);
  }
  let nextBreak = 0;

  // Memoized: a song repeats its syllables across verses, and the fold is the same
  // document-scale normalizer either way (see _addPrintedLineBonus, which caches too).
  const foldedSyllables = new Map();
  const foldSyllable = (text) => {
    if (!foldedSyllables.has(text)) foldedSyllables.set(text, this._foldForMatching(text));
    return foldedSyllables.get(text);
  };

  // Match each syllable
  for (const syllable of syllables) {
    const normSylText = foldSyllable(syllable.text);
    if (!normSylText) continue;

    const windowEnd = Math.min(pos + 20, normText.length);
    let matchPos = -1;
    let matched = false;

    // Try exact match first, within the window rather than the whole rest of the text:
    // a hit past the window is discarded anyway, so searching that far only costs a
    // scan of everything left whenever a syllable doesn't line up.
    for (let i = pos; i < windowEnd; i++) {
      if (normText.startsWith(normSylText, i)) { matchPos = i; matched = true; break; }
    }
    // Fuzzy match
    if (!matched) {
      let bestPos = pos;
      let bestScore = 0;

      for (let i = pos; i < windowEnd; i++) {
        // Compared in place: a substring per candidate is an allocation per position
        const score = this._lyricSimilarity(normSylText, normText, i, normSylText.length);
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

      // Crossing a blank line means the next stanza has started. The matches only ever
      // move forward, so the breaks are walked once overall rather than re-counted out
      // of a fresh substring at every syllable.
      while (nextBreak < stanzaBreakOffsets.length && stanzaBreakOffsets[nextBreak] < originalPos) {
        nextBreak++;
        currentStanzaIndex = Math.min(currentStanzaIndex + 1, stanzas.length - 1);
      }

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
        // Same record the extracted-lyrics path keeps, so a stanza names its verse
        // elements whichever way its words were arrived at
        if (syllable.lyricElement) stanzas[currentStanzaIndex].lyricElements.push(syllable.lyricElement);
      }

      pos = matchPos + normSylText.length;
    }
  }

  for (const stanza of stanzas) {
    stanza.chordPositionRanges = this._consolidateChordPositionRanges(stanza.chordPositionRanges);
    stanza.expandedChordPositions = [stanza.expandedChordPositions[0], stanza.expandedChordPositions.at(-1) + 1];
  }

  // Splice every marker in over one pass. Rebuilding the whole string per insertion is
  // quadratic in the number of syllables, which a long text feels.
  insertions.sort((a, b) => a[0] - b[0]);
  const pieces = [];
  let cut = 0;
  for (const [idx, marker] of insertions) {
    pieces.push(expandedLyrics.slice(cut, idx), marker);
    cut = idx;
  }
  pieces.push(expandedLyrics.slice(cut));
  expandedLyrics = pieces.join('');

  const stanzasText = expandedLyrics.split('\n\n');
  for (let sz = 0; sz < stanzas.length; sz++) {
    stanzas[sz].annotatedLyrics = this._applyFindReplace(stanzasText[sz].trim());
  }

  return stanzas;
}

// One text fold, its policy named by the caller: `strip` is a global character class to
// drop, `edges` trims all but letters and digits off both ends, `whitespace` is 'keep',
// 'collapse' or 'remove'. The two policies in use are _foldForMatching and _foldWord.
ChScore.prototype._foldText = function (text, { strip = null, edges = false, whitespace = 'keep' } = {}) {
  let folded = text ?? '';
  // Decomposed only to strip, so a combining mark is a character of its own for `strip`
  // to reach. With nothing to strip that round trip ends where it started, so it's the
  // recomposition alone that runs -- a lookup key shouldn't depend on how the engraver
  // happened to encode its accents.
  if (strip) folded = folded.normalize('NFD').replace(strip, '');
  folded = folded.normalize('NFC');
  if (edges) folded = folded.replace(this._patterns.punctuationAtEdges, '');
  if (whitespace === 'collapse') folded = folded.replace(/\s+/g, ' ').trim();
  else if (whitespace === 'remove') folded = folded.replace(/\s+/g, '');
  return folded.toLowerCase();
}

// Fold for matching one source's text against another's -- printed lyrics against sung
// syllables. Folds hard, since the two are typeset by different hands: only letters are
// left. Runs through _normalizeLyricsForMatching, not _foldText, so this policy has one
// implementation -- that one is also HTML-aware and maps each character back to its source.
ChScore.prototype._foldForMatching = function (text, whitespace = 'collapse') {
  const folded = this._normalizeLyricsForMatching(text ?? '', false).normText;
  return whitespace === 'remove' ? folded.replace(/\s+/g, '') : folded.trim();
}

// Fold one word for looking up in a word list -- _hyphenatedWords, _phraseFunctionWords.
// Trims the edges only, leaving the spelling as engraved: it can't fold like
// _foldForMatching, because accents tell hyphen-table entries apart ("ében-ézer") and
// dropping the apostrophe would collapse "we'll" onto "well" and "I'll" onto "ill".
ChScore.prototype._foldWord = function (word) {
  const bare = (word ?? '').split(this._patterns.hyphen).join('').replace(this._patterns.apostrophes, '’');
  return this._foldText(bare, { edges: true });
}

// Build a match-friendly version of the lyrics, with a map back to where each
// normalized character came from in the original text (HTML-aware).
// For <ruby> blocks, use the <rt> reading text for matching and map to the <ruby> tag position.
// For other HTML tags (<em>, <strong>, etc.), skip them entirely.
// For plain text, apply the existing normalization (strip accents, punctuation, digits; collapse whitespace).
// `withPosMap` false skips that map, for callers that only want the folded text --
// _foldForMatching runs per syllable and throws it away.
ChScore.prototype._normalizeLyricsForMatching = function (expandedLyrics, withPosMap = true) {
  const normChars = [];
  const posMap = withPosMap ? [] : null;
  const rubyRegex = /<ruby[^>]*>[\s\S]*?<\/ruby>/gi;
  const stripRe = this._patterns.matchingStrip;
  let lastPlainIndex = 0;
  let rubyMatch;

  // Normalize a single character into normChars/posMap.
  // When collapseWhitespace is true, runs of whitespace become a single space.
  function addNormChar(char, position, collapseWhitespace) {
    const norm = char.normalize('NFD').replace(ChScore.prototype._patterns.diacriticMarks, '').toLowerCase();
    if (norm && !/\s/.test(norm)) {
      for (const ch of norm) {
        normChars.push(ch);
        posMap?.push(position);
      }
    } else if (collapseWhitespace && /\s/.test(norm) && normChars.at(-1) !== ' ') {
      normChars.push(' ');
      posMap?.push(position);
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
// `from`/`length` read a window of str2 in place, so a caller scanning many candidate
// positions doesn't allocate a substring for each one.
ChScore.prototype._lyricSimilarity = function (str1, str2, from = 0, length = null) {
  const len1 = str1.length;
  // Clamped to what is actually there, the way a substring past the end comes back short
  const available = str2.length - from;
  const len2 = length == null ? available : Math.min(length, available);
  if (len1 + len2 === 0) return 0;

  // The longest common substring only ever reads the row above, so one row does --
  // walked backwards, where row[i - 1] is still the previous column's value. Reused
  // between calls: this runs once per candidate position of every unmatched syllable.
  let row = ChScore.prototype._similarityRow;
  if (!row || row.length < len1 + 1) row = ChScore.prototype._similarityRow = new Int32Array(len1 + 1);
  row.fill(0, 0, len1 + 1);

  let maxLen = 0;
  for (let j = 1; j <= len2; j++) {
    const char2 = str2[from + j - 1];
    for (let i = len1; i >= 1; i--) {
      row[i] = str1[i - 1] === char2 ? row[i - 1] + 1 : 0;
      if (row[i] > maxLen) maxLen = row[i];
    }
  }
  return (maxLen * 2) / (len1 + len2);
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

// Whether one lyric line carries on into another. A line is identified per staff ("2.1" is
// staff 2's first line), so the tune moving staves mid-verse reads as a change of line where
// the same words are really continuing. Two-part scores keep the distinction: there each
// staff's line is its own part's.
ChScore.prototype._continuesLyricLine = function (lyricLineId, nextLyricLineId) {
  if (lyricLineId === nextLyricLineId) return true;
  if (this._scoreData.features.hasTwoPartMelody) return false;
  return lyricLineId?.split('.')[1] === nextLyricLineId?.split('.')[1];
}

// Group syllables into the runs that become stanzas: one lyric line, one section, one
// verse type, up to a label or a jump back into a repeat. Split out so phrase-start
// detection and stanza building can't drift apart about where a stanza begins.
ChScore.prototype._syllableStanzaRuns = function (syllables) {
  const runs = [];
  let current = null;
  for (const syllable of syllables) {
    const lyricLineId = syllable.lyricLineIds?.[0] ?? null;
    if (!lyricLineId || !syllable.text) continue;
    // A section says what it is; fall back to the lyric element's own label for
    // scores walked without sections to align to
    const type = syllable.sectionType ?? syllable.verseLabel ?? null;

    // Inside one section the lyric line may change and change back, and it is still one
    // stanza; only across sections does a new line start a new run
    const sameSection = current && syllable.sectionIndex != null
      && syllable.sectionIndex === current.sectionIndex;
    const startsNewRun = !current
      || syllable.startsSection
      || (!sameSection && !this._continuesLyricLine(current.lyricLineId, lyricLineId))
      || current.type !== type
      || Boolean(syllable.label)
      || syllable.chordPositions[0] < current.lastChordPosition;

    if (startsNewRun) {
      current = { lyricLineId: lyricLineId, type: type, lastChordPosition: -1, syllables: [],
        sectionIndex: syllable.sectionIndex ?? null };
      runs.push(current);
    }
    current.syllables.push(syllable);
    current.lastChordPosition = syllable.chordPositions.at(-1);
  }
  return runs;
}

// A pickup is the notes before a downbeat -- a word or two, never a line. The tests below
// bound themselves by it, in syllables actually sung rather than chord positions spanned, so
// held notes and rests between them don't count against it.
ChScore.prototype._maxPickupSyllables = 3;

// Start a stanza wherever a section the score plays more than once begins. On a
// complex-sections song nothing else marks that boundary: a chorus following a verse on the
// same lyric line, unlabelled and running forward, reads as more of the same verse. Kept out
// of _syllableStanzaRuns' own break rules because phrase starts are derived from the runs, so
// breaking there first hides the phrases that straddle the new boundary.
ChScore.prototype._splitRunsAtRepeatedSections = function (runs, phraseStarts) {
  const startsPhrase = (syllable) => phraseStarts.has(syllable.chordPositions[0]);

  const split = [];
  for (const run of runs) {
    // Where the boundaries could fall, before any is taken: whether one is real depends on how
    // much lyric the next one leaves it, which isn't known going forward.
    const candidates = [];
    let pieceStart = 0;
    for (let index = 1; index < run.syllables.length; index++) {
      // A section boundary is where the engraving repeats, not necessarily where a stanza
      // ends, so it is taken only when it also falls at a phrase boundary. The length test
      // rejects one opening after the verse's own upbeat ("To Be a Pioneer", 1989 CSB); the
      // phrase test rejects one opening mid-line ("Isaiah Said", HHC), and wants the boundary
      // exactly on a phrase start or on the syllable after a pickup that opens it -- a
      // pickup's worth of slack instead splits "A Child's Prayer" mid-line.
      if (run.syllables[index].startsRepeatedSection
        && index - pieceStart > this._maxPickupSyllables
        && (startsPhrase(run.syllables[index]) || startsPhrase(run.syllables[index - 1]))) {
        candidates.push(index);
        pieceStart = index;
      }
    }

    // A boundary opening a single line is the engraving coming round inside a stanza, not the
    // stanza ending -- "Close as a Quiet Prayer" (HHC) closes each verse with a repeat of
    // "Close as a quiet prayer." Read backwards, so each is measured against the next one
    // still standing, and kept as the cuts the pieces are sliced at.
    const cuts = [run.syllables.length];
    for (let at = candidates.length - 1; at >= 0; at--) {
      const opensALine = run.syllables
        .slice(candidates[at] + 1, cuts[0]).some(startsPhrase);
      if (opensALine) cuts.unshift(candidates[at]);
    }
    cuts.unshift(0);

    for (let cut = 0; cut + 1 < cuts.length; cut++) {
      const syllables = run.syllables.slice(cuts[cut], cuts[cut + 1]);
      if (syllables.length === 0) continue;
      split.push({ ...run, syllables: syllables,
        lastChordPosition: syllables.at(-1).chordPositions.at(-1) });
    }
  }
  return split;
}

// Fix pickup syllables that are grouped with the wrong section. Example: Teacher, Do You Love Me (Children’s Songbook)
ChScore.prototype._movePickupSyllables = function (runs, phraseStarts, syllables) {
  const sungChordPositions = new Set();
  for (const syllable of syllables) {
    for (const chordPosition of syllable.chordPositions) sungChordPositions.add(chordPosition);
  }

  // A run opens a phrase implicitly, and run boundaries never appear in phraseStarts, so a
  // verse entered through a repeat can be short of one ("Come with Me to Primary"). Only runs
  // on the same lyric line count -- another line opening is that verse's own start -- and
  // these are searched only, never used to call a run whole.
  const openingsByLyricLine = new Map();
  for (const run of runs) {
    const start = run.syllables[0]?.chordPositions[0];
    if (start == null) continue;
    if (!openingsByLyricLine.has(run.lyricLineId)) openingsByLyricLine.set(run.lyricLineId, new Set());
    openingsByLyricLine.get(run.lyricLineId).add(start);
  }
  // Scanned once, on the first move: almost no score moves a pickup at all
  let roundMarkersByChordPosition = null;

  for (let r = 1; r < runs.length; r++) {
    const previous = runs[r - 1];
    const run = runs[r];
    const firstChordPosition = run.syllables[0]?.chordPositions[0];
    // A run opening on a phrase start is whole; it was entered from the front
    if (firstChordPosition == null || phraseStarts.has(firstChordPosition)) continue;

    let phraseStart = null;
    const nearer = (candidate) => {
      if (candidate < firstChordPosition && (phraseStart === null || candidate > phraseStart)) {
        phraseStart = candidate;
      }
    };
    for (const candidate of phraseStarts) nearer(candidate);
    for (const candidate of openingsByLyricLine.get(run.lyricLineId) ?? []) nearer(candidate);
    if (phraseStart === null) continue;

    // What this run is missing of that phrase is what was sung ahead of it, in order: each
    // syllable moved back stands in for one of these positions
    const missing = [];
    for (let chordPosition = phraseStart; chordPosition < firstChordPosition; chordPosition++) {
      if (sungChordPositions.has(chordPosition)) missing.push(chordPosition);
    }
    if (missing.length === 0 || missing.length > this._maxPickupSyllables) continue;
    if (previous.syllables.length <= missing.length) continue;

    const moved = previous.syllables.splice(-missing.length);
    // Standing in for a position means carrying its round marker -- the ➀ engraved over the
    // pickup, which is otherwise sung only on the first pass
    roundMarkersByChordPosition ??= this._getRoundMarkersByChordPosition();
    for (const [index, syllable] of moved.entries()) {
      syllable.roundMarker = syllable.roundMarker
        ?? roundMarkersByChordPosition.get(missing[index]) ?? null;
    }
    run.syllables.unshift(...moved);
    previous.lastChordPosition = previous.syllables.at(-1).chordPositions.at(-1);
  }
  return runs;
}

// A passage engraved with one lyric line -- a second ending, a coda lead-in -- carries
// one line because everyone sings the same words there, not because those words belong
// to verse 1. The line number changing at its edge is what ends the run, so those words
// land in a stanza of their own instead of finishing the verse that ran into them
// ("Teacher, Do You Love Me?", 1989 CSB: verse 2 stops on "And", and "lead me safely
// with his light." starts a stanza). Give them back to that verse, up to the phrase
// start where the next section's own words begin -- which is also what leaves a trailing
// pickup ("I", into the chorus) behind as a fragment for _mergePickupStanzas.
//
// Only a boundary the music runs straight through: a jump back into a repeat is a real
// stanza break, and so is a labelled or section-starting syllable.
ChScore.prototype._mergeSingleLineRuns = function (runs, phraseStarts) {
  // In a two-part score the stacked lines are parts singing at once, not a verse's
  // alternatives, so a later single-line passage isn't the two of them converging and
  // the sibling-line test below doesn't mean what it means elsewhere.
  if (this._scoreData.features.hasTwoPartMelody) return runs;

  // Min and max rather than first and last: a run that was handed a pickup opens on the
  // chord position that pickup was engraved at, which is later than everything after it.
  // Only each syllable's own position counts -- a syllable held across a jump collects
  // the silent positions that follow it, which would otherwise stretch the run's span
  // over music it never sang and make it a sibling of everything.
  const spanOf = (run) => {
    let start = Infinity;
    let end = -Infinity;
    for (const syllable of run.syllables) {
      const chordPosition = syllable.chordPositions[0];
      if (chordPosition == null) continue;
      if (chordPosition < start) start = chordPosition;
      if (chordPosition > end) end = chordPosition;
    }
    return [start, end];
  };

  for (let r = 1; r < runs.length; r++) {
    const previous = runs[r - 1];
    const run = runs[r];
    const first = run.syllables[0];
    const previousLast = previous.syllables.at(-1);
    if (!first || !previousLast) continue;
    if (first.chordPositions[0] <= previousLast.chordPositions.at(-1)) continue;
    if (previous.type !== run.type || previous.lyricLineId === run.lyricLineId) continue;
    if (first.label || first.startsSection || first.startsRepeatedSection) continue;

    // A chorus after a verse has this same "forward, new lyric line" shape and must not
    // be swallowed. What separates them is whose line it is: a second ending reuses one
    // of the lines already stacked on the verse it follows -- everyone converges onto it
    // -- where a chorus is engraved on a line of its own, belonging to no verse. So the
    // passage continues the verse only if its line is one the verse's own music carries.
    // (The first syllable being a phrase start can't tell them apart: a run boundary is
    // an implicit phrase start and never appears in the set.)
    const [previousStart, previousEnd] = spanOf(previous);
    const siblingLineIds = new Set(runs
      .filter(other => other !== previous && other !== run)
      .filter(other => {
        const [start, end] = spanOf(other);
        return start <= previousEnd && previousStart <= end;
      })
      .map(other => other.lyricLineId));
    if (!siblingLineIds.has(run.lyricLineId)) continue;

    // Where the next section's words start. A run with none of its own opens no section
    // -- it is all continuation -- so it joins the verse whole; the empty run left behind
    // is dropped below. What keeps that from swallowing a chorus is the sibling-line test
    // above, not the presence of a phrase start here.
    let end = 1;
    while (end < run.syllables.length
      && !phraseStarts.has(run.syllables[end].chordPositions[0])) end += 1;

    previous.syllables.push(...run.syllables.splice(0, end));
    previous.lastChordPosition = previous.syllables.at(-1).chordPositions.at(-1);
  }
  return runs.filter(run => run.syllables.length > 0);
}

// Build lyric stanzas from score syllables, when no lyrics are provided
ChScore.prototype._getLyricsFromSyllables = function (syllables) {
  // Build table of hyphenated words (combining hard-coded words, and words from the song title and lyrics below)
  this._scoreData.hyphenPositions = this._hyphenPositionsTable(
    this._hyphenatedWords[this._scoreData.scoreMetadata.lang] ?? [],
    [this._scoreData.scoreMetadata.title,
      ...this._stanzaTextBlocks().map(block => block.html)].filter(Boolean)
  );

  const provisionalRuns = this._syllableStanzaRuns(syllables);
  // Phrase starts come from the runs as engraved; both passes below read them to decide
  // where a verse actually began and ended, so they have to follow rather than precede
  // them. Pickups move first: shedding a trailing pickup is what can leave a run that is
  // pure continuation, which is what the merge then hands back to the verse.
  const phraseStarts = this._getPhraseStartChordPositions(syllables, provisionalRuns);
  const sectionRuns = this._splitRunsAtRepeatedSections(provisionalRuns, phraseStarts);
  const withPickups = this._movePickupSyllables(sectionRuns, phraseStarts, syllables);
  const runs = this._mergeSingleLineRuns(withPickups, phraseStarts);

  // Walk the syllables in the order they're sung
  const built = [];
  let current = null;
  let builder = null;
  for (const run of runs) for (const [index, syllable] of run.syllables.entries()) {
    const chordPosition = syllable.chordPositions[0];
    const label = syllable.label ?? null;

    if (index === 0) {
      current = this._newLyricStanza(
        run.lyricLineId, run.type, label, chordPosition, syllable.expandedChordPositions[0]);
      builder = this._wordBuilder();
      built.push({ stanza: current, builder: builder });
    } else if (phraseStarts.has(chordPosition)) {
      builder.breakLine();
    }

    // The lyric elements this stanza's words were read off. Kept so the section paired
    // with the stanza can name them directly; deriving that link again from chord
    // positions leaves out any stanza whose range came out degenerate.
    if (syllable.lyricElement) current.lyricElements.push(syllable.lyricElement);

    if (syllable.roundMarker) builder.addRoundMarker(syllable.roundMarker);

    // The syllables as engraved, carried over from _extractLyricStanzas, which
    // read them off the lyric element: @wordpos is what joins them into words
    const syls = syllable.syls ?? [];
    if (syls.length > 0) {
      for (const syl of syls) builder.add(syl.text, syl.wordpos, syl.italic, syl.bold);
    } else {
      builder.add(syllable.text, null, false, false);
    }

    // A label reached mid-stanza names the stanza; it doesn't start a new one
    if (label && !current.marker) current.marker = label;

    // Record where the stanza is actually sung. A run outside the current range opens another
    // -- forward over a gap, backward over a jump into a repeat -- but only a syllable's
    // first run may: the rest are positions it is held across, and one held over a jump back
    // collects the positions replayed under it, which belong to whatever sings them.
    for (const [index, [runStart, runEnd]] of syllable.chordPositionRuns.entries()) {
      const lastRange = current.chordPositionRanges.at(-1);
      if (runStart > lastRange.end || (index === 0 && runStart < lastRange.start)) {
        current.chordPositionRanges.push({
          start: runStart,
          end: runEnd,
          staffNumbers: lastRange.staffNumbers,
          // Copied, not shared: _consolidateChordPositionRanges pushes into this
          lyricLineIds: [...lastRange.lyricLineIds],
        });
      } else if (runEnd > lastRange.end) {
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
  // Where a score numbers no verses of its own, the derived verses are numbered in the order
  // they are sung. The lyric line a stanza was read from cannot say it: a passage sung twice
  // is read from the same line both times, and is verses 1 and 2.
  const hasInlineVerseNumbers = this._scoreData.features?.hasInlineVerseNumbers;
  let verseCounter = 0;
  for (const stanza of stanzas) {
    stanza.name = this._stanzaName(stanza);
    if (hasInlineVerseNumbers || stanza.type !== 'verse' || stanza.marker) continue;
    stanza.marker = String(++verseCounter);
    stanza.name = `Verse ${stanza.marker}`;
  }
  return stanzas;
}

// How much each phrase-start signal is worth, fitted on the training half of the corpus.
// Text carries most of it — `capital` and `punctuation` are what a break really turns on —
// and `gap` is the musical signal that fires often enough to matter. `fermata` and
// `barLine` are musically the right idea but hardly ever fire in hymnody, so they're kept
// for repertoire that does mark its phrases rather than for what they earn here.
ChScore.prototype._phraseStartWeights = {
  punctuation: 1.0, capital: 1.5, gap: 0.8,
  fermata: 0.4, barLine: 0.6, beatPhase: 0.5,
  printedLine: 0.8,
  // Negative: evidence against breaking here, not for it
  functionWord: -0.4,
  // What a break has to be worth before it's taken at all, and what a line straying
  // from the song's typical length costs per syllable
  breakCost: 1.9, lengthCost: 0.3,
};

// Verse numbers an instruction spells out rather than writing as a digit ("Chorus after
// fourth verse:" in "O Thou Rock of Our Salvation"). Only as far as a verse count reaches.
ChScore.prototype._verseNumberWords = {
  en: { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth' },
  // Left commented until a score spells a verse number out in one of these. A language with
  // no entry reads no spelled-out number; a digit is read whatever the language.
  // fr: { 1: 'premier', 2: 'deuxième', 3: 'troisième', 4: 'quatrième', ... },
  // es: { 1: 'primero', 2: 'segundo', 3: 'tercero', 4: 'cuarto', ... },
  // pt: { 1: 'primeiro', 2: 'segundo', 3: 'terceiro', 4: 'quarto', ... },
};

// Words a line doesn't end on
ChScore.prototype._phraseFunctionWords = {
  en: new Set(['a', 'an', 'the', 'and', 'or', 'nor', 'but', 'my', 'i’m', 'i’ll', 'thy',
    'your', 'you’re', 'you’ll', 'our', 'we’re', 'we’ll', 'their', 'they’re', 'they’ll',
    'very', 'every', 'ev’ry']),
};

// Phrases used only in attributions
ChScore.prototype._attributionWords = {
  _any: ['©'],
  en: ['words by', 'music by', 'words:', 'music:', 'text:', 'arranged by',
    'arrangement:', 'copyright', 'all rights reserved', 'used by permission'],
  fr: ['paroles:', 'musique:', 'texte:', 'traduction française', 'arrangement',
    'droits réservés'],
  es: ['letra:', 'música:', 'texto:', 'traducción al español', 'arreglo',
    'derechos reservados'],
  pt: ['letra:', 'música:', 'texto:', 'tradução para o português', 'arranjo',
    'direitos reservados'],
};


// The whole word ending at this syllable, gathered back over however many notes it's sung
// across. Syllables arrive one chord position at a time; only the one opening the word
// carries @wordpos i or s, so that's where the walk stops.
ChScore.prototype._wordEndingAt = function (syllables, index) {
  const parts = [];
  for (let k = index; k >= 0; k--) {
    const syls = syllables[k].syls ?? [];
    parts.unshift(syls.length ? syls.map(syl => syl.text).join('') : (syllables[k].text ?? ''));
    if (!['m', 't'].includes(syls[0]?.wordpos)) break;
  }
  return parts.join('');
}

// The middle value of a list of numbers, or null if there are none. Sorts a copy: the
// callers build their lists for this and shouldn't have to care that it reorders them.
ChScore.prototype._median = function (numbers) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

// A signal firing at almost every word start, or at almost none, says nothing about
// where phrases begin. Phrases run roughly 6–10 syllables, so a rate near 1/8 is the
// informative case; the weight falls off from there and reaches 0 at the extremes.
ChScore.prototype._signalInformativeness = function (rate) {
  if (rate <= 0.01 || rate >= 0.75) return 0;
  return Math.min(1, (0.75 - rate) / 0.6);
}

// Evidence that a phrase starts at each chord position, as a Map. Only word starts are
// scored — a phrase never begins mid-word — and every backward-looking signal reads the
// whole span since the previous syllable (its held notes and rests included), not just
// the chord position before, since the fermata or long note ending a phrase often sits
// several positions back. Scores are averaged over the lyric lines singing a position,
// so verses agreeing on a break reinforce it without a separate cross-verse pass.
ChScore.prototype._scorePhraseStarts = function (syllables, runs = null) {
  runs = runs ?? this._syllableStanzaRuns(syllables);
  const chordPositions = this._scoreData.chordPositions ?? [];
  const weights = this._phraseStartWeights;

  const measures = this._scoreData.measures ?? [];
  const measureIndexById = new Map();
  measures.forEach((measure, index) => measureIndexById.set(measure.measureId, index));

  const fermataChordPositions = new Set();
  for (const fermata of this._scoreData.meiParsed?.querySelectorAll('fermata[ch-chord-position]') ?? []) {
    fermataChordPositions.add(Number.parseInt(fermata.getAttribute('ch-chord-position')));
  }

  const durations = [];
  for (const cp of this._scoreData.audibleChordPositions ?? []) {
    if (chordPositions[cp]?.durationQ > 0) durations.push(chordPositions[cp].durationQ);
  }
  const medianDuration = this._median(durations) ?? 1;

  // Raw per-signal hits, kept unweighted so the text signals can be calibrated once the
  // whole score has been seen
  const hits = new Map(); // cp -> { count, punctuation, capital, ... }
  const bump = (cp, signal, value = 1) => {
    if (!hits.has(cp)) hits.set(cp, { count: 0 });
    const entry = hits.get(cp);
    entry[signal] = (entry[signal] ?? 0) + value;
  };

  const functionWords = this._phraseFunctionWords[this._scoreData.scoreMetadata?.lang];
  // Memoized: the words a line can end on are the commonest words there are, so the
  // same handful ("the", "and", "my") is looked up over and over.
  const foldedWords = new Map();
  const foldWordCached = (word) => {
    if (!foldedWords.has(word)) foldedWords.set(word, this._foldWord(word));
    return foldedWords.get(word);
  };

  let wordStarts = 0;
  for (const run of runs) {
    for (let i = 1; i < run.syllables.length; i++) {
      const syllable = run.syllables[i];
      const previous = run.syllables[i - 1];
      const firstSyl = syllable.syls?.[0];
      if (['m', 't'].includes(firstSyl?.wordpos)) continue; // Never break mid-word

      const cp = syllable.chordPositions[0];
      wordStarts += 1;
      bump(cp, 'count');

      const previousText = (previous.syls?.at(-1)?.text ?? previous.text ?? '').trim();
      if (this._patterns.phrasePunctuation.test(previousText)) bump(cp, 'punctuation');
      // A line ending on a word that leans on the next one is evidence against a break.
      // Compared as a whole word, gathered back across the notes it's sung over: a word
      // split between them arrives a fragment at a time, and matching on the fragment it
      // ends with never recognizes a multi-syllable entry ("ev-’ry" reaching here as "ry").
      if (functionWords && ['s', 't', null, undefined].includes(previous.syls?.at(-1)?.wordpos)) {
        const bare = foldWordCached(this._wordEndingAt(run.syllables, i - 1));
        if (functionWords.has(bare)) bump(cp, 'functionWord');
      }
      if (/^\p{Lu}/u.test((firstSyl?.text ?? syllable.text ?? '').trim())) bump(cp, 'capital');

      // The span the previous syllable occupies: its own onset plus every position with
      // no syllable of its own, which _gatherSyllables already appended to it
      const span = previous.chordPositions;
      // How long since the previous syllable was sung, however that time is filled. A held
      // note and a rest are the same thing to a singer waiting to start the next phrase, and
      // measuring them separately made one graded and the other merely present-or-absent.
      const gapDuration = span.reduce((total, spanCp) => total + (chordPositions[spanCp]?.durationQ ?? 0), 0);
      if (gapDuration >= medianDuration * 1.75) bump(cp, 'gap');
      if (span.some(spanCp => fermataChordPositions.has(spanCp))) bump(cp, 'fermata');

      // Barlines crossed between the previous syllable and this one.
      // Repeat barlines are deliberately not evidence: in a song that doesn't start on a
      // downbeat they routinely fall mid-phrase or mid-word ("This Is the Christ",
      // "Were You There?").
      const fromIndex = measureIndexById.get(chordPositions[span[0]]?.measureId);
      const toIndex = measureIndexById.get(chordPositions[cp]?.measureId);
      if (fromIndex != null && toIndex != null && toIndex > fromIndex) {
        const crossed = measures.slice(fromIndex, toIndex);
        if (crossed.some(measure => ['dbl', 'end'].includes(measure.rightBarLine))) bump(cp, 'barLine');
      }
    }
  }

  // Calibrate the text signals against how often they fire in this score, so one weight
  // table works across languages: a score that capitalizes every word start (or none),
  // or that engraves no punctuation, simply falls back on the musical signals.
  const totalHits = (signal) => [...hits.values()].reduce((total, entry) => total + (entry[signal] ?? 0), 0);

  const scale = {
    capital: this._signalInformativeness(wordStarts ? totalHits('capital') / wordStarts : 0),
    punctuation: this._signalInformativeness(wordStarts ? totalHits('punctuation') / wordStarts : 0),
  };

  const scores = new Map();
  for (const [cp, entry] of hits) {
    let score = 0;
    for (const [signal, weight] of Object.entries(weights)) {
      if (!entry[signal]) continue;
      score += weight * (scale[signal] ?? 1) * (entry[signal] / entry.count);
    }
    scores.set(cp, score);
  }

  this._addBeatPhaseBonus(scores);
  this._addPrintedLineBonus(scores, runs);
  return scores;
}

// Phrases start at the same point in the measure all song long — not necessarily the
// downbeat. "Behold the Wounds in Jesus\u2019 Hands" starts every line on beat 4 of 4, so
// rewarding downbeats pointed at the wrong syllable every time; the beat has to be read off
// the score. One signal among the others, not a rule: it lifts the candidates on that beat
// and never rules out the ones off it. Reading only where notes fall, it works the same in a
// language whose spelling marks no phrase at all.
ChScore.prototype._addBeatPhaseBonus = function (scores) {
  const chordPositions = this._scoreData.chordPositions ?? [];
  const measuresById = this._scoreData.measuresById ?? {};

  const beatOf = (cp) => {
    const measure = measuresById[chordPositions[cp]?.measureId];
    if (!measure || measure.startQ == null) return null;
    const [count, unit] = measure.timeSignature ?? [0, 0];
    const fullMeasureQ = count && unit ? count * (4 / unit) : 0;
    if (!fullMeasureQ) return null;
    // A measure that doesn't open on a downbeat is the tail of a full one, so its notes sit
    // at the end of the bar rather than the start: an eighth-note pickup into 4/4 is on beat
    // 4½, not beat 1. Measuring from its own start put the song's first phrase — the one
    // phrase every song is certain of — on the wrong beat. Which measures those are is
    // settled the same way _parseAndAnnotateMei settles @isDownbeat.
    const startsOffDownbeat = ['partial-pickup', 'partial-end'].includes(measure.measureType);
    const lead = startsOffDownbeat ? fullMeasureQ - (measure.durationQ ?? fullMeasureQ) : 0;
    return (lead + chordPositions[cp].startQ - measure.startQ) % fullMeasureQ;
  };

  // Which beat it is comes from the pickup, not from the evidence: a song opening with a
  // one-beat pickup into 4/4 starts its phrases a beat before each barline, all song long.
  const firstMeasure = (this._scoreData.measures ?? [])[0];
  if (!firstMeasure || firstMeasure.startQ == null) return;
  const [fc, fu] = firstMeasure.timeSignature ?? [0, 0];
  const fullQ = fc && fu ? fc * (4 / fu) : 0;
  if (!fullQ) return;
  const pickupQ = firstMeasure.measureType === 'partial-pickup' ? firstMeasure.durationQ : 0;
  const phraseBeat = ((fullQ - pickupQ) % fullQ + fullQ) % fullQ;
  for (const cp of scores.keys()) {
    const beat = beatOf(cp);
    if (beat != null && Math.abs(beat - phraseBeat) < 0.01) {
      scores.set(cp, scores.get(cp) + this._phraseStartWeights.beatPhase);
    }
  }
}

// Verses printed below the music carry real line breaks from <lb>. Each printed line is
// matched on its own — not as part of a whole stanza — so a mid-verse refrain printed on
// one line is recovered, a typo costs only its own line, and lines can match out of order
// or repeat. Matching on the head and tail of a line rather than the whole of it is what
// makes a typo in the middle harmless. Strong evidence, not an override: printed verses
// are sometimes wrapped to fit a column rather than by phrase.
ChScore.prototype._addPrintedLineBonus = function (scores, runs) {
  const printedStanzas = this._stanzaTextBlocks().map(block => block.html);
  if (printedStanzas.length === 0) return;
  // Memoized: syllable texts repeat heavily across a song's verses, and the normalizer is
  // built for whole documents rather than the 2–5 characters it's handed here.
  const folded = new Map();
  const fold = (text) => {
    if (!folded.has(text)) {
      folded.set(text, this._foldForMatching(text, 'remove'));
    }
    return folded.get(text);
  };

  const printedLines = [];
  for (const stanza of printedStanzas) {
    for (const line of stanza.split('\n')) {
      const folded = fold(line);
      if (folded.length >= 6) printedLines.push(folded);
    }
  }
  if (printedLines.length === 0) return;

  for (const run of runs) {
    // The run's syllables as one folded string, with each character remembering which
    // syllable it came from
    let stream = '';
    const syllableIndexByChar = [];
    run.syllables.forEach((syllable, index) => {
      for (const char of fold(syllable.text ?? '')) {
        stream += char;
        syllableIndexByChar.push(index);
      }
    });
    if (!stream) continue;

    const bonusAt = (syllableIndex) => {
      const syllable = run.syllables[syllableIndex];
      if (!syllable) return;
      const cp = syllable.chordPositions[0];
      if (scores.has(cp)) scores.set(cp, scores.get(cp) + this._phraseStartWeights.printedLine);
    };

    for (const line of printedLines) {
      const head = line.slice(0, 10);
      const tail = line.slice(-10);
      for (let at = stream.indexOf(head); at !== -1; at = stream.indexOf(head, at + 1)) {
        bonusAt(syllableIndexByChar[at]);
      }
      for (let at = stream.indexOf(tail); at !== -1; at = stream.indexOf(tail, at + 1)) {
        bonusAt(syllableIndexByChar[at + tail.length]);
      }
    }
  }
}

// The chord positions where a lyric phrase starts, as a Set. Rather than thresholding the
// evidence, each stanza is segmented with dynamic programming against a prior on how long
// a line runs, so "phrases have at least a few syllables" and "a stanza's lines are about
// the same length" are costs rather than special cases — and a one-syllable line can't be
// produced at all. Two passes: the first finds the song's own typical line length, the
// second segments against it.
ChScore.prototype._getPhraseStartChordPositions = function (syllables, runs = null) {
  runs = runs ?? this._syllableStanzaRuns(syllables);
  const scores = this._scorePhraseStarts(syllables, runs);
  const { breakCost, lengthCost } = this._phraseStartWeights;
  const minLength = 4;
  const maxLength = 16;

  const segment = (run, targetLength, lengthWeight = lengthCost) => {
    const positions = run.syllables.map(syllable => syllable.chordPositions[0]);
    const count = positions.length;
    if (count < minLength * 2) return [];
    // best[j]: cost of covering the first j syllables, cameFrom[j]: the break before j
    const best = Array(count + 1).fill(Infinity);
    const cameFrom = Array(count + 1).fill(-1);
    best[0] = 0;
    for (let j = minLength; j <= count; j++) {
      for (let i = Math.max(0, j - maxLength); i <= j - minLength; i++) {
        if (best[i] === Infinity) continue;
        // A break has to pay for itself: without breakCost every position carrying any
        // evidence at all is worth breaking on, and stanzas come out split roughly double
        const evidence = i === 0 ? 0 : (scores.get(positions[i]) ?? 0) - breakCost;
        const cost = best[i] - evidence + lengthWeight * Math.abs((j - i) - targetLength);
        if (cost < best[j]) { best[j] = cost; cameFrom[j] = i; }
      }
    }
    if (best[count] === Infinity) return [];
    const breaks = [];
    for (let j = count; j > 0; j = cameFrom[j]) {
      if (cameFrom[j] > 0) breaks.push(cameFrom[j]);
    }
    return breaks.reverse();
  };

  // First pass on evidence alone — no length prior at all, so a song whose lines really
  // are short says so instead of being pulled toward a generic length. Its median is the
  // prior the second pass regularizes against.
  const lengths = [];
  for (const run of runs) {
    const breaks = segment(run, 8, lengthCost * 0.5);
    let previous = 0;
    for (const at of breaks.concat(run.syllables.length)) {
      lengths.push(at - previous);
      previous = at;
    }
  }
  const targetLength = this._median(lengths) ?? 8;

  const phraseStarts = new Set();
  for (const run of runs) {
    for (const at of segment(run, targetLength)) {
      phraseStarts.add(run.syllables[at].chordPositions[0]);
    }
  }
  return phraseStarts;
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
// reads both to link sections to their lyric elements.
ChScore.prototype._newLyricStanza = function (lyricLineId, type, marker, chordPosition, expandedChordPosition) {
  return {
    type: type,
    name: null, // set by _stanzaName once the stanza is complete
    marker: marker,
    annotatedLyrics: '',
    chordPositionRanges: [{
      start: chordPosition,
      end: chordPosition + 1,
      // Every staff that plays, not just the one these words were read off: @staffNumbers
      // is what _loadMidi filters the note sequence by, so naming one staff here silences
      // the accompaniment. Narrowed to the verse's own staves where the stanza becomes a
      // section (see _normalizeSections).
      staffNumbers: this._scoreData.staffNumbers,
      lyricLineIds: lyricLineId ? [lyricLineId] : [],
    }],
    expandedChordPositions: expandedChordPosition == null ? [] : [expandedChordPosition, expandedChordPosition + 1],
    lyricLineIds: lyricLineId ? [lyricLineId] : [],
    // Filled as syllables are added; the section paired with this stanza names these
    lyricElements: [],
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

// Known words with hyphens for lookup when extracting lyrics ("latter-day"), by
// language (see the `lang` input-data field in ChScore.prototype.load). A score's
// own printed lyrics (see _parseAndAnnotateMei) cover words this hard-coded list
// doesn't, in any language.
ChScore.prototype._hyphenatedWords = {
  en: [
    'adam-ondi-ahman', 'ah-so', 'all-gracious', 'all-pervading', 'birthday-time',
    'chewk-ha-hahm-nee-dah', 'coom-play-ahn-yos', 'day-dawn', 'death-beds', 'dog-en',
    'don-ken', 'earth-stains', 'easter-time', 'ever-circling', 'ever-joyful',
    'ever-living', 'ever-present', 'ever-sure', 'ever-tender', 'fah-now', 'far-called',
    'far-flung', 'fay-lees', 'fie-lee-mawn', 'firm-rooted', 'frer-li-sher',
    'get-the-work-done', 'grah-see-ahs', 'grah-too-lay-rare', 'guh-burts-tahk',
    'habit-free', 'heaven-born', 'heav’n-born', 'heav’n-rescued', 'heigh-dee-ho',
    'kahn-shah', 'latter-day', 'life-gate', 'life-giving', 'light-mindedness',
    'long-awaited', 'long-expected', 'love-light', 'mah-loh', 'mah-noo-ee-yah',
    'mare-see', 'nail-prints', 'never-fading', 'oh-meh-deh-toe', 'one-tenth',
    'prayer-time', 'purple-headed', 're-echoes', 'safe-folded', 'self-control',
    'shee-mah-sue', 'soul-cheering', 'star-spangled', 'stepping-stones', 'storm-tossed',
    'săng-ill-oŏl', 'tahn-joe-bee', 'tempest-tossed', 'thank-off’rings',
    'under-shepherds', 'valley-o', 'war-cry', 'well-fought', 'white-robed',
    'zip-a-dee-ay',
  ],
  fr: [
    'a-t-il', 'accorde-moi', 'accorde-nous', 'adorez-le', 'ai-je', 'aide-moi',
    'aide-nous', 'aimez-vous', 'aimons-le', 'apaise-moi', 'apaise-toi', 'apporte-nous',
    'apprends-moi', 'apprends-nous', 'approchez-vous', 'as-tu', 'assieds-toi',
    'au-delà', 'au-dessus', 'avez-vous', 'baptise-nous', 'bien-aimé', 'bien-aimés',
    'bénis-moi', 'bénis-nous', 'calme-nous', 'chante-le', 'chantons-le', 'cherchez-les',
    'choisirais-je', 'comble-nous', 'compte-les', 'conduis-moi', 'conduis-nous',
    'conforte-nous', 'consacrons-nous', 'console-moi', 'contemplerai-je',
    'contre-chant', 'convertissez-vous', 'couronne-moi', 'crièrent-ils', 'crois-le',
    'célébrez-le', 'dirige-moi', 'dis-moi', 'dis-nous', 'donne-moi', 'donne-nous',
    'donnons-lui', 'délivre-moi', 'délivre-nous', 'dénombre-les', 'efforçons-nous',
    'enseigne-moi', 'enseigne-nous', 'entends-le', 'entends-moi', 'envoie-moi', 'es-tu',
    'esprit-saint', 'est-il', 'exaltons-le', 'fais-en', 'fais-les', 'fais-toi',
    'faisons-lui', 'faites-lui', 'faut-il', 'fie-toi', 'forge-la', 'garde-moi',
    'garde-nous', 'gardons-nous', 'guide-moi', 'guide-nous', 'guidons-les',
    'guéris-moi', 'guéris-nous', 'ici-bas', 'ignore-les', 'jean-baptiste',
    'joignons-nous', 'jour-là', 'jusque-là', 'jésus-christ', 'laisse-nous',
    'laissez-les', 'laissons-la', 'laissons-le', 'levez-vous', 'levons-nous',
    'louez-le', 'louons-le', 'lui-même', 'là-bas', 'là-haut', 'l’arc-en-ciel',
    'l’esprit-saint', 'maître-guérisseur', 'menons-les', 'montre-moi', 'montre-nous',
    'montrons-nous', 'mène-moi', 'mène-nous', 'm’aimes-tu', 'm’as-tu', 'nouveau-né',
    'n’ai-je', 'n’est-ce', 'n’est-il', 'n’écoutons-nous', 'n’éprouves-tu', 'offre-nous',
    'offrons-lui', 'oserais-je', 'ouvrez-lui', 'pardonne-nous', 'pardonne-tous',
    'parle-moi', 'parlerais-je', 'penserais-je', 'permets-moi', 'permets-nous',
    'peut-on', 'peut-être', 'peux-tu', 'pleuraient-elles', 'porte-moi', 'portons-lui',
    'pourrais-je', 'pouvons-nous', 'premier-né', 'prends-le', 'prends-moi',
    'prends-nous', 'prosternons-nous', 'protège-moi', 'prépare-moi', 'présentez-vous',
    'prête-moi', 'puis-je', 'puisses-tu', 'puissiez-vous', 'puissions-nous',
    'puissé-je', 'purifie-le', 'purifie-moi', 'qu’avons-nous', 'qu’offrirons-nous',
    'raconte-moi', 'rappelons-nous', 'recouvrons-nous', 'reflèteraient-ils',
    'rejoins-les', 'rendez-lui', 'rendez-vous', 'rends-moi', 'rends-nous',
    'repentez-vous', 'reposez-vous', 'revêts-moi', 'revêts-nous', 'reçois-moi',
    'reçois-nous', 'réjouis-toi', 'réveillez-vous', 'révèle-toi', 'saint-esprit',
    'sainte-cène', 'saisissons-nous', 'sauve-moi', 'scelle-nous', 'serais-je',
    'serons-nous', 'servez-le', 'soir-là', 'sois-lui', 'sommes-nous', 'soulage-nous',
    'soutiens-les', 'soutiens-moi', 'soutiens-nous', 'souvenez-vous', 'souvenons-nous',
    'souviens-toi', 'suffit-il', 'suis-le', 'suis-moi', 'tenons-nous', 'tiens-toi',
    'tournez-vous', 'tournons-nous', 'tout-petits', 'tout-puissant', 'très-haut',
    'très-saint', 'unissez-vous', 'unissons-les', 'unissons-nous', 'vas-tu', 'veux-tu',
    'viens-nous', 'vois-tu', 'voudrais-je', 'ében-ézer', 'écoute-le', 'écoute-nous',
    'écoutez-le', 'étiez-vous', 'éveille-toi', 'éveillez-vous', 'éveillons-nous',
    'évite-les', 'œuvrons-y',
  ],
  pt: [
    'abraçar-me', 'abrem-se', 'achegai-vos', 'adorai-o', 'adorar-te', 'agarrar-nos',
    'agradecemos-te', 'agradecer-te', 'ajuda-me', 'ajuda-nos', 'ajudai-me',
    'ajudando-vos', 'ajudar-nos', 'ajudá-lo', 'alegra-te', 'aliviou-me', 'amai-vos',
    'amar-te', 'ancorar-me', 'aparta-nos', 'apegar-nos', 'apresentar-se', 'arco-íris',
    'arrepender-nos', 'bem-amado', 'bem-estar', 'bem-vindo', 'buscá-la', 'cantai-lhe',
    'cantaremos-te', 'chamai-o', 'chamar-te', 'concede-me', 'concede-nos',
    'conceder-nos', 'concedeu-me', 'conduzindo-os', 'consagrai-o', 'conta-me',
    'conta-nos', 'convida-nos', 'curei-lhe', 'damos-te', 'dar-lhe', 'dar-me', 'dar-nos',
    'dei-lhe', 'deitei-me', 'deixa-me', 'deixai-os', 'deixou-nos', 'deu-me',
    'dirigiu-se', 'dá-lhe', 'dá-lhes', 'dá-me', 'dá-nos', 'eleva-nos', 'ensina-me',
    'ensina-nos', 'ensinai-me', 'ensinar-me', 'ensinar-nos', 'ensinar-te',
    'ensinou-nos', 'ergam-se', 'ergue-nos', 'ergue-te', 'erguei-vos', 'escuta-nos',
    'esqueci-me', 'estender-lhe', 'estendeu-lhes', 'faz-me', 'faz-nos', 'fazendo-os',
    'fez-lhes', 'fez-nos', 'fizer-nos', 'guardou-me', 'guia-me', 'guia-nos',
    'guiai-vos', 'guiar-me', 'guiar-nos', 'guiar-te', 'inspira-me', 'inspiram-me',
    'inspirar-te', 'inspire-nos', 'leva-nos', 'libertar-nos', 'liderar-nos',
    'ligar-nos', 'livram-me', 'livrou-nos', 'louvai-o', 'louvá-lo', 'mandar-nos',
    'mandou-me', 'mandou-nos', 'mostra-me', 'mostrai-lhes', 'mostrar-nos',
    'mostrou-lhes', 'mostrou-me', 'mostrou-nos', 'nutre-nos', 'oferta-lhes', 'ouve-o',
    'ouvi-lo', 'ouvir-te', 'ouviu-se', 'passando-se', 'pedimos-te', 'perde-se',
    'perdoa-nos', 'peço-te', 'porta-voz', 'preparar-nos', 'preparou-nos', 'protege-me',
    'protege-nos', 'proteger-te', 'purifica-nos', 'redimir-nos', 'refina-me',
    'resgatar-nos', 'resgatou-me', 'responder-te', 'restaura-nos', 'reunir-se',
    'rogamos-te', 'rogo-te', 'salva-nos', 'salvar-nos', 'salvá-la', 'segui-lo',
    'segui-o', 'sela-nos', 'sem-par', 'servi-lo', 'servi-o', 'servir-te', 'sigamos-te',
    'sujeitam-se', 'suplicou-me', 'traz-me', 'trazer-nos', 'trazê-la', 'unir-nos',
    'vê-nos',
  ],
  es: [
    'eben-ezer',
  ],
};

// Hyphen-like characters seen in Finale-exported MEI: plain hyphen-minus, plus the
// typographic and non-breaking variants -- a compound word can land whole on one
// note (keeping its own hyphen character) or get split across several (see
// _wordBuilder's trailingHyphen below, built from this same set).
ChScore.prototype._hyphenCharacters = '-‐‑';

// What counts as punctuation at a word's edges. _hyphenPositionsTable trims it off
// every token it files, and _insertKnownHyphens off every word it looks up, so the two
// agree on a key no matter what quotes or sentence punctuation a word is printed with.
ChScore.prototype._punctuationCharacter = '[^\\p{L}\\p{N}]';

// A single printed line longer than this reads as a legal notice or performance
// instruction, not a lyric line.
ChScore.prototype._longLineThreshold = 70;

// How far apart two printed text blocks can sit and still count as one row (or one
// column) when _getScoreMetadata puts them in reading order. Both are MusicXML tenths,
// as `default-x`/`default-y` are, so they assume scores at a comparable <scaling> --
// true across both corpora, where these were calibrated: a row tolerance wide enough
// for side-by-side verses engraved a tenth or two apart vertically, and a column
// tolerance wide enough for a column whose blocks don't share an exact left edge.
ChScore.prototype._sameRowTolerance = 10;
ChScore.prototype._sameColumnTolerance = 100;

// Regular expressions
ChScore.prototype._patterns = {
  // Verse markers and styling in text blocks
  verseMarker: /^\s*\d{1,2}\s*[.)]/,
  stylingMarkup: /<\/?(?:em|strong)>/g,
  capoMark: /^capo\b[\s:.,-]*\d+[\s:.,-]*$/i,
  // A hymn/song number, optionally followed by a hyphen and/or letter
  standaloneNumber: /^\d+-?[A-Za-z]?$/,

  // Round numbers and ostinato directions
  roundMarker: /^[➀-➈]$/,
  ostinato: /ostinato/i,

  // Metronome mark, as a single tempo or a range
  tempoRange: /=\s*(\d+)(?:\s*[-–]\s*(\d+))?/,

  // Accidentals and superscripts in chord symbols
  chordFlat: /♭|b/g,
  chordSharp: /♯|#/g,
  chordDigits: /\d+/g,

  // Phrase punctuation, allowing a closing quote or bracket after it
  phrasePunctuation: /[.,:;?!—–…]["'’”\)\]]*$/u,

  // The two character sets above, as patterns
  hyphen: new RegExp(`[${ChScore.prototype._hyphenCharacters}]`),
  punctuationAtEdges: new RegExp(
    `^${ChScore.prototype._punctuationCharacter}+|${ChScore.prototype._punctuationCharacter}+$`, 'gu'),
  leadingPunctuation: new RegExp(`^${ChScore.prototype._punctuationCharacter}*`, 'u'),

  // Combining marks, left behind by an NFD decomposition once the base letter is out
  diacriticMarks: /[̀-ͯ]/g,

  // Everything a fold for *matching* drops. Symbols because nothing sung is one, digits
  // because a printed verse number ("3. Sweet hour") isn't sung either -- dropping it is
  // what lines a printed line up with the syllables.
  matchingStrip: /[̀-ͯ\p{P}\p{N}\p{S}]/u,

  // The apostrophe spelled one way, whichever the engraver used
  apostrophes: /['‘’ʼ]/g,
};

// A dictionary of hyphenated words, indexed by the word with its hyphens removed and
// lowercased, to the character positions (into that stripped word) a hyphen goes
// back at. `words` are already-hyphenated tokens (e.g. the hard-coded list below);
// `texts` are printed prose to scan for hyphenated words instead (e.g. a score's own
// title/lyrics). Leading/trailing punctuation is trimmed off each scanned token so a
// word inside quotes/guillemets or followed by sentence punctuation (e.g.
// "« Ében-Ézer »,") is still found.
ChScore.prototype._hyphenPositionsTable = function (words, texts = []) {
  const hyphenChars = ChScore.prototype._patterns.hyphen;
  const scannedWords = texts
    .flatMap(text => text.split(/\s+/))
    .map(token => token.replace(ChScore.prototype._patterns.punctuationAtEdges, ''));

  // Scanned words first, so a score's own printed hyphenation wins over the
  // hard-coded list on a conflict -- whichever is seen first for a given word claims
  // the table entry, and everything after (a repeated chorus, or a hard-coded word
  // the score's own text already covers) is skipped rather than recomputed.
  const table = {};
  for (const word of [...scannedWords, ...words]) {
    if (!hyphenChars.test(word)) continue;

    const parts = word.split(hyphenChars);
    const dehyphenated = parts.join('').toLowerCase();
    if (Object.hasOwn(table, dehyphenated)) continue;

    const positions = [];
    let position = 0;
    for (const part of parts.slice(0, -1)) {
      position += part.length;
      positions.push(position);
    }
    table[dehyphenated] = positions;
  }
  return table;
}

// Restore a known compound word's hyphen(s) once its syllables are rejoined, so
// "latterday" becomes "latter-day" again. Case is left as the syllables spelled
// it; only where the hyphens go is looked up. Punctuation is trimmed off the edges
// before looking up, the way _hyphenPositionsTable trims what it files, so a word
// ending a line ("AdamondiAhman.") still matches -- and since the looked-up positions
// count from the first letter, anything trimmed off the front shifts them back.
ChScore.prototype._insertKnownHyphens = function (word) {
  const leadingPunctuation = word.match(this._patterns.leadingPunctuation)[0].length;
  const trimmed = word.replace(this._patterns.punctuationAtEdges, '');

  const hyphenPositions = this._scoreData?.hyphenPositions?.[trimmed.toLowerCase()];
  if (!hyphenPositions) return word;

  let result = word;
  for (const position of hyphenPositions.slice().reverse()) {
    const at = position + leadingPunctuation;
    result = `${result.slice(0, at)}-${result.slice(at)}`;
  }
  return result;
}

// Joins syllables into words. MEI marks each syllable's position within its
// word with @wordpos: i(nitial), m(edial), t(erminal), s(ingle).
ChScore.prototype._wordBuilder = function () {
  const self = this;
  const trailingHyphen = new RegExp(`[${self._hyphenCharacters}\\s]+$`);
  const words = []; // { text, italic, bold, endsLine }, styling merged into <em>/<strong> spans in text()
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
    // End the current line. Marked on the last word rather than pushed as its own entry,
    // so a break can't land inside a word still being assembled in `partial`.
    breakLine() {
      const last = words.at(-1);
      if (last && !partial) last.endsLine = true;
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
      // single run instead of three, matching how it's engraved. A run never
      // spans a line break, so the markup stays inside its own line.
      const runs = [];
      for (const word of all) {
        const current = runs.at(-1);
        if (current && !current.endsLine && current.italic === word.italic && current.bold === word.bold) {
          current.text += ` ${word.text}`;
          current.endsLine = word.endsLine ?? false;
        } else {
          runs.push({ text: word.text, italic: word.italic, bold: word.bold, endsLine: word.endsLine ?? false });
        }
      }

      let text = '';
      for (const run of runs) {
        let piece = run.text;
        if (run.bold) piece = `<strong>${piece}</strong>`;
        if (run.italic) piece = `<em>${piece}</em>`;
        text += piece + (run.endsLine ? '\n' : ' ');
      }
      return text.trim();
    },
  };
}

// Whether a stanza is an anacrusis leading into the one after it, read off the music
// rather than the label. Three things have to hold, and together they are what a pickup
// before a repeat looks like: the fragment is sung in one place, immediately before the
// stanza it leads into, and fits inside a single measure — an anacrusis is the tail of
// the measure before the repeat barline, not a phrase. Measured in measures rather than
// counted in chord positions, so a dense accompaniment under two syllables can't defeat
// it: "Gethsemane" spans 37 measures where a real pickup spans one.
ChScore.prototype._isPickupFragment = function (stanza, next) {
  const ranges = stanza.chordPositionRanges;
  if (ranges?.length !== 1 || !next?.chordPositionRanges?.length) return false;

  // Sung immediately before it, and only split off because playback jumped back into
  // the repeat to reach the words the fragment leads into
  if (stanza.expandedChordPositions[1] !== next.expandedChordPositions[0]) return false;
  if (next.chordPositionRanges[0].start >= ranges[0].end) return false;

  const first = this._scoreData.chordPositions[ranges[0].start];
  const last = this._scoreData.chordPositions[ranges[0].end - 1];
  return Boolean(first) && first.measureId === last?.measureId;
}

// Merge pickup fragments into the verse they belong to. A hymn often engraves the next
// verse's first syllables on a pickup before a repeat, so they arrive as a stanza of
// their own — sung before the verse they belong to, and split off from it by the jump
// back into the repeat. Which verse that is can be printed ("2." on lyric line 1, "Were
// You There"), printed on the line it already names ("2." on lyric line 2, "Because"),
// or not printed at all ("I'm Trying to Be like Jesus"). Only the first is a label
// question; the other two are settled by _isPickupFragment reading the music.
ChScore.prototype._mergePickupStanzas = function (stanzas) {
  const merged = [];

  for (let s = 0; s < stanzas.length; s++) {
    const stanza = stanzas[s];
    const next = stanzas[s + 1];
    const number = this._markerNumber(stanza.marker);
    const lineNumber = Number.parseInt(stanza.lyricLineIds[0]?.split('.')[1]);
    const nextLineNumber = Number.parseInt(next?.lyricLineIds[0]?.split('.')[1]);

    // Whatever the label says, the fragment can only join a stanza of its own kind that
    // hasn't been numbered as a verse in its own right
    const nextTakesPickup = Boolean(next)
      && next.type === stanza.type
      && this._markerNumber(next.marker) === null;

    // A numbered label naming the verse it leads into. Where the label only names the
    // line the fragment already sits on, it says nothing on its own, so the music has to.
    const labelled = number !== null && nextLineNumber === number
      && (number !== lineNumber || this._isPickupFragment(stanza, next));

    // No label at all: the music is the only evidence there is.
    const unlabelled = number === null && nextLineNumber === lineNumber
      && this._isPickupFragment(stanza, next);

    const isPickup = nextTakesPickup && (labelled || unlabelled);

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
ChScore.prototype._startsWord = function (lyricElementOrSyl) {
  const syl = lyricElementOrSyl.matches('syl') ? lyricElementOrSyl : lyricElementOrSyl.querySelector('syl:not(:empty)');
  return !['m', 't'].includes(syl?.getAttribute('wordpos'));
}

// The number a verse's own label carries ("2." → 2), or null where it has none
ChScore.prototype._verseLabelNumber = function (lyricElement) {
  return this._markerNumber(lyricElement.querySelector('label')?.textContent);
}

// The verse a labelled pickup leads into, or null when the verse carries no numbered label
// or its label just names the lyric line it already sits on ("1." opening verse 1). "(3.)"
// printed on verse 1's line is the pickup case.
ChScore.prototype._pickupVerseNumber = function (lyricElement) {
  const labelNumber = this._verseLabelNumber(lyricElement);
  return labelNumber === Number.parseInt(lyricElement.getAttribute('n')) ? null : labelNumber;
}

// The staves that play in a given verse -- accompaniment included, so "playing", not
// "singing". A section must not claim a descant that joins in later: @staffNumbers is what
// _loadMidi filters the note sequence by, so a staff named here sounds and one left out does not.
ChScore.prototype._stavesPlayingIn = function (verseNumber) {
  const entersAt = this._scoreData.staffEntersAtVerse ?? new Map();
  const verse = Number.parseInt(verseNumber);
  return this._scoreData.staffNumbers
    .filter(staffNumber => (entersAt.get(staffNumber) ?? 1) <= (Number.isNaN(verse) ? 1 : verse));
}

// What a stanza is called: "Verse 2", "Chorus", or "Unknown" where the score says
// nothing. Settles what the name is read from as it goes — a numbered lyric line is a
// verse even with no verse@label, and a marker keeps only its digits. Stanza or section.
ChScore.prototype._stanzaName = function (stanza) {
  if (!stanza.type && stanza.marker) stanza.type = 'verse';
  // Nothing classified it and the score numbers no verses, so there is no scheme for it to
  // be an exception to: sung words with nothing else said about them are a verse. A score
  // that does label its verses is left alone -- an unclassified stanza there is a real
  // question about which passage it is, not a missing default.
  if (!stanza.type && !this._scoreData.features?.hasInlineVerseNumbers) {
    stanza.type = 'verse';
  }
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
