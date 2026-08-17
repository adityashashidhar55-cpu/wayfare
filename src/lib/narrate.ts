/**
 * Narration - a thin, SSR-safe manager around the browser SpeechSynthesis
 * API ("give every place story a voice").
 *
 * Real-world quirks handled here:
 *  - Chrome silently kills long utterances after ~15s, so text is split into
 *    sentence chunks and queued one utterance at a time.
 *  - Chrome's speech queue can stall mid-utterance; a 10s `resume()`
 *    keep-alive runs while playing (the well-known workaround).
 *  - Utterances must stay referenced or Chrome GCs them mid-speech - the
 *    active utterance is pinned at module scope.
 *  - Voices load asynchronously; the preferred voice is resolved lazily on
 *    first play and re-resolved on `voiceschanged`.
 */

export interface Narrator {
  /** false when SpeechSynthesis is unavailable (SSR, old browsers) - every method is a safe no-op */
  supported: boolean;
  /** Speak `text` (prepared + chunked). Calling play while speaking stops the current narration first. */
  play(text: string): void;
  pause(): void;
  resume(): void;
  stop(): void;
  readonly speaking: boolean;
  readonly paused: boolean;
  /** Subscribe to state transitions (play/pause/resume/end/stop). Returns an unsubscribe fn. */
  onStateChange(cb: () => void): () => void;
}

/** Longest single utterance we hand to the engine - keeps well under Chrome's ~15s cutoff. */
const MAX_CHUNK_CHARS = 240;
/** Hard cap on narration length (prepareNarrationText default). */
const DEFAULT_MAX_CHARS = 2500;
/** Chrome stall workaround interval. */
const KEEPALIVE_MS = 10_000;

/** Pinned so Chrome can't GC the in-flight utterance (it would stop speaking). */
let pinnedUtterance: SpeechSynthesisUtterance | null = null;

/**
 * Clean a place description for reading aloud: strip URLs, emoji and
 * markdown symbols, collapse all whitespace to single spaces, and cap at
 * `maxChars` on a sentence boundary (nothing is appended - the text simply
 * stops at the last full sentence that fits).
 */
export function prepareNarrationText(text: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  let out = text
    // URLs (http(s)://… or www.…)
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    // emoji + pictographs, variation selectors, ZWJ
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    // markdown symbols
    .replace(/[*_#>`~]/g, '')
    // collapse whitespace/newlines
    .replace(/\s+/g, ' ')
    .trim();

  if (out.length <= maxChars) return out;

  const window_ = out.slice(0, maxChars);
  // last sentence-ending punctuation inside the window
  const lastEnd = Math.max(
  ...['.', '!', '?', '\u2014'].map((p) => window_.lastIndexOf(p)),
  );
  if (lastEnd > 0) return window_.slice(0, lastEnd + 1).trim();
  // no sentence boundary - fall back to the last whole word
  const lastSpace = window_.lastIndexOf(' ');
  if (lastSpace > 0) return window_.slice(0, lastSpace).trim();
  return window_.trim();
}

/** Split into sentences: break after . ! ? - and : when followed by whitespace + a capital/digit. */
function splitSentences(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?\u2014:])\s+(?=[A-Z0-9"“'‘])/u)
    .map((s) => s.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [text];
}

/** Group sentences into utterance-sized chunks (≤ MAX_CHUNK_CHARS each). */
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const sentence of splitSentences(text)) {
    if (sentence.length > MAX_CHUNK_CHARS) {
      // a single over-long sentence: flush, then hard-split on word boundaries
      if (current) { chunks.push(current); current = ''; }
      let rest = sentence;
      while (rest.length > MAX_CHUNK_CHARS) {
        const slice = rest.slice(0, MAX_CHUNK_CHARS);
        const cut = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf(','), slice.lastIndexOf(';'));
        const at = cut > 0 ? cut : MAX_CHUNK_CHARS;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at).trim();
      }
      if (rest) current = rest;
      continue;
    }
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = sentence;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Prefer premium-sounding voices; language order en-IN → en-GB → en-US → any en → default. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const premium = (v: SpeechSynthesisVoice) =>
    /google|microsoft|natural|premium/i.test(v.name) ? 0 : 1;
  const norm = (v: SpeechSynthesisVoice) => v.lang.toLowerCase().replace('_', '-');
  const langRank = (v: SpeechSynthesisVoice): number => {
    const l = norm(v);
    if (l === 'en-in') return 0;
    if (l === 'en-gb') return 1;
    if (l === 'en-us') return 2;
    if (l.startsWith('en')) return 3;
    if (v.default) return 4;
    return 5;
  };
  return [...voices].sort((a, b) => langRank(a) - langRank(b) || premium(a) - premium(b))[0]!;
}

export function createNarrator(): Narrator {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const synth = supported ? window.speechSynthesis : null;

  let queue: string[] = [];
  let speaking = false;
  let paused = false;
  let voice: SpeechSynthesisVoice | null | undefined; // undefined = not yet resolved
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  /** bumped on play/stop so stale utterance handlers can't touch new state */
  let session = 0;
  const listeners = new Set<() => void>();

  function notify() {
    for (const cb of listeners) cb();
  }

  function resolveVoice() {
    if (!synth) return;
    const v = pickVoice(synth.getVoices());
    if (v) {
      voice = v;
    } else if (voice === undefined) {
      // voices not loaded yet - retry when the list arrives
      voice = null;
      const onVoices = () => {
        voice = pickVoice(synth.getVoices());
        if (voice) synth.removeEventListener?.('voiceschanged', onVoices);
      };
      synth.addEventListener?.('voiceschanged', onVoices);
    }
  }

  function clearKeepAlive() {
    if (keepAlive != null) {
      clearInterval(keepAlive);
      keepAlive = null;
    }
  }

  function startKeepAlive() {
    clearKeepAlive();
    keepAlive = setInterval(() => {
      // Chrome workaround: nudge the queue so long narrations don't stall.
      if (speaking && !paused) synth?.resume();
    }, KEEPALIVE_MS);
  }

  function speakNext(sess: number) {
    if (!synth || sess !== session) return;
    const chunk = queue.shift();
    if (chunk == null) {
      // queue finished
      speaking = false;
      paused = false;
      pinnedUtterance = null;
      clearKeepAlive();
      notify();
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunk);
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    utterance.onend = () => speakNext(sess);
    // an engine error must not wedge the queue - advance like an end
    utterance.onerror = () => speakNext(sess);
    pinnedUtterance = utterance;
    // GC pin: holding this reference keeps Chrome from collecting the
    // utterance mid-speech; the void read also satisfies the compiler.
    void pinnedUtterance;
    synth.speak(utterance);
  }

  return {
    supported,

    get speaking() {
      return speaking;
    },
    get paused() {
      return paused;
    },

    play(text: string) {
      if (!synth) return;
      resolveVoice();
      // stop any current narration, then start fresh
      session += 1;
      synth.cancel();
      const prepared = prepareNarrationText(text);
      queue = prepared ? chunkText(prepared) : [];
      speaking = queue.length > 0;
      paused = false;
      if (speaking) {
        startKeepAlive();
        speakNext(session);
      }
      notify();
    },

    pause() {
      if (!synth || !speaking || paused) return;
      synth.pause();
      paused = true;
      notify();
    },

    resume() {
      if (!synth || !speaking || !paused) return;
      synth.resume();
      paused = false;
      notify();
    },

    stop() {
      if (!synth) return;
      session += 1;
      queue = [];
      synth.cancel();
      pinnedUtterance = null;
      clearKeepAlive();
      if (speaking || paused) {
        speaking = false;
        paused = false;
        notify();
      }
    },

    onStateChange(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
