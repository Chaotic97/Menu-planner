/**
 * Client-side Speech-to-Text using OpenAI Whisper via Transformers.js.
 * Runs entirely in the browser — no server processing, audio never leaves device.
 * Uses whisper-base quantized (~50MB one-time download, cached by Transformers.js).
 */

import { showToast } from '../components/toast.js';

const MODEL_ID = 'Xenova/whisper-base';
const MAX_RECORD_SECONDS = 30;
const IDLE_UNLOAD_MS = 5 * 60 * 1000; // Free memory after 5 min idle

let transcriber = null;
let isModelLoading = false;
let activeButton = null; // Only one mic records at a time
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let idleTimer = null;

// Microphone SVG icons
const micIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
  <line x1="12" y1="19" x2="12" y2="23"/>
  <line x1="8" y1="23" x2="16" y2="23"/>
</svg>`;

const stopIcon = `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="none">
  <rect x="6" y="6" width="12" height="12" rx="2"/>
</svg>`;

/**
 * Lazily load Transformers.js and initialize the Whisper pipeline.
 * Shows a progress toast during model download.
 */
async function ensureModel() {
  if (transcriber) {
    resetIdleTimer();
    return transcriber;
  }
  if (isModelLoading) return null;

  // Check if model is likely cached (heuristic: if we loaded it before in this session)
  // If offline and model not cached, warn the user
  if (!navigator.onLine) {
    // Try to load anyway — Transformers.js will use Cache API if model was downloaded before
    // If it fails, we'll catch and show offline message
  }

  isModelLoading = true;
  let progressToastShown = false;

  try {
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1');

    transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      quantized: true,
      progress_callback: (progress) => {
        if (progress.status === 'download' && !progressToastShown) {
          showToast('Downloading voice model... This is a one-time download.', 'info', 10000);
          progressToastShown = true;
        }
      },
    });

    resetIdleTimer();
    return transcriber;
  } catch (err) {
    if (!navigator.onLine) {
      showToast('Voice input requires a one-time model download. Please connect to the internet.', 'error', 5000);
    } else {
      showToast('Failed to load voice model. Please try again.', 'error', 4000);
    }
    console.error('Whisper model load failed:', err);
    return null;
  } finally {
    isModelLoading = false;
  }
}

/** Reset the idle timer that unloads the model to free memory. */
function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    transcriber = null;
    idleTimer = null;
  }, IDLE_UNLOAD_MS);
}

/**
 * Convert an audio Blob to a Float32Array at 16kHz (Whisper's required sample rate).
 */
async function audioToFloat32(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  // Create AudioContext inside user-gesture call chain (iOS requirement)
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    // Get mono channel (first channel)
    const channelData = audioBuffer.getChannelData(0);

    // If sample rate doesn't match 16kHz, resample
    if (audioBuffer.sampleRate !== 16000) {
      const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * 16000), 16000);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start(0);
      const resampled = await offlineCtx.startRendering();
      return resampled.getChannelData(0);
    }

    return channelData;
  } finally {
    await audioCtx.close();
  }
}

/**
 * Pick a supported MediaRecorder mime type.
 * iOS Safari doesn't support audio/webm, so we fall back.
 */
function getRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return ''; // Let browser choose default
}

/**
 * Start recording from the microphone.
 * Returns a Promise that resolves with the recorded audio Blob when stopped.
 */
function startRecording(button) {
  return new Promise((resolve, reject) => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        audioChunks = [];
        const mimeType = getRecordingMimeType();
        const options = mimeType ? { mimeType } : {};
        mediaRecorder = new MediaRecorder(stream, options);

        mediaRecorder.addEventListener('dataavailable', (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        });

        mediaRecorder.addEventListener('stop', () => {
          // Stop all tracks to release mic
          stream.getTracks().forEach(t => t.stop());
          const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
          audioChunks = [];
          resolve(blob);
        });

        mediaRecorder.addEventListener('error', (e) => {
          stream.getTracks().forEach(t => t.stop());
          reject(e.error || new Error('Recording failed'));
        });

        mediaRecorder.start();
        isRecording = true;
        button.classList.add('stt-recording');
        button.innerHTML = stopIcon;
        button.title = 'Stop recording';

        // Safety timeout
        setTimeout(() => {
          if (isRecording && mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
        }, MAX_RECORD_SECONDS * 1000);
      })
      .catch(err => {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          showToast('Microphone access is required for voice input.', 'error', 4000);
        } else {
          showToast('Could not access microphone.', 'error', 4000);
        }
        reject(err);
      });
  });
}

/** Stop the current recording. */
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  isRecording = false;
}

/**
 * Handle a mic button tap. Manages the full record → transcribe → insert flow.
 */
async function handleMicTap(button, targetInput) {
  // If another button is already recording, ignore
  if (activeButton && activeButton !== button) return;

  // If currently recording, stop
  if (isRecording && activeButton === button) {
    stopRecording();
    return; // The promise from startRecording will resolve and continue the flow
  }

  // Start new recording
  activeButton = button;

  try {
    const audioBlob = await startRecording(button);

    // Switch to transcribing state
    button.classList.remove('stt-recording');
    button.classList.add('stt-transcribing');
    button.innerHTML = micIcon;
    button.title = 'Transcribing...';

    // Ensure model is loaded
    const model = await ensureModel();
    if (!model) {
      button.classList.remove('stt-transcribing');
      button.title = 'Voice input';
      activeButton = null;
      return;
    }

    // Convert audio and transcribe
    const audioData = await audioToFloat32(audioBlob);
    const result = await model(audioData, {
      language: 'en',
      task: 'transcribe',
    });

    const text = (result.text || '').trim();
    if (text) {
      // Insert at cursor position or append
      const start = targetInput.selectionStart;
      const end = targetInput.selectionEnd;
      const current = targetInput.value;
      const prefix = current.substring(0, start);
      const suffix = current.substring(end);
      const spaceBefore = prefix.length > 0 && !prefix.endsWith(' ') ? ' ' : '';
      targetInput.value = prefix + spaceBefore + text + suffix;
      // Place cursor after inserted text
      const newPos = prefix.length + spaceBefore.length + text.length;
      targetInput.setSelectionRange(newPos, newPos);
      targetInput.focus();
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      showToast('No speech detected. Please try again.', 'info', 3000);
    }
  } catch (err) {
    if (err.name !== 'NotAllowedError' && err.name !== 'PermissionDeniedError') {
      showToast('Voice input failed. Please try again.', 'error', 3000);
      console.error('STT error:', err);
    }
  } finally {
    button.classList.remove('stt-recording', 'stt-transcribing');
    button.innerHTML = micIcon;
    button.title = 'Voice input';
    activeButton = null;
    isRecording = false;
  }
}

/**
 * Create a microphone button that records audio and inserts transcribed text
 * into the given input element.
 * @param {HTMLInputElement} targetInput - The text input to insert transcribed text into
 * @returns {HTMLButtonElement} The mic button element
 */
export function createMicButton(targetInput) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'stt-mic';
  btn.title = 'Voice input';
  btn.setAttribute('aria-label', 'Voice input');
  btn.innerHTML = micIcon;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    handleMicTap(btn, targetInput);
  });

  return btn;
}
