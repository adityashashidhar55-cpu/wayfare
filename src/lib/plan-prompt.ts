/**
 * Plan-prompt handoff (r23-design): the landing glass card collects a free
 * text trip prompt. "Plan My Trip" routes into the existing create-trip flow
 * (/trips?new=1&dest=...). Because that flow is login-gated and the auth
 * redirect drops query params, the raw prompt is stashed in sessionStorage
 * and resumed on the Trips page after sign-in.
 */

const PROMPT_KEY = 'wayfare:planPrompt';
const IMPORT_KEY = 'wayfare:openImport';

export const DEFAULT_PROMPT =
  "I'm planning a 7-day trip to Japan in October. I love food, hidden cafes, scenic hikes, and want to avoid crowds....";

/** Stash the raw prompt so it survives the login redirect. */
export function savePlanPrompt(text: string): void {
  try {
    sessionStorage.setItem(PROMPT_KEY, text);
  } catch {
    /* storage unavailable (private mode etc.) - the URL hint still works */
  }
}

/** Read and clear the stashed prompt (one-shot resume). */
export function consumePlanPrompt(): string | null {
  try {
    const v = sessionStorage.getItem(PROMPT_KEY);
    if (v) sessionStorage.removeItem(PROMPT_KEY);
    return v;
  } catch {
    return null;
  }
}

/** Flag that the social-import modal should open once Trips mounts. */
export function saveImportRequest(): void {
  try {
    sessionStorage.setItem(IMPORT_KEY, '1');
  } catch {
    /* non-fatal */
  }
}

export function consumeImportRequest(): boolean {
  try {
    const v = sessionStorage.getItem(IMPORT_KEY);
    if (v) sessionStorage.removeItem(IMPORT_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

/**
 * Pull a short destination hint out of a free-text prompt for the
 * create-trip modal's destination prefill. Prefers "to <Place>", falls back
 * to "in <Place>"; only capitalized words are captured so months and common
 * nouns stay out. Returns undefined when nothing plausible is found.
 */
export function extractDestinationHint(prompt: string): string | undefined {
  const word = "[A-Z][A-Za-z'\\-.]*";
  const place = `(${word}(?:\\s+${word}){0,2})`;
  const to = new RegExp(`\\bto\\s+${place}`).exec(prompt);
  if (to?.[1]) return to[1];
  const inMatch = new RegExp(`\\bin\\s+${place}`).exec(prompt);
  if (inMatch?.[1]) return inMatch[1];
  return undefined;
}
