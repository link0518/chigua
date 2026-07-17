import React from 'react';
import CNYAtmosphereBackground from './CNYAtmosphereBackground';
import FallingDecorations from './FallingDecorations';
import Lantern from './Lantern';

interface CNYVisualEffectsProps {
  compact?: boolean;
}

/**
 * 新春主题的动态装饰统一放在一个异步分包中，避免主题未开启时进入首屏主包。
 */
const CNYVisualEffects: React.FC<CNYVisualEffectsProps> = ({ compact = false }) => (
  <>
    <FallingDecorations count={compact ? 10 : 18} />
    <CNYAtmosphereBackground
      density={compact ? 36 : 80}
      speed={0.5}
      interactive={!compact}
    />
    <div className="fixed top-0 left-4 z-40 hidden md:block pointer-events-none">
      <Lantern size={78} delay={0.3} />
    </div>
    <div className="fixed top-0 right-4 z-40 hidden lg:block pointer-events-none">
      <Lantern size={72} delay={1.1} />
    </div>
  </>
);

export default CNYVisualEffects;
