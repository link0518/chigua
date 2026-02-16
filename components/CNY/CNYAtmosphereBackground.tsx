
import React, { useEffect, useRef } from 'react';

interface CNYAtmosphereBackgroundProps {
    density?: number;
    speed?: number;
    interactive?: boolean;
}

// CNY Palette - Peach & Champagne with Red Accents
const COLORS = [
    '#FFCDD2', // Very Light Red / Pink
    '#EF5350', // Bright Red (Added for festive accent)
    '#FF5252', // Vibrant Red (Added)
    '#F8BBD0', // Light Pink
    '#FFE0B2', // Light Peach
    '#FFF9C4', // Cream / Light Yellow
    '#FFCC80', // Soft Orange
    '#FFFFFF', // Pure White (for sparkle)
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

const CNYAtmosphereBackground: React.FC<CNYAtmosphereBackgroundProps> = ({
    density = 60,
    speed = 0.5,
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
            const particleCount = Math.floor((width * height) / 15000) * (density / 50);

            for (let i = 0; i < particleCount; i++) {
                particlesRef.current.push(createParticle(true));
            }
        };

        const createParticle = (randomY: boolean = false): Particle => {
            const isGold = Math.random() > 0.6;
            return {
                x: Math.random() * width,
                y: randomY ? Math.random() * height : height + 20,
                // Smaller size: 1.5 to 4.5px (was 2 to 7px)
                size: Math.random() * 3 + 1.5,
                speedY: (Math.random() * 0.4 + 0.1) * speed,
                opacity: Math.random() * 0.4 + 0.1,
                pulseSpeed: Math.random() * 0.02 + 0.01,
                pulseOffset: Math.random() * Math.PI * 2,
                color: isGold ? '#FFD700' : COLORS[Math.floor(Math.random() * COLORS.length)],
            };
        };

        const updateParticles = () => {
            ctx.clearRect(0, 0, width, height);

            // Draw animated background gradient - cleaner, lighter
            const gradient = ctx.createLinearGradient(0, 0, 0, height);
            // Very subtle warm gradient, clean and bright
            gradient.addColorStop(0, '#ffffff');
            gradient.addColorStop(1, '#fffbf0');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, width, height);

            particlesRef.current.forEach((p, index) => {
                // Move Upwards
                p.y -= p.speedY;

                // Pulse Size/Opacity
                const pulse = Math.sin(Date.now() * 0.001 * p.pulseSpeed + p.pulseOffset);
                const currentOpacity = Math.max(0, Math.min(0.6, p.opacity + pulse * 0.1));

                // Reset height
                if (p.y < -20) {
                    particlesRef.current[index] = createParticle();
                }

                // Mouse Interaction
                if (interactive) {
                    const dx = p.x - mouseRef.current.x;
                    const dy = p.y - mouseRef.current.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    const maxDistance = 250;

                    if (distance < maxDistance) {
                        const force = (maxDistance - distance) / maxDistance;
                        const angle = Math.atan2(dy, dx);
                        // Gentle repulsion
                        p.x += Math.cos(angle) * force * 1.5;
                        p.y += Math.sin(angle) * force * 1.5;
                    }
                }

                // Draw - Crisp circles, no blur
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);

                // Parse hex for rgba
                const hex = p.color.replace('#', '');
                const r = parseInt(hex.substring(0, 2), 16);
                const g = parseInt(hex.substring(2, 4), 16);
                const b = parseInt(hex.substring(4, 6), 16);

                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${currentOpacity})`;
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
                pointerEvents: 'none',
            }}
        />
    );
};

export default CNYAtmosphereBackground;
