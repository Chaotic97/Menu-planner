/**
 * Client-side Speech-to-Text using OpenAI Whisper via Transformers.js.
 * Runs entirely in the browser — no server processing, audio never leaves device.
 * Uses whisper-base quantized (~50MB one-time download, cached by Transformers.js).
 */

import { showToast } from '../components/toast.js';

const MODEL_ID = 'Xenova/whisper-base';
const MAX_RECORD_SECONDS = 30;
const IDLE_UNLOAD_MS = 5 * 60 * 1000; // Free memory after 5 min idle
const SILENCE_THRESHOLD = 0.01; // RMS below this = silence
const SILENCE_DURATION_MS = 2500; // 2.5s of silence to auto-stop
const CHUNK_INTERVAL_MS = 4000; // Transcribe interim every 4s

/** Detect Whisper hallucination tokens like [BLANK_AUDIO] */
function isBlankAudio(text) {
  return /^\[.*BLANK.*AUDIO.*\]$/.test(text);
}

let transcriber = null;
let isModelLoading = false;
let activeButton = null; // Only one mic records at a time
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let idleTimer = null;

// Silence detection state
let silenceAudioCtx = null;
let analyserNode = null;
let silenceStart = null;
let silenceCheckInterval = null;

// Interim transcription state
let chunkTranscribeInterval = null;
let isChunkTranscribing = false;
let targetInputRef = null;
let originalInputValue = '';

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

/* ============================
   Model Cache Management
   ============================ */

/**
 * Synchronous check using localStorage heuristic.
 * Used by mic button guard for fast, non-blocking check.
 */
export function isModelDownloaded() {
  return localStorage.getItem('stt_model_downloaded') === 'true';
}

/**
 * Async check that queries the Cache API as source of truth.
 * Updates localStorage to match. Returns { cached: boolean }.
 */
export async function checkModelCached() {
  try {
    const cacheNames = await caches.keys();
    const transformersCache = cacheNames.find(name =>
      name.includes('transformers') || name.includes('huggingface')
    );
    if (transformersCache) {
      const cache = await caches.open(transformersCache);
      const keys = await cache.keys();
      const hasWhisper = keys.some(req => req.url.includes('whisper-base'));
      localStorage.setItem('stt_model_downloaded', String(hasWhisper));
      return { cached: hasWhisper };
    }
    // No transformers cache found — check if model is loaded in memory
    if (transcriber) {
      localStorage.setItem('stt_model_downloaded', 'true');
      return { cached: true };
    }
    localStorage.setItem('stt_model_downloaded', 'false');
    return { cached: false };
  } catch {
    // Cache API not available or error — fall back to localStorage
    return { cached: isModelDownloaded() };
  }
}

/**
 * Pre-download the Whisper model with progress reporting.
 * @param {function} onProgress - Called with { status, progress, file } during download
 */
export async function preDownloadModel(onProgress) {
  if (transcriber) {
    localStorage.setItem('stt_model_downloaded', 'true');
    return;
  }
  if (isModelLoading) return;

  isModelLoading = true;
  try {
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1');

    transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      quantized: true,
      progress_callback: onProgress || (() => {}),
    });

    localStorage.setItem('stt_model_downloaded', 'true');
    resetIdleTimer();
  } finally {
    isModelLoading = false;
  }
}

/**
 * Delete cached model files and clear status.
 */
export async function deleteModelCache() {
  try {
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      if (name.includes('transformers') || name.includes('huggingface')) {
        await caches.delete(name);
      }
    }
  } catch {
    // Cache API not available
  }
  transcriber = null;
  localStorage.removeItem('stt_model_downloaded');
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
}

/**
 * Lazily load Transformers.js and initialize the Whisper pipeline.
 */
async function ensureModel() {
  if (transcriber) {
    resetIdleTimer();
    return transcriber;
  }
  if (isModelLoading) return null;

  isModelLoading = true;
  let progressToastShown = false;

  try {
    const { pipeline } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1');

    transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      quantized: true,
      progress_callback: (progress) => {
        if (progress.status === 'download' && !progressToastShown) {
          showToast('Loading voice model from cache...', 'info', 5000);
          progressToastShown = true;
        }
      },
    });

    localStorage.setItem('stt_model_downloaded', 'true');
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
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  try {
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(0);

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

/* ============================
   Silence Detection
   ============================ */

function startSilenceDetection(stream) {
  try {
    silenceAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = silenceAudioCtx.createMediaStreamSource(stream);
    analyserNode = silenceAudioCtx.createAnalyser();
    analyserNode.fftSize = 2048;
    source.connect(analyserNode);

    const bufferLength = analyserNode.fftSize;
    const dataArray = new Float32Array(bufferLength);
    silenceStart = null;

    silenceCheckInterval = setInterval(() => {
      if (!isRecording || !analyserNode) return;

      analyserNode.getFloatTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / bufferLength);

      if (rms < SILENCE_THRESHOLD) {
        if (activeButton) activeButton.classList.remove('stt-hearing');
        if (silenceStart === null) {
          silenceStart = Date.now();
        } else if (Date.now() - silenceStart >= SILENCE_DURATION_MS) {
          // Silence detected long enough — auto-stop
          if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
          }
        }
      } else {
        if (activeButton) activeButton.classList.add('stt-hearing');
        silenceStart = null;
      }
    }, 100);
  } catch (err) {
    console.warn('Silence detection setup failed:', err);
  }
}

function stopSilenceDetection() {
  if (activeButton) activeButton.classList.remove('stt-hearing');
  if (silenceCheckInterval) { clearInterval(silenceCheckInterval); silenceCheckInterval = null; }
  if (silenceAudioCtx) {
    silenceAudioCtx.close().catch(() => {});
    silenceAudioCtx = null;
  }
  analyserNode = null;
  silenceStart = null;
}

/* ============================
   Interim Transcription
   ============================ */

function startInterimTranscription(targetInput) {
  targetInputRef = targetInput;
  originalInputValue = targetInput.value;

  chunkTranscribeInterval = setInterval(async () => {
    if (audioChunks.length === 0 || !transcriber || isChunkTranscribing) return;

    isChunkTranscribing = true;
    try {
      const interimBlob = new Blob([...audioChunks], { type: mediaRecorder?.mimeType || 'audio/webm' });
      const audioData = await audioToFloat32(interimBlob);
      const result = await transcriber(audioData, { language: 'en', task: 'transcribe' });
      const rawInterim = (result.text || '').trim();
      const interimText = isBlankAudio(rawInterim) ? '' : rawInterim;

      if (interimText && targetInputRef && isRecording) {
        const prefix = originalInputValue;
        const spaceBefore = prefix.length > 0 && !prefix.endsWith(' ') ? ' ' : '';
        targetInputRef.value = prefix + spaceBefore + interimText;
        targetInputRef.classList.add('stt-interim-text');
      }
    } catch {
      // Non-critical — skip this interim update
    } finally {
      isChunkTranscribing = false;
    }
  }, CHUNK_INTERVAL_MS);
}

function stopInterimTranscription() {
  if (chunkTranscribeInterval) { clearInterval(chunkTranscribeInterval); chunkTranscribeInterval = null; }
  if (targetInputRef) targetInputRef.classList.remove('stt-interim-text');
  targetInputRef = null;
  isChunkTranscribing = false;
}

/* ============================
   Recording
   ============================ */

/**
 * Start recording from the microphone.
 * Returns a Promise that resolves with the recorded audio Blob when stopped.
 */
function startRecording(button, targetInput) {
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
          stream.getTracks().forEach(t => t.stop());
          stopSilenceDetection();
          stopInterimTranscription();
          const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
          audioChunks = [];
          isRecording = false;
          resolve(blob);
        });

        mediaRecorder.addEventListener('error', (e) => {
          stream.getTracks().forEach(t => t.stop());
          stopSilenceDetection();
          stopInterimTranscription();
          isRecording = false;
          reject(e.error || new Error('Recording failed'));
        });

        // Use timeslice for incremental chunks (Safari fallback below)
        try {
          mediaRecorder.start(1000);
        } catch {
          // Safari may not support timeslice — fall back to regular start
          mediaRecorder.start();
        }

        isRecording = true;
        button.classList.add('stt-recording');
        button.innerHTML = stopIcon;
        button.title = 'Stop recording';

        // Start silence detection
        startSilenceDetection(stream);

        // Start interim transcription if model is loaded
        if (targetInput && transcriber) {
          startInterimTranscription(targetInput);
        }

        // Safari timeslice fallback: poll requestData if timeslice didn't work
        // (dataavailable only fires on stop without timeslice)
        if (targetInput && transcriber) {
          const requestDataInterval = setInterval(() => {
            if (!isRecording || !mediaRecorder || mediaRecorder.state !== 'recording') {
              clearInterval(requestDataInterval);
              return;
            }
            try { mediaRecorder.requestData(); } catch { /* ignore */ }
          }, 1000);
        }

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
}

/**
 * Handle a mic button tap. Manages the full record -> transcribe -> insert flow.
 */
async function handleMicTap(button, targetInput) {
  // If another button is already recording, ignore
  if (activeButton && activeButton !== button) return;

  // If currently recording, stop
  if (isRecording && activeButton === button) {
    stopRecording();
    return; // The promise from startRecording will resolve and continue the flow
  }

  // Guard: check if model is pre-downloaded
  if (!transcriber && !isModelDownloaded()) {
    showToast('Voice model not downloaded. Go to Settings \u2192 Voice Input to download.', 'warning', 5000);
    return;
  }

  // Start new recording
  activeButton = button;

  // Pre-load model from cache so it's ready for interim transcription
  ensureModel();

  try {
    const audioBlob = await startRecording(button, targetInput);

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

    const rawText = (result.text || '').trim();
    const text = isBlankAudio(rawText) ? '' : rawText;

    // Clear interim styling
    targetInput.classList.remove('stt-interim-text');

    if (text) {
      // Replace with final transcription at original cursor position
      const prefix = originalInputValue || '';
      const spaceBefore = prefix.length > 0 && !prefix.endsWith(' ') ? ' ' : '';
      targetInput.value = prefix + spaceBefore + text;
      const newPos = targetInput.value.length;
      targetInput.setSelectionRange(newPos, newPos);
      targetInput.focus();
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Restore original value if no speech detected
      targetInput.value = originalInputValue || '';
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
    originalInputValue = '';
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
