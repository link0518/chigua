import React from 'react';

type DeveloperMiniCardSize = 'sm' | 'md';

const SIZE_STYLES: Record<DeveloperMiniCardSize, { avatar: string; name: string; meta: string; padding: string; fontSize: string }> = {
  sm: { avatar: 'size-8 sm:size-9', name: 'text-xs sm:text-sm', meta: 'text-[10px]', padding: 'px-2 py-1 sm:px-2.5 sm:py-1.5', fontSize: 'text-base sm:text-lg' },
  md: { avatar: 'size-9 sm:size-11', name: 'text-sm sm:text-base', meta: 'text-[10px] sm:text-xs', padding: 'px-2.5 py-1.5 sm:px-3.5 sm:py-2', fontSize: 'text-lg sm:text-xl' },
};

const DeveloperMiniCard: React.FC<{ timestamp?: string; size?: DeveloperMiniCardSize; username?: string }> = ({
  timestamp = '',
  size = 'md',
  username = '闰土',
}) => {
  const styles = SIZE_STYLES[size];

  return (
    <div className={`group relative inline-flex max-w-full items-center gap-2 sm:gap-3 ${styles.padding} transition-all duration-300 ease-out hover:-translate-y-1`}>
      {/* Glass Background - Dopamine Style */}
      <div className="absolute inset-0 rounded-xl bg-white/70 backdrop-blur-md border border-white/60 shadow-[0_8px_16px_-6px_rgba(255,105,180,0.15)] ring-1 ring-pink-400/20 transition-all duration-300 group-hover:bg-white/90 group-hover:shadow-[0_12px_24px_-8px_rgba(255,105,180,0.25)] group-hover:ring-pink-400/30 overflow-hidden">
        {/* Candy Shine Gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-yellow-300/20 via-pink-400/20 to-cyan-300/20 opacity-100" />
        <div className="absolute inset-0 -left-[100%] w-[50%] bg-gradient-to-r from-transparent via-white/50 to-transparent skew-x-[-20deg] animate-shimmer" />
      </div>

      {/* Avatar with Vibrant Gradient Fill and "Gua" Character */}
      <div className={`relative ${styles.avatar} shrink-0 rounded-xl p-0 shadow-lg ring-2 ring-white/50 overflow-hidden`}>
        {/* Pastel Macaron Gradient - Light Tone */}
        <div className="w-full h-full bg-gradient-to-br from-pink-300 via-purple-300 to-cyan-300 flex items-center justify-center">
          <span className={`font-sans font-black text-white ${styles.fontSize} leading-none select-none drop-shadow-[0_2px_2px_rgba(0,0,0,0.2)] transform -translate-y-[1px]`}>
            瓜
          </span>
        </div>
      </div>

      {/* Text Info */}
      <div className="relative flex flex-col min-w-0">
        <div className="flex items-center gap-2">
          <span className={`font-sans font-bold ${styles.name} text-slate-800 leading-none truncate tracking-tight`}>
            {username}
          </span>
          <span className="inline-flex shrink-0 items-center whitespace-nowrap px-1.5 py-0.5 text-[9px] sm:px-2 sm:text-[10px] font-bold tracking-wider text-white rounded-full bg-gradient-to-r from-lime-500 to-emerald-500 shadow-sm leading-none transform translate-y-[1px]">
            开发者
          </span>
        </div>
        {timestamp && (
          <span className={`${styles.meta} text-slate-400 font-medium font-sans truncate mt-0.5`}>
            {timestamp}
          </span>
        )}
      </div>
    </div>
  );
};

export default DeveloperMiniCard;
