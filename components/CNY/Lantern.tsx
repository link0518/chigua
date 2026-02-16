import React from 'react';

interface LanternProps {
  size?: number;
  color?: string;
  delay?: number;
  className?: string;
}

const Lantern: React.FC<LanternProps> = ({
  size = 60,
  color = 'bg-cny-red',
  delay = 0,
  className = '',
}) => {
  const bodyStyle = {
    width: size,
    height: size * 0.85,
  };

  return (
    <div
      className={`relative flex flex-col items-center animate-swing ${className}`}
      style={{ animationDelay: `${delay}s` }}
    >
      <div className="w-[1px] h-20 bg-cny-gold/60 -mb-1 z-10" />
      <div className="relative z-20" style={bodyStyle}>
        <div className={`absolute inset-0 ${color} rounded-[2rem] shadow-[0_0_15px_rgba(211,47,47,0.4)] opacity-95`} />
        <div className="absolute inset-0 rounded-[2rem] bg-gradient-to-r from-black/20 via-transparent to-black/20" />
        <div className="absolute inset-x-4 top-4 bottom-4 bg-gradient-to-br from-cny-gold/30 to-transparent rounded-xl blur-md" />
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1/3 h-2 bg-cny-gold rounded-full shadow-sm" />
        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1/3 h-2 bg-cny-gold rounded-full shadow-sm" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="size-8 border border-cny-gold/40 rotate-45 flex items-center justify-center bg-cny-red shadow-inner">
            <span className="text-cny-gold text-xs font-serif -rotate-45">春</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center -mt-0.5 z-10">
        <div className="w-0.5 h-16 bg-gradient-to-b from-cny-gold to-cny-red/80" />
        <div className="w-1.5 h-1.5 rounded-full bg-cny-gold -mt-1 shadow-[0_0_5px_currentColor]" />
      </div>
    </div>
  );
};

export default Lantern;
