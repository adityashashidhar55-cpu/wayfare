/** Shared motion constants (design.md §7.1). */
export const EASE_EXPO = [0.22, 1, 0.36, 1] as [number, number, number, number];
export const EASE_SPRING_SOFT = [0.34, 1.4, 0.64, 1] as [number, number, number, number];

/** Framer Motion springs. */
export const SPRING_REORDER = { type: 'spring', stiffness: 380, damping: 30 } as const;
export const SPRING_PIN_POP = { type: 'spring', stiffness: 500, damping: 28 } as const;
export const SPRING_MODAL = { type: 'spring', stiffness: 260, damping: 26 } as const;
