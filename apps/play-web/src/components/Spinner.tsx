import { useT } from '../i18nContext';

// Shared branded loading ring. Screen-reader users get a spoken status via
// role="status" + an sr-only translated label; the ring itself is aria-hidden
// so it is not announced twice. Mirrors the correct pattern at
// FinalScreen.tsx (ring aria-hidden + a labelled status). Uses NO
// physical-direction classes so scripts/test-play-a11y-scan.ts stays green.
const RING_SIZE = {
  md: 'w-8 h-8',
  lg: 'w-10 h-10',
} as const;

export function Spinner({ size = 'md', label }: { size?: keyof typeof RING_SIZE; label?: string }) {
  const { t } = useT();
  return (
    <div role="status" className="inline-flex items-center justify-center">
      <span
        aria-hidden="true"
        className={`${RING_SIZE[size]} rounded-full border-2 border-rp-fire/30 border-t-rp-fire animate-spin`}
      />
      <span className="sr-only">{label ?? t.common.loading}</span>
    </div>
  );
}

export default Spinner;
