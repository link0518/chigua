import React, { CSSProperties, useEffect, useState } from 'react';

interface FallingItem {
  id: number;
  type: 'envelope' | 'coin';
  left: number;
  delay: number;
  duration: number;
  drift: number;
  scale: number;
  rotation: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const createFallingItems = (count = 18): FallingItem[] => {
  const seedOffset = Math.random() > 0.5 ? 1 : 0;
  return Array.from({ length: count }).map((_, index) => {
    const band = ((index + 0.5) / count) * 100;
    const jitter = (Math.random() - 0.5) * 10;
    return {
      id: index,
      // 交替类型，保证左右区域都能出现红包和金币
      type: (index + seedOffset) % 2 === 0 ? 'envelope' : 'coin',
      left: clamp(band + jitter, 2, 98),
      delay: Math.random() * 6,
      duration: 6 + Math.random() * 6,
      drift: Math.random() * 80 - 40,
      scale: 0.6 + Math.random() * 0.3, // 随机大小 0.6x - 0.9x
      rotation: Math.random() * 360,
    };
  });
};

// 现代简约风格的SVG红包组件
const RedPacketSVG: React.FC = () => (
  <svg width="24" height="30" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-sm">
    {/* 主体 - 更加鲜艳的渐变红 */}
    <rect x="0" y="0" width="24" height="30" rx="4" fill="url(#rp-modern-grad)" />

    {/* 极简封盖 - 也就是一个简单的半圆弧或折线 */}
    <path d="M0 8 C 8 14, 16 14, 24 8" stroke="#FFEeb0" strokeWidth="1" fill="none" opacity="0.5" />

    {/* 装饰 - 居中一个简单的金色圆点, 代表封口 */}
    <circle cx="12" cy="14" r="3" fill="#FCEE21" />
    <circle cx="12" cy="14" r="3" fill="url(#gold-modern-grad)" />

    <defs>
      <linearGradient id="rp-modern-grad" x1="0" y1="0" x2="24" y2="30" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FF6B6B" />
        <stop offset="100%" stopColor="#EE5253" />
      </linearGradient>
      <linearGradient id="gold-modern-grad" x1="9" y1="11" x2="15" y2="17" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FFF8C9" />
        <stop offset="100%" stopColor="#FFD700" />
      </linearGradient>
    </defs>
  </svg>
);

// 金元宝 SVG 组件
const GoldIngotSVG: React.FC = () => (
  <svg width="36" height="36" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" className="drop-shadow-md">
    {/* 实心金色圆形底色 */}
    <circle cx="512" cy="560" r="420" fill="#FFD700" />
    {/* 主体轮廓 — 用深金色在亮底上形成对比 */}
    <path d="M938.4 461.8c-37-34.6-117.4-30.1-228.7-22.6-31.9-78-108.5-133.2-197.9-133.2-57 0-110.6 22.2-151 62.5-20.5 20.5-36.4 44.5-47 70.6-111.2-7.5-191.6-12-228.6 22.6-13.6 12.7-20.5 29.6-20.5 50.2 0 60.3 11.8 118.9 35.1 174 22.5 53.2 54.7 101 95.8 142.1 41 41 88.8 73.3 142.1 95.8 55.1 23.3 113.7 35.1 174 35.1s118.9-11.8 174-35.1c53.2-22.5 101-54.7 142.1-95.8 41-41 73.3-88.8 95.8-142.1 23.3-55.1 35.1-113.7 35.1-174 0.1-20.5-6.8-37.4-20.3-50.1zM112.6 491c10.5-9.9 33.9-15.5 69.6-16.8 5.9-0.2 12.1-0.3 18.6-0.3 29.2 0 63.3 2 101.5 4.6-2.6 13.4-3.9 27.1-3.9 41 0 24.7 4.2 48.9 12.4 71.9 2.9 8.2 10.6 13.3 18.8 13.3 2.2 0 4.5-0.4 6.7-1.2 10.4-3.7 15.8-15.2 12.1-25.6-6.7-18.7-10.1-38.4-10.1-58.4 0-95.7 77.8-173.5 173.5-173.5s173.5 77.8 173.5 173.5c0 17.6-2.6 35-7.8 51.6-3.3 10.5 2.6 21.8 13.2 25 10.5 3.3 21.8-2.6 25-13.2 6.4-20.5 9.6-41.8 9.6-63.5 0-14-1.4-27.7-4-41 46.6-3.1 87.2-5.5 120.1-4.3 35.6 1.3 59 6.9 69.6 16.8 3.6 3.4 7.8 8.8 7.8 21 0 37.3-41 75.4-112.6 104.5-78.3 32-182.8 49.6-294.4 49.6s-216.1-17.6-294.4-49.5c-71.6-29.2-112.6-67.3-112.6-104.5 0-12.2 4.2-17.6 7.8-21z m687 308.8c-37.4 37.4-80.9 66.7-129.4 87.2-50.2 21.2-103.5 32-158.4 32s-108.3-10.8-158.4-32c-48.5-20.5-92-49.8-129.4-87.2s-66.7-80.9-87.2-129.4c-9.2-21.7-16.4-44-21.7-66.8 22.2 18.5 51.5 35.4 87.2 50 83 33.8 192.9 52.4 309.5 52.4s226.5-18.6 309.5-52.4c35.7-14.6 65-31.4 87.2-50-5.2 22.8-12.5 45.1-21.7 66.8-20.4 48.5-49.8 92-87.2 129.4z" fill="#B8860B" />
    {/* 内部装饰 — 亮金色 */}
    <path d="M619.1 660.4l-55.8-55.8 57.2-57.2 57.2 57.2-55.3 55.4c33.2-3.7 65-9 94.8-15.9 5-12.2 7.8-25.5 7.8-39.5 0-57.6-46.7-104.4-104.4-104.4S516.2 547 516.2 604.6c0 22.8 7.3 43.9 19.7 61.1 28.4-0.6 56.2-2.4 83.2-5.3z" fill="#FFF176" />
    <path d="M717.7 644c32-7.4 61.8-16.6 88.5-27.5 8.2-3.3 16-6.8 23.3-10.3 3.5-8.8 5.4-18.4 5.4-28.5 0-42.8-34.7-77.4-77.4-77.4s-77.4 34.7-77.4 77.4c0.1 28.1 15.1 52.8 37.6 66.3z m39.9-108.8l42.5 42.5-42.5 42.5-42.5-42.5 42.5-42.5zM240.6 286.2L171.1 233c-7.3-5.6-8.5-16.2-2.7-23.3 1.9-2.3 3.8-4.6 5.8-6.9 6-7 16.7-7.6 23.4-1.3l64.1 59.6c6.4 5.9 7 15.8 1.3 22.4-0.1 0.1-0.1 0.2-0.2 0.2-5.5 6.8-15.3 7.8-22.2 2.5z m517.8-4.8c-0.1-0.1-0.1-0.2-0.2-0.2-5.7-6.6-5.2-16.5 1.1-22.4l63.5-60.2c6.7-6.3 17.3-5.9 23.4 1.1 2 2.3 3.9 4.5 5.9 6.8 6 7.1 4.8 17.6-2.4 23.3l-69 53.9c-6.8 5.2-16.6 4.2-22.3-2.3z m-361-109.7l-29.3-82.6c-3.1-8.7 1.7-18.2 10.5-21 2.9-0.9 5.8-1.8 8.6-2.6 8.9-2.6 18.1 2.7 20.3 11.7l21.2 85c2.1 8.4-2.8 17-11.1 19.5-0.1 0-0.2 0.1-0.3 0.1-8.2 2.5-17-2-19.9-10.1z m205.5 9.2c-0.1 0-0.2-0.1-0.3-0.1-8.3-2.4-13.3-10.9-11.2-19.4l20.4-85.2c2.2-9 11.3-14.3 20.2-11.8 2.9 0.8 5.8 1.7 8.6 2.5 8.8 2.7 13.7 12.1 10.7 20.9l-28.6 82.8c-2.8 8.2-11.5 12.7-19.8 10.3z" fill="#FFF176" />
  </svg>
);

const FallingDecorations: React.FC = () => {
  const [items, setItems] = useState<FallingItem[]>(() => createFallingItems());

  useEffect(() => {
    // 初始设置
    setItems(createFallingItems());

    const timer = window.setInterval(() => {
      setItems(createFallingItems());
    }, 9000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes cny-fall {
              0% { transform: translate3d(0, -10vh, 0) rotate(var(--cny-rot-start, 0deg)) scale(var(--cny-scale, 1)); opacity: 0; }
              10% { opacity: 0.9; }
              90% { opacity: 0.9; }
              100% { transform: translate3d(var(--cny-drift, 0px), 110vh, 0) rotate(var(--cny-rot-end, 360deg)) scale(var(--cny-scale, 1)); opacity: 0; }
            }
          `,
        }}
      />
      {items.map((item) => {
        const style = {
          left: `${item.left}%`,
          animation: `cny-fall ${item.duration}s linear infinite`,
          animationDelay: `${item.delay}s`,
          '--cny-drift': `${item.drift}px`,
          '--cny-scale': item.scale * 0.9, // 整体再稍微缩小一点
          '--cny-rot-start': `${item.rotation}deg`,
          '--cny-rot-end': `${item.rotation + 360}deg`,
        } as CSSProperties;

        return (
          <div key={item.id} className="absolute top-0 will-change-transform" style={style}>
            {item.type === 'envelope' ? (
              <RedPacketSVG />
            ) : (
              <GoldIngotSVG />
            )}
          </div>
        );
      })}
    </div>
  );
};

export default FallingDecorations;

