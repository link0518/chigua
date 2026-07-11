import React from 'react';
import { Heart } from 'lucide-react';

interface SiteFooterProps {
  isCnyTheme?: boolean;
}

const SiteFooter: React.FC<SiteFooterProps> = ({ isCnyTheme = false }) => {
  const year = new Date().getFullYear();
  const muted = isCnyTheme ? 'text-[#8D6E63]' : 'text-pencil';

  return (
    <footer
      className={`relative mt-auto w-full border-t ${
        isCnyTheme
          ? 'border-cny-dark-red/25 bg-[#FFF8E1]/90'
          : 'border-ink/15 bg-paper/90'
      }`}
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-1.5 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] text-center sm:flex-row sm:justify-between sm:gap-3 sm:text-left">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex size-5 items-center justify-center rounded-full border text-[10px] font-bold leading-none ${
              isCnyTheme
                ? 'border-cny-gold bg-cny-red text-cny-gold'
                : 'border-ink/70 bg-white text-ink'
            }`}
          >
            {isCnyTheme ? '福' : '瓜'}
          </span>
          <span className={`text-xs font-bold ${isCnyTheme ? 'text-cny-dark-red' : 'text-ink'}`}>
            JX3 瓜田
          </span>
          <span className={`hidden text-[11px] sm:inline ${muted}`}>
            · 纯匿名 · 理性吃瓜
          </span>
        </div>

        <p className={`inline-flex flex-wrap items-center justify-center gap-x-1.5 text-[11px] ${muted}`}>
          <span>© {year}</span>
          <span className="opacity-40">·</span>
          <span>用户投稿不代表本站立场</span>
          <span className="opacity-40">·</span>
          <span className="inline-flex items-center gap-0.5">
            Made with
            <Heart
              className={`h-3 w-3 ${
                isCnyTheme ? 'fill-cny-red text-cny-red' : 'fill-alert text-alert'
              }`}
            />
            by
            <span className={`font-bold ${isCnyTheme ? 'text-cny-dark-red' : 'text-ink'}`}>闰土</span>
          </span>
        </p>
      </div>
    </footer>
  );
};

export default SiteFooter;
