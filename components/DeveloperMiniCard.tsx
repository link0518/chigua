import React from 'react';

type DeveloperMiniCardSize = 'sm' | 'md';

const SIZE_STYLES: Record<DeveloperMiniCardSize, { avatar: string; name: string; meta: string; padding: string }> = {
  sm: { avatar: 'size-12', name: 'text-sm', meta: 'text-[11px]', padding: 'px-2.5 py-1.5' },
  md: { avatar: 'size-16', name: 'text-xl', meta: 'text-xs', padding: 'px-3 py-2' },
};

const DeveloperMiniCard: React.FC<{ timestamp?: string; size?: DeveloperMiniCardSize; username?: string }> = ({
  timestamp = '',
  size = 'md',
  username = 'admin',
}) => {
  const styles = SIZE_STYLES[size];

  return (
    <div className={`inline-flex items-center gap-3 ${styles.padding} border-2 border-ink rounded-lg shadow-sketch bg-gradient-to-br from-marker-blue/20 via-white to-marker-purple/20`}>
      <div className={`${styles.avatar} relative rounded-full border-2 border-ink bg-white flex items-center justify-center shadow-sm overflow-hidden`}>
        <svg
          className="w-full h-full p-1 text-ink"
          viewBox="0 0 64 64"
          role="img"
          aria-label="小猫"
        >
          <circle cx="22" cy="28" r="5.5" className="fill-rose-200" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="42" cy="28" r="5.5" className="fill-rose-200" stroke="currentColor" strokeWidth="2.5" />
          <path
            d="M18 30
               Q14 34 14 40
               Q14 52 32 52
               Q50 52 50 40
               Q50 34 46 30
               Q40 24 32 24
               Q24 24 18 30Z"
            className="fill-white"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="26" cy="38" r="2.2" fill="currentColor" />
          <circle cx="38" cy="38" r="2.2" fill="currentColor" />
          <path
            d="M32 41 l-2 2 h4 l-2-2Z"
            className="fill-rose-400"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M30 44 Q32 46 34 44"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path d="M22 43 L14 41" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M22 46 L14 46" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M42 43 L50 41" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M42 46 L50 46" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`font-hand font-bold ${styles.name} text-ink leading-none truncate`}>{username}</span>
          <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-bold border border-ink rounded-full bg-highlight shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] leading-none whitespace-nowrap">
            开发者
          </span>
        </div>
        {timestamp && (
          <span className={`${styles.meta} text-gray-500 font-mono truncate`}>{timestamp}</span>
        )}
      </div>
    </div>
  );
};

export default DeveloperMiniCard;
