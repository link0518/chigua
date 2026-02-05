import React from 'react';
import { roughBorderClassSm } from './SketchUI';
import { Loader2 } from 'lucide-react';

type SketchIconButtonVariant = 'default' | 'active' | 'doodle';

export const SketchIconButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: React.ReactNode;
  variant?: SketchIconButtonVariant;
  iconOnly?: boolean;
}>(({ label, icon, variant = 'default', iconOnly = false, className = '', ...props }, ref) => {
  const base = `inline-flex items-center justify-center gap-1 px-3 py-1 text-sm font-hand font-bold border-2 transition-all shadow-sketch ${roughBorderClassSm}`;
  const variants: Record<SketchIconButtonVariant, string> = {
    default: 'bg-white text-pencil border-gray-200 hover:border-ink hover:text-ink hover:bg-highlight/50 hover:-translate-y-0.5',
    active: 'bg-highlight text-ink border-ink -translate-y-0.5',
    doodle: 'bg-white text-ink border-2 border-ink shadow-sketch hover:bg-highlight hover:-translate-y-0.5',
  };

  const isDisabled = Boolean(props.disabled);

  return (
    <button
      type="button"
      ref={ref}
      className={`${base} ${variants[variant]} ${isDisabled ? 'opacity-60 cursor-not-allowed hover:-translate-y-0' : ''} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      <span className="relative inline-flex">
        <span className={isDisabled ? 'opacity-70' : ''}>
          {icon}
        </span>
        {isDisabled ? (
          <Loader2 className="absolute -right-2 -top-2 w-3.5 h-3.5 text-ink animate-spin" aria-hidden="true" />
        ) : null}
      </span>
      {iconOnly ? null : <span>{label}</span>}
    </button>
  );
});

SketchIconButton.displayName = 'SketchIconButton';
