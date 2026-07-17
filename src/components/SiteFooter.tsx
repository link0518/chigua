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
      <div className="mx-auto flex max-w-3xl flex-nowrap items-center justify-center gap-x-1.5 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] text-[10px] leading-none sm:justify-between sm:gap-3 sm:text-[11px] sm:text-left">
        <div className="flex min-w-0 flex-nowrap items-center gap-1.5 sm:gap-2">
          <span
            className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold leading-none ${
              isCnyTheme
                ? 'border-cny-gold bg-cny-red text-cny-gold'
                : 'border-ink/70 bg-white text-ink'
            }`}
          >
            {isCnyTheme ? '福' : '瓜'}
          </span>
          <span className={`whitespace-nowrap text-xs font-bold ${isCnyTheme ? 'text-cny-dark-red' : 'text-ink'}`}>
            JX3 瓜田
          </span>
          <span className={`hidden whitespace-nowrap sm:inline ${muted}`}>
            · 纯匿名 · 理性吃瓜
          </span>
        </div>

        <span className={`opacity-40 sm:hidden ${muted}`}>·</span>

        <p className={`inline-flex flex-nowrap items-center gap-x-1.5 whitespace-nowrap ${muted}`}>
          <span>© {year}</span>
          <span className="hidden opacity-40 sm:inline">·</span>
          <span className="hidden sm:inline">用户投稿不代表本站立场</span>
          <span className="opacity-40">·</span>
          <span className="inline-flex items-center gap-0.5">
            <span className="hidden sm:inline">Made with</span>
            <Heart
              className={`h-3 w-3 shrink-0 ${
                isCnyTheme ? 'fill-cny-red text-cny-red' : 'fill-alert text-alert'
              }`}
            />
            <span className="hidden sm:inline">by</span>
            <span className={`font-bold ${isCnyTheme ? 'text-cny-dark-red' : 'text-ink'}`}>闰土</span>
          </span>
        </p>
      </div>
    </footer>
  );
};

export default SiteFooter;
