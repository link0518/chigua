import React, { useEffect, useRef } from 'react';

interface CNYAtmosphereBackgroundProps {
  density?: number;
  speed?: number;
  interactive?: boolean;
}

type RgbColor = readonly [number, number, number];

const COLORS: readonly RgbColor[] = [
  [255, 205, 210],
  [239, 83, 80],
  [255, 82, 82],
  [248, 187, 208],
  [255, 224, 178],
  [255, 249, 196],
  [255, 204, 128],
  [255, 255, 255],
];
const GOLD: RgbColor = [255, 215, 0];

interface Particle {
  x: number;
  y: number;
  size: number;
  speedY: number;
  opacity: number;
  pulseSpeed: number;
  pulseOffset: number;
  color: RgbColor;
}

const CNYAtmosphereBackground: React.FC<CNYAtmosphereBackgroundProps> = ({
  density = 60,
  speed = 0.5,
  interactive = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = window.innerWidth;
    let height = window.innerHeight;
    let running = false;
    let backgroundGradient: CanvasGradient | null = null;

    const createParticle = (randomY = false): Particle => ({
      x: Math.random() * width,
      y: randomY ? Math.random() * height : height + 20,
      size: Math.random() * 3 + 1.5,
      speedY: (Math.random() * 0.4 + 0.1) * speed,
      opacity: Math.random() * 0.4 + 0.1,
      pulseSpeed: Math.random() * 0.02 + 0.01,
      pulseOffset: Math.random() * Math.PI * 2,
      color: Math.random() > 0.6
        ? GOLD
        : COLORS[Math.floor(Math.random() * COLORS.length)],
    });

    const initParticles = () => {
      const particleCount = Math.max(
        1,
        Math.round(Math.floor((width * height) / 15000) * (density / 50))
      );
      particlesRef.current = Array.from(
        { length: particleCount },
        () => createParticle(true)
      );
    };

    const drawScene = (timestamp: number, advance: boolean) => {
      ctx.clearRect(0, 0, width, height);

      ctx.fillStyle = backgroundGradient || '#fffbf0';
      ctx.fillRect(0, 0, width, height);

      particlesRef.current.forEach((currentParticle, index) => {
        let particle = currentParticle;
        if (advance) {
          particle.y -= particle.speedY;
          if (particle.y < -20) {
            particle = createParticle();
            particlesRef.current[index] = particle;
          }

          if (interactive) {
            const dx = particle.x - mouseRef.current.x;
            const dy = particle.y - mouseRef.current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const maxDistance = 250;

            if (distance < maxDistance) {
              const force = (maxDistance - distance) / maxDistance;
              const angle = Math.atan2(dy, dx);
              particle.x += Math.cos(angle) * force * 1.5;
              particle.y += Math.sin(angle) * force * 1.5;
            }
          }
        }

        const pulse = Math.sin(timestamp * 0.001 * particle.pulseSpeed + particle.pulseOffset);
        const currentOpacity = Math.max(0, Math.min(0.6, particle.opacity + pulse * 0.1));
        const [red, green, blue] = particle.color;

        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${currentOpacity})`;
        ctx.fill();
      });
    };

    const tick = (timestamp: number) => {
      if (!running) return;
      drawScene(timestamp, true);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };

    const start = () => {
      if (running || document.hidden || reducedMotionQuery.matches) return;
      running = true;
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    const syncAnimation = () => {
      if (document.hidden || reducedMotionQuery.matches) {
        stop();
        return;
      }
      start();
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
      backgroundGradient = ctx.createLinearGradient(0, 0, 0, height);
      backgroundGradient.addColorStop(0, '#ffffff');
      backgroundGradient.addColorStop(1, '#fffbf0');
      initParticles();
      drawScene(performance.now(), false);
    };

    const handleMouseMove = (event: MouseEvent) => {
      mouseRef.current = { x: event.clientX, y: event.clientY };
    };

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', syncAnimation);
    reducedMotionQuery.addEventListener('change', syncAnimation);
    if (interactive) {
      window.addEventListener('mousemove', handleMouseMove, { passive: true });
    }

    resize();
    syncAnimation();

    return () => {
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', syncAnimation);
      reducedMotionQuery.removeEventListener('change', syncAnimation);
      if (interactive) {
        window.removeEventListener('mousemove', handleMouseMove);
      }
    };
  }, [density, speed, interactive]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: -1,
        pointerEvents: 'none',
      }}
    />
  );
};

export default CNYAtmosphereBackground;
