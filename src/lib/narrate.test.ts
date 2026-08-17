/**
 * Narration manager tests (r18-ui) - node env like the other src tests:
 * window.speechSynthesis + SpeechSynthesisUtterance are mocked as globals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNarrator, prepareNarrationText } from './narrate';

interface FakeUtterance {
  text: string;
  voice: unknown;
  rate: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

let spoken: FakeUtterance[];
let synth: {
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  getVoices: () => unknown[];
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  spoken = [];
  synth = {
    speak: vi.fn(),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getVoices: () => [],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  class MockUtterance implements FakeUtterance {
    voice: unknown = null;
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    text: string;
    constructor(text: string) {
      this.text = text;
      spoken.push(this);
    }
  }
  (globalThis as Record<string, unknown>).window = { speechSynthesis: synth };
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = MockUtterance;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
  delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
});

describe('prepareNarrationText', () => {
  it('strips URLs, emoji and markdown symbols, collapses whitespace', () => {
    const raw = 'Check https://example.com/x this 🌟 *great* _place_ #travel\n\nNew   line.';
    expect(prepareNarrationText(raw)).toBe('Check this great place travel New line.');
  });

  it('strips www-style URLs and blockquote markers too', () => {
    expect(prepareNarrationText('See www.example.com now > quoted')).toBe('See now quoted');
  });

  it('returns short text unchanged (trimmed)', () => {
    expect(prepareNarrationText('  A quiet café by the river.  ')).toBe('A quiet café by the river.');
  });

  it('caps at maxChars on a sentence boundary, no dangling partial sentence', () => {
    const text = 'One two three. Four five six. Seven eight nine ten eleven.';
    const out = prepareNarrationText(text, 30);
    expect(out).toBe('One two three. Four five six.');
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out).toMatch(/[.!?]$/);
  });

  it('falls back to a word boundary when no sentence fits', () => {
    const out = prepareNarrationText('supercalifragilistic expialidocious nonsense words here', 30);
    expect(out).toBe('supercalifragilistic');
    expect(out.length).toBeLessThanOrEqual(30);
  });
});

describe('createNarrator, unsupported', () => {
  it('is a safe no-op when speechSynthesis is unavailable', () => {
    delete (globalThis as Record<string, unknown>).window;
    const n = createNarrator();
    expect(n.supported).toBe(false);
    expect(() => {
      n.play('hello');
      n.pause();
      n.resume();
      n.stop();
    }).not.toThrow();
    expect(n.speaking).toBe(false);
    expect(n.paused).toBe(false);
  });
});

describe('createNarrator, supported', () => {
  const SENTENCE = 'The old harbor smells of salt and rain in the early morning light.';

  function longStory(sentences: number): string {
    return Array.from({ length: sentences }, () => SENTENCE).join(' ');
  }

  it('chunks long text into multiple utterances spoken in order', () => {
    const n = createNarrator();
    expect(n.supported).toBe(true);
    n.play(longStory(10)); // ~670 chars → 4 chunks of ≤240 chars
    expect(n.speaking).toBe(true);
    expect(spoken.length).toBe(1);
    expect(spoken[0]!.text.length).toBeLessThanOrEqual(240);

    // simulate the engine finishing each chunk - the next one must follow
    while (n.speaking) {
      spoken[spoken.length - 1]!.onend!();
    }
    expect(spoken.length).toBe(4);
    expect(spoken.map((u) => u.text).join(' ')).toBe(longStory(10));
    expect(synth.speak).toHaveBeenCalledTimes(4);
    expect(n.speaking).toBe(false);
  });

  it('stop cancels and clears the queue, a late onend speaks nothing more', () => {
    const n = createNarrator();
    n.play(longStory(10));
    spoken[spoken.length - 1]!.onend!(); // chunk 2 starts
    expect(spoken.length).toBe(2);
    n.stop();
    expect(synth.cancel).toHaveBeenCalled();
    expect(n.speaking).toBe(false);
    // stale engine callback after stop must not resurrect the queue
    spoken[spoken.length - 1]!.onend!();
    expect(spoken.length).toBe(2);
  });

  it('an utterance error advances the queue instead of wedging', () => {
    const n = createNarrator();
    n.play(longStory(10));
    spoken[spoken.length - 1]!.onerror!(); // chunk 1 errors
    expect(spoken.length).toBe(2); // chunk 2 started anyway
    expect(n.speaking).toBe(true);
    while (n.speaking) {
      spoken[spoken.length - 1]!.onend!();
    }
    expect(spoken.length).toBe(4);
  });

  it('play while speaking cancels the old narration and starts the new one', () => {
    const n = createNarrator();
    n.play(longStory(10));
    n.play('A brand new story.');
    expect(synth.cancel).toHaveBeenCalled();
    expect(spoken[spoken.length - 1]!.text).toBe('A brand new story.');
    expect(n.speaking).toBe(true);
  });

  it('pause/resume map to the engine and notify subscribers', () => {
    const n = createNarrator();
    const seen: Array<{ speaking: boolean; paused: boolean }> = [];
    n.onStateChange(() => seen.push({ speaking: n.speaking, paused: n.paused }));

    n.play('A short story.');
    n.pause();
    expect(synth.pause).toHaveBeenCalled();
    expect(n.paused).toBe(true);
    n.resume();
    expect(synth.resume).toHaveBeenCalled();
    expect(n.paused).toBe(false);
    n.stop();

    // notified on play, pause, resume, stop
    expect(seen).toEqual([
      { speaking: true, paused: false },
      { speaking: true, paused: true },
      { speaking: true, paused: false },
      { speaking: false, paused: false },
    ]);
  });
});
