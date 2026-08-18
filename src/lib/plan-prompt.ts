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
 * r29: destination extraction now lives in @contracts/trip-prompt, which
 * parses the WHOLE sentence rather than just the place name.
 *
 * The old implementation here ran two regexes, returned the destination and
 * discarded everything else - so "7-day trip to Japan, love food, avoid
 * crowds" reached the planner as `dest=Japan`. Duration, interests and the
 * negation were thrown away, which meant the headline feature of the landing
 * page did nothing beyond prefilling one text box.
 *
 * Re-exported here so existing imports keep working.
 */
export { extractDestination as extractDestinationHintRaw } from '@contracts/trip-prompt';
import { parseTripPrompt, extractDestination } from '@contracts/trip-prompt';

/** Back-compat shim: the old signature returned `undefined`, not `null`. */
export function extractDestinationHint(prompt: string): string | undefined {
  return extractDestination(prompt) ?? undefined;
}

/** The full parse. Prefer this - it is what makes the prompt actually count. */
export function parsePrompt(prompt: string) {
  return parseTripPrompt(prompt);
}
