// Lightweight, dependency-free pacing visualisation for the Stage Rail (change:
// v2.1-builder-shell-redesign). One mini SVG bar per task, height ∝ difficulty,
// coloured by interaction family — so a creator can read a stage's difficulty
// arc and type mix at a glance. No chart library; a handful of <rect>s.
import type { Task } from '@rushpoint/shared';
import { TYPE_FAMILY_COLOR } from '../lib/taskCardPreview';
import { useT } from './LanguageContext';

export default function PacingBar({ tasks, className = '' }: { tasks: Task[]; className?: string }) {
  const b = useT().builder;
  if (tasks.length === 0) return null;
  const W = 100, H = 16, gap = 1.5;
  const bw = Math.max(1, (W - gap * (tasks.length - 1)) / tasks.length);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={`w-full h-4 ${className}`}
      role="img"
      aria-label={b.pacingAriaLabel(tasks.length)}
    >
      {tasks.map((t, i) => {
        const d = Math.min(10, Math.max(1, t.difficulty));
        const h = (d / 10) * H;
        return (
          <rect
            key={t.id}
            x={i * (bw + gap)}
            y={H - h}
            width={bw}
            height={h}
            rx={0.5}
            fill={TYPE_FAMILY_COLOR[t.type]}
            opacity={0.85}
          >
            <title>{b.pacingTitle(t.title || b.untitledTask, t.difficulty)}</title>
          </rect>
        );
      })}
    </svg>
  );
}
