import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMPT,
  consumeImportRequest,
  consumePlanPrompt,
  extractDestinationHint,
  saveImportRequest,
  savePlanPrompt,
} from './plan-prompt';

/* vitest runs in the node environment, so provide a minimal in-memory
   sessionStorage that matches the Web Storage API surface we use. */
function installSessionStorageStub() {
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => store.get(k) ?? null,
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  Object.defineProperty(globalThis, 'sessionStorage', { value: stub, configurable: true });
}

installSessionStorageStub();

describe('plan-prompt handoff', () => {
  beforeEach(() => sessionStorage.clear());

  it('round-trips the prompt exactly once', () => {
    savePlanPrompt('7 days in Lisbon, please');
    expect(consumePlanPrompt()).toBe('7 days in Lisbon, please');
    expect(consumePlanPrompt()).toBeNull();
  });

  it('round-trips the import request exactly once', () => {
    expect(consumeImportRequest()).toBe(false);
    saveImportRequest();
    expect(consumeImportRequest()).toBe(true);
    expect(consumeImportRequest()).toBe(false);
  });

  it('extracts the destination from the default landing prompt', () => {
    expect(extractDestinationHint(DEFAULT_PROMPT)).toBe('Japan');
  });

  it('prefers "to <Place>" over "in <Place>"', () => {
    expect(extractDestinationHint('flying to New York in June')).toBe('New York');
  });

  it('falls back to "in <Place>" when no "to" phrase exists', () => {
    expect(extractDestinationHint('a quiet week in Kyoto')).toBe('Kyoto');
  });

  it('returns undefined when there is no plausible destination', () => {
    expect(extractDestinationHint('somewhere warm and cheap')).toBeUndefined();
  });
});
