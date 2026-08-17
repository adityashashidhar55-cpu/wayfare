import { useCallback } from "react";
import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "../../../api/router";
import { trpc } from "@/providers/trpc";
import { useToast } from "../workspace/Toasts";

/** Input contract of explore.addPlace (crowdsourced place submission). */
export type SavePlaceInput =
  inferRouterInputs<AppRouter>["explore"]["addPlace"];

/** Stable key for "did we already save this row" UI state. */
export function placeKey(p: { name: string; lat: number; lng: number }): string {
  return `${p.name.trim().toLowerCase()}@${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
}

export type SaveOutcome = "saved" | "exists";

/**
 * Shared "Save to library" flow (explore.addPlace): success + conflict
 * toasts, explore-query invalidation so the corpus/map layers refresh, and
 * an outcome callback so the caller can flip the row into its In-library
 * state. A dedupe conflict is treated as success-ish ("exists").
 */
export function useSaveToLibrary() {
  const utils = trpc.useUtils();
  const { push } = useToast();
  const mutation = trpc.explore.addPlace.useMutation();

  const save = useCallback(
    (input: SavePlaceInput, onDone?: (outcome: SaveOutcome) => void) => {
      mutation.mutate(input, {
        onSuccess: res => {
          void utils.explore.invalidate();
          if (res.conflict) {
            push({
              title: "Already in your places",
              description: res.existing.name,
              kind: "info",
            });
            onDone?.("exists");
          } else {
            push({
              title: "Submitted for review, it'll appear for everyone once approved.",
              description: input.name,
              kind: "success",
            });
            onDone?.("saved");
          }
        },
        onError: e =>
          push({
            title: "Could not save place",
            description: e.message,
            kind: "danger",
          }),
      });
    },
    [mutation, utils, push]
  );

  return { save, isPending: mutation.isPending };
}
