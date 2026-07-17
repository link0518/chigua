import React from 'react';

const HeaderDecoration: React.FC = () => {
  return (
    <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0 opacity-25">
      <svg
        className="absolute bottom-0 left-0 w-full h-12 text-cny-gold"
        viewBox="0 0 1440 48"
        preserveAspectRatio="none"
      >
        <path
          fill="currentColor"
          d="M0,48 L48,24 C96,0 192,0 240,24 C288,48 384,48 432,24 C480,0 576,0 624,24 C672,48 768,48 816,24 C864,0 960,0 1008,24 C1056,48 1152,48 1200,24 C1248,0 1344,0 1392,24 L1440,48 L1440,48 L0,48 Z"
        />
      </svg>
      <div className="absolute top-0 left-0 w-32 h-32 bg-[radial-gradient(circle_at_top_left,_rgba(255,215,0,0.55)_0%,_transparent_70%)] opacity-60" />
      <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle_at_top_right,_rgba(255,215,0,0.55)_0%,_transparent_70%)] opacity-60" />
    </div>
  );
};

export default HeaderDecoration;
