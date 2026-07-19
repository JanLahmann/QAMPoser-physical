/**
 * Celebrations — pocket binding of the shared Celebrations overlay (SC2).
 *
 * The canvas/banner engine lives in `@shared/display/Celebrations`; this binds
 * pocket's `pk-` class scheme and its confetti policy: a fixed cap (100, or the
 * low-power 60 the parent passes), kind-independent, used as both the per-burst
 * budget and the ceiling (docs/pocket.md).
 */
import { Celebrations as SharedCelebrations } from '@shared/display/Celebrations';
import type { CelebrationRequest } from '@shared/display/Celebrations';

export type { CelebrationRequest };

const MAX_PARTICLES = 100; // tablet budget (both Bell and GHZ)
export const LOW_POWER_PARTICLES = 60; // docs/pocket.md low-power confetti cap

export function Celebrations({
  celebration,
  maxParticles = MAX_PARTICLES,
}: {
  celebration: CelebrationRequest | null;
  maxParticles?: number;
}) {
  return (
    <SharedCelebrations
      celebration={celebration}
      classPrefix="pk"
      particleBudget={() => maxParticles}
      maxParticles={maxParticles}
    />
  );
}

export default Celebrations;
