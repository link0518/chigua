import React from 'react';
import { roughBorderClassSm } from './SketchUI';

type SketchIconButtonVariant = 'default' | 'active';

export const SketchIconButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: React.ReactNode;
  variant?: SketchIconButtonVariant;
}>(({ label, icon, variant = 'default', className = '', ...props }, ref) => {
  const base = `inline-flex items-center justify-center gap-1 px-3 py-1 text-sm font-hand font-bold border-2 transition-all shadow-sketch ${roughBorderClassSm}`;
  const variants: Record<SketchIconButtonVariant, string> = {
    default: 'bg-white text-pencil border-gray-200 hover:border-ink hover:text-ink hover:bg-highlight/50 hover:-translate-y-0.5',
    active: 'bg-highlight text-ink border-ink -translate-y-0.5',
  };

  return (
    <button
      type="button"
      ref={ref}
      className={`${base} ${variants[variant]} ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
});

SketchIconButton.displayName = 'SketchIconButton';
