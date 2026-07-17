import React, { useEffect, useMemo, useRef } from 'react';
import { SketchButton, roughBorderClassSm } from './SketchUI';

type ConfettiPiece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rotation: number;
  vr: number;
  color: string;
  opacity: number;
};

const COLORS = ['#fca5a5', '#fff59d', '#81d4fa', '#a5d6a7', '#ce93d8', '#ffcc80'];

const StreakCelebration: React.FC<{
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  durationMs?: number;
}> = ({ open, onClose, title = '连续登录 7 天！', subtitle = '谢谢你每天都来吃瓜～', durationMs = 4500 }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const piecesRef = useRef<ConfettiPiece[]>([]);

  const shouldReduceMotion = useMemo(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      onClose();
    }, Math.max(1200, durationMs));
    return () => window.clearTimeout(timer);
  }, [open, durationMs, onClose]);

  useEffect(() => {
    if (!open) return;
    if (shouldReduceMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const width = () => canvas.width;
    const height = () => canvas.height;
    const count = Math.min(Math.max(Math.floor(width() / 8), 120), 220);

    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

    piecesRef.current = Array.from({ length: count }).map(() => ({
      x: rand(0, width()),
      y: rand(-height() * 0.8, -20),
      vx: rand(-0.6, 0.6),
      vy: rand(1.2, 3.6),
      w: rand(6, 11),
      h: rand(10, 18),
      rotation: rand(0, Math.PI * 2),
      vr: rand(-0.08, 0.08),
      color: pick(COLORS),
      opacity: rand(0.75, 1),
    }));

    const gravity = 0.06;
    const drift = 0.002;

    const draw = () => {
      ctx.clearRect(0, 0, width(), height());
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      for (const piece of piecesRef.current) {
        piece.vy += gravity;
        piece.vx += Math.sin(piece.y * drift) * 0.02;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rotation += piece.vr;

        if (piece.y > height() + 30) {
          piece.y = rand(-120, -20);
          piece.x = rand(0, width());
          piece.vy = rand(1.2, 3.6);
          piece.vx = rand(-0.6, 0.6);
          piece.rotation = rand(0, Math.PI * 2);
        }
        if (piece.x < -30) piece.x = width() + 30;
        if (piece.x > width() + 30) piece.x = -30;

        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.rotation);
        ctx.globalAlpha = piece.opacity;
        ctx.fillStyle = piece.color;
        ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
        ctx.restore();
      }
      ctx.restore();
      rafRef.current = window.requestAnimationFrame(draw);
    };

    rafRef.current = window.requestAnimationFrame(draw);
    return () => {
      window.removeEventListener('resize', resize);
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [open, shouldReduceMotion]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {!shouldReduceMotion && (
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      )}

      <div className={`relative mx-4 w-full max-w-md bg-white border-2 border-ink shadow-sketch p-6 text-center ${roughBorderClassSm}`}>
        <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-highlight border-2 border-ink shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] rounded-full font-hand font-bold">
          彩蛋解锁
        </div>
        <div className="text-5xl mb-3">🎉</div>
        <h3 className="font-display text-2xl text-ink">{title}</h3>
        <p className="mt-2 text-sm text-pencil font-sans">{subtitle}</p>
        <div className="mt-5 flex justify-center">
          <SketchButton type="button" className="h-10 px-6 text-sm" onClick={onClose}>
            收下祝福
          </SketchButton>
        </div>
        <p className="mt-3 text-[11px] text-pencil/60 font-sans">
          只会庆祝一次，不会打扰你～
        </p>
      </div>
    </div>
  );
};

export default StreakCelebration;

