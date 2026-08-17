/**
 * Onboarding welcome illustration - the /onb-compass.svg artwork inlined so
 * the line draw-in on load (strokes dashoffset, 800ms staggered) can run
 * (onboarding.md §S0). Brand needle + orbit pin fade in last.
 */
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

function draw(delay: number, duration = 0.8) {
  return {
    initial: { pathLength: 0, opacity: 0 },
    animate: { pathLength: 1, opacity: 1 },
    transition: { duration, delay, ease: EASE },
  };
}

export default function CompassIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 240"
      fill="none"
      role="img"
      aria-label="Compass illustration"
      className={cn('h-auto w-60', className)}
    >
      {/* surface-2 blob backdrop */}
      <motion.path
        d="M160 30 C216 30 268 66 272 116 C276 164 228 208 158 208 C92 208 46 170 48 114 C50 62 102 30 160 30 Z"
        fill="var(--ink-3)"
        fillOpacity={0.08}
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
        style={{ transformOrigin: '160px 120px' }}
      />
      <g stroke="var(--ink-3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        {/* orbiting dashed route (fades in to preserve the dash pattern) */}
        <motion.ellipse
          cx={160}
          cy={120}
          rx={104}
          ry={44}
          transform="rotate(-16 160 120)"
          strokeDasharray="1.5 8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
        />
        {/* compass body */}
        <motion.circle cx={160} cy={120} r={56} {...draw(0.25)} />
        <motion.circle cx={160} cy={120} r={46} strokeOpacity={0.45} {...draw(0.35)} />
        {/* tick marks */}
        <motion.path d="M160 70 L160 78" {...draw(0.5, 0.3)} />
        <motion.path d="M160 162 L160 170" {...draw(0.54, 0.3)} />
        <motion.path d="M110 120 L118 120" {...draw(0.58, 0.3)} />
        <motion.path d="M202 120 L210 120" {...draw(0.62, 0.3)} />
        <motion.path d="M125 85 L130 90" {...draw(0.66, 0.3)} />
        <motion.path d="M190 150 L195 155" {...draw(0.7, 0.3)} />
        <motion.path d="M195 85 L190 90" {...draw(0.74, 0.3)} />
        <motion.path d="M130 150 L125 155" {...draw(0.78, 0.3)} />
        {/* 8-point star */}
        <motion.path d="M160 84 L166 114 L196 120 L166 126 L160 156 L154 126 L124 120 L154 114 Z" {...draw(0.82)} />
      </g>
      {/* brand-colored needle (pointing NE) */}
      <g stroke="var(--brand)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <motion.path
          d="M160 120 L186 94 L168 124 Z"
          fill="var(--brand)"
          fillOpacity={0.14}
          {...draw(1.0, 0.5)}
        />
        <motion.path d="M160 120 L134 146 L152 116 Z" {...draw(1.05, 0.5)} />
        <motion.circle
          cx={160}
          cy={120}
          r={4}
          fill="var(--brand)"
          stroke="none"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 1.2, type: 'spring', stiffness: 500, damping: 28 }}
          style={{ transformOrigin: '160px 120px' }}
        />
      </g>
      {/* orbit pins */}
      <motion.circle cx={66} cy={141} r={3} stroke="var(--ink-3)" strokeWidth={2} {...draw(1.1, 0.4)} />
      <motion.circle
        cx={252}
        cy={94}
        r={3}
        fill="var(--brand)"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 1.25, type: 'spring', stiffness: 500, damping: 28 }}
        style={{ transformOrigin: '252px 94px' }}
      />
    </svg>
  );
}
