import { motion, useReducedMotion } from "framer-motion";

/**
 * Pulsing user-location dot - rendered inside a MapLibre HTML marker via
 * createPortal (same pattern as the itinerary pins in MapPane). Info-blue so
 * it reads as "you" rather than a day pin or a search marker.
 */
export function UserLocationDot() {
  const reduceMotion = useReducedMotion();
  return (
    <div className="relative flex h-5 w-5 items-center justify-center">
      {reduceMotion ? null : (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{
            background: "color-mix(in srgb, var(--info) 45%, transparent)",
          }}
          initial={{ scale: 1, opacity: 0.7 }}
          animate={{ scale: 2.8, opacity: 0 }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
          }}
        />
      )}
      <span
        className="relative flex h-5 w-5 items-center justify-center rounded-full"
        style={{
          background: "var(--info)",
          boxShadow:
            "0 0 0 3px var(--surface), 0 0 0 5px color-mix(in srgb, var(--info) 40%, transparent), var(--shadow-md)",
        }}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-white" />
      </span>
    </div>
  );
}
