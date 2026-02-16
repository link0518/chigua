import React from 'react';

// A utility for that "wobbly" border effect
export const roughBorderClass = "rounded-[255px_15px_225px_15px/15px_225px_15px_255px]";
export const roughBorderClassSm = "rounded-[25px_5px_22px_5px/5px_22px_5px_25px]";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  fullWidth?: boolean;
}

export const SketchButton: React.FC<ButtonProps> = ({ 
  children, 
  className = '', 
  variant = 'primary', 
  fullWidth = false,
  ...props 
}) => {
  const baseStyles = `font-hand font-bold text-lg transition-all transform active:scale-95 border-2 border-ink ${roughBorderClassSm}`;
  
  const variants = {
    primary: "bg-ink text-paper hover:bg-gray-800 shadow-sketch-lg hover:shadow-sketch hover:-translate-y-0.5",
    secondary: "bg-white text-ink hover:bg-gray-50 shadow-sketch hover:shadow-sketch-hover",
    danger: "bg-alert text-ink hover:bg-red-300 shadow-sketch",
    ghost: "bg-transparent border-transparent shadow-none hover:bg-gray-100/50"
  };

  return (
    <button 
      className={`${baseStyles} ${variants[variant]} ${fullWidth ? 'w-full' : ''} px-6 py-2 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

interface CardProps {
  children: React.ReactNode;
  className?: string;
  rotate?: boolean;
}

export const SketchCard: React.FC<CardProps> = ({ children, className = '', rotate = false }) => {
  return (
    <div 
      className={`bg-white border-2 border-ink shadow-sketch p-6 ${roughBorderClass} ${rotate ? 'rotate-1 hover:rotate-0 transition-transform duration-300' : ''} ${className}`}
    >
      {children}
    </div>
  );
};

export const Tape: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`h-8 w-32 bg-highlight/80 absolute -top-4 left-1/2 -translate-x-1/2 rotate-2 shadow-sm ${className}`}></div>
);

export const Badge: React.FC<{ children: React.ReactNode; color?: string }> = ({ children, color = 'bg-gray-100' }) => (
  <span className={`${color} border border-ink px-2 py-0.5 text-xs font-bold rounded-md transform -rotate-1 inline-flex items-center whitespace-nowrap shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]`}>
    {children}
  </span>
);
