
import React, { useEffect, useRef } from 'react';

interface AntigravityBackgroundProps {
    density?: number;
    speed?: number;
    interactive?: boolean;
}

// Theme palette from tailwind.config.cjs
const COLORS = [
    '#fca5a5', // alert (pink)
    '#81d4fa', // marker-blue
    '#a5d6a7', // marker-green
    '#ce93d8', // marker-purple
    '#ffcc80', // marker-orange
];

interface Particle {
    x: number;
    y: number;
    size: number;
    speedY: number;
    opacity: number;
    pulseSpeed: number;
    pulseOffset: number;
    color: string;
}

const AntigravityBackground: React.FC<AntigravityBackgroundProps> = ({
    density = 100,
    speed = 1,
    interactive = true,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const particlesRef = useRef<Particle[]>([]);
    const animationFrameRef = useRef<number>();
    const mouseRef = useRef({ x: -1000, y: -1000 });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = window.innerWidth;
        let height = window.innerHeight;

        const resize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width;
            canvas.height = height;
            initParticles();
        };

        const initParticles = () => {
            particlesRef.current = [];
            const particleCount = Math.floor((width * height) / 10000) * (density / 50); // Responsive count based on area

            for (let i = 0; i < particleCount; i++) {
                particlesRef.current.push(createParticle(true));
            }
        };

        const createParticle = (randomY: boolean = false): Particle => {
            return {
                x: Math.random() * width,
                y: randomY ? Math.random() * height : height + 20, // Start just below screen if not random
                size: Math.random() * 3 + 1, // Increased size slightly for aesthetic bubbles
                speedY: (Math.random() * 0.5 + 0.2) * speed, // Uplift speed
                opacity: Math.random() * 0.4 + 0.1, // Lower blending opacity
                pulseSpeed: Math.random() * 0.02 + 0.01,
                pulseOffset: Math.random() * Math.PI * 2,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
            };
        };

        const updateParticles = () => {
            ctx.clearRect(0, 0, width, height);

            // Removed gradient background to show original grid

            particlesRef.current.forEach((p, index) => {
                // Move Upwards (Antigravity)
                p.y -= p.speedY;

                // Pulse Size/Opacity
                const pulse = Math.sin(Date.now() * 0.001 * p.pulseSpeed + p.pulseOffset);
                const currentOpacity = p.opacity + pulse * 0.1;

                // Reset if off top screen
                if (p.y < -10) {
                    particlesRef.current[index] = createParticle();
                }

                // Mouse Interaction (Repulsion/Attraction)
                if (interactive) {
                    const dx = p.x - mouseRef.current.x;
                    const dy = p.y - mouseRef.current.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const maxDistance = 200;

                    if (distance < maxDistance) {
                        const force = (maxDistance - distance) / maxDistance;
                        const angle = Math.atan2(dy, dx);
                        p.x += Math.cos(angle) * force * 2;
                        p.y += Math.sin(angle) * force * 2;
                    }
                }

                // Draw
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);

                // Parse hex to rgba for opacity control
                // Simple hex to rgb conversion for the defined palette
                const hex = p.color.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);

                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.max(0, currentOpacity)})`;
                ctx.fill();
            });
            animationFrameRef.current = requestAnimationFrame(updateParticles);
        };

        window.addEventListener('resize', resize);
        if (interactive) {
            window.addEventListener('mousemove', (e) => {
                mouseRef.current = { x: e.clientX, y: e.clientY };
            });
        }

        resize();
        updateParticles();

        return () => {
            window.removeEventListener('resize', resize);
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [density, speed, interactive]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                zIndex: -1,
                pointerEvents: 'none', // Allow clicks to pass through
            }}
        />
    );
};

export default AntigravityBackground;
