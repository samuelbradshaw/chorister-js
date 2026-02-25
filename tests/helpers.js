/**
 * Shared test helpers for Chorister.js tests.
 *
 * Provides:
 * - ChScore initialization (eval-based)
 * - Score state reset utilities
 * - MIDI test helpers
 *
 * Song-specific data (MusicXML, lyrics, expected counts, fermatas, parts,
 * sections) lives in song-data.js.
 */

import { resolve } from 'node:path';
import { vi } from 'vitest';

// ── Resource directory ────────────────────────────────────────

export const resourcesDir = resolve(import.meta.dirname, '..', 'resources');

// ── ChScore initialization ──────────────────────────────────

/**
 * Load ChScore by eval-ing chorister.js source.
 * Call once per file in a top-level beforeAll.
 * @returns {{ ChScore: Function, origDrawScore: Function }}
 */
export async function initChScore() {
  document.body.innerHTML = '<div id="score-container"></div>';
  document.adoptedStyleSheets = [];

  const fs = await import('node:fs');
  const path = await import('node:path');
  const scriptPath = path.resolve(import.meta.dirname, '..', 'chorister.js');
  let scriptContent = fs.readFileSync(scriptPath, 'utf-8');

  scriptContent = scriptContent.replace(
    /ChScore\.prototype\._chDependenciesLoaded\s*=\s*ChScore\.prototype\._chLoadDependencies\(\)/,
    'ChScore.prototype._chDependenciesLoaded = Promise.resolve(true)'
  );

  const indirectEval = eval;
  indirectEval(scriptContent);

  const ChScore = window.ChScore;
  const origDrawScore = ChScore.prototype.drawScore;
  return { ChScore, origDrawScore };
}

// ── Standard lifecycle hooks ─────────────────────────────────

/**
 * Register standard beforeEach/afterEach hooks for DOM and state reset.
 * Call at the top level of each test file.
 */
export function setupStandardHooks() {
  beforeEach(() => {
    document.body.innerHTML = '<div id="score-container"></div>';
    document.adoptedStyleSheets = [];
    if (window.ChScore) {
      window.ChScore.prototype._chScores = [];
      window.ChScore.prototype._throttleStatus = {};
    }
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });
}

// ── Score state helpers ──────────────────────────────────────

/**
 * Cheaply reset a loaded score to its post-load default state.
 * Re-parses MEI from the complete backup string and applies default effects.
 * Does NOT re-render SVG — use resetScoreStateWithRender for SVG tests.
 */
export function resetScoreState(score) {
  if (!score?._scoreData) return;
  score._currentOptions = structuredClone(window.ChScore.prototype._defaultOptions);
  score._scoreData.meiParsed = new DOMParser().parseFromString(
    score._scoreData.meiStringComplete, 'text/xml'
  );
  if (score._scoreData.hasFingeringMarks) {
    for (const fing of score._scoreData.meiParsed.querySelectorAll('fing')) fing.remove();
  }
  const scoreDef = score._scoreData.meiParsed.querySelector('scoreDef');
  if (scoreDef) scoreDef.setAttribute('mnum.visible', 'false');
  score._scoreData.meiString = new XMLSerializer().serializeToString(score._scoreData.meiParsed);
}

/**
 * Full reset that also re-renders SVG. Use for tests that inspect SVG output.
 */
export function resetScoreStateWithRender(score) {
  if (!score?._scoreData) return;
  score._currentOptions = structuredClone(window.ChScore.prototype._defaultOptions);
  score._updateMei();
  score.drawScore();
}

// ── MIDI helpers ─────────────────────────────────────────────

/**
 * Build a synthetic MIDI note sequence with one note per audible chord position.
 * Uses a fixed pitch (C4=60) and uniform durations based on a given QPM.
 */
export function buildFixedMock(expectedAudibleCount, qpm = 120) {
  const durationPerBeat = 60 / qpm;
  const notes = [];
  for (let i = 0; i < expectedAudibleCount; i++) {
    notes.push({
      pitch: 60 + (i % 12),
      startTime: i * durationPerBeat,
      endTime: (i + 1) * durationPerBeat,
      velocity: 80,
    });
  }
  return {
    notes,
    tempos: [{ time: 0, qpm }],
    totalTime: expectedAudibleCount * durationPerBeat,
    totalQuantizedSteps: 0,
  };
}

/**
 * Reset MIDI fields on score data so _loadMidi can repopulate them.
 */
export function resetMidiFields(score) {
  score._scoreData.midiNoteSequence = null;
  score._scoreData.midiType = null;
  for (const cpInfo of score._scoreData.chordPositions) {
    cpInfo.midiStartTime = null;
    cpInfo.midiEndTime = 0;
    cpInfo.midiDuration = null;
    cpInfo.midiQpm = null;
    cpInfo.midiNotesByPitch = {};
  }
  for (const ecp of score._scoreData.expandedChordPositions) {
    ecp.midiNotes = [];
    ecp.midiStartTime = null;
    ecp.midiEndTime = null;
  }
}

/**
 * Restore the default 4-note Magenta mock.
 */
export function restoreDefaultMagentaMock() {
  core.midiToSequenceProto.mockImplementation((midi) => ({
    notes: [
      { pitch: 60, startTime: 0, endTime: 0.5, velocity: 80 },
      { pitch: 62, startTime: 0.5, endTime: 1.0, velocity: 80 },
      { pitch: 64, startTime: 1.0, endTime: 1.5, velocity: 80 },
      { pitch: 65, startTime: 1.5, endTime: 2.0, velocity: 80 },
    ],
    tempos: [{ time: 0, qpm: 120 }],
    totalTime: 2.0,
    totalQuantizedSteps: 0,
  }));
}
