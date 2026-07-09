// Dependency-free canvas confetti burst for celebratory moments (the finish
// screen). Self-contained: creates a fixed, click-through canvas, animates a
// short gravity burst in brand colors, then removes itself. Honors reduced-motion.
const COLORS = ['#FF5722', '#FFB300', '#10B981', '#06B6D4'];

interface Particle {
  x: number; y: number; vx: number; vy: number;
  size: number; color: string; rot: number; vrot: number;
}

export function fireConfetti(opts?: { count?: number; durationMs?: number }): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const count = opts?.count ?? 120;
  const duration = opts?.durationMs ?? 2200;

  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  document.body.appendChild(canvas);

  const originX = w / 2;
  const particles: Particle[] = Array.from({ length: count }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
    const speed = 6 + Math.random() * 9;
    return {
      x: originX + (Math.random() - 0.5) * 80,
      y: h * 0.35 + (Math.random() - 0.5) * 40,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.3,
    };
  });

  const start = performance.now();
  const GRAVITY = 0.22, DRAG = 0.99;

  function frame(t: number) {
    const elapsed = t - start;
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.vy += GRAVITY; p.vx *= DRAG; p.vy *= DRAG;
      p.x += p.vx; p.y += p.vy; p.rot += p.vrot;
      const fade = Math.max(0, 1 - elapsed / duration);
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
    if (elapsed < duration) {
      requestAnimationFrame(frame);
    } else {
      canvas.remove();
    }
  }
  requestAnimationFrame(frame);
}
