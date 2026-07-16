import React from 'react';

interface FeaturedBadgeProps {
  className?: string;
  label?: string;
}

const FeaturedBadge: React.FC<FeaturedBadgeProps> = ({
  className = '',
  label = '精华',
}) => {
  const accessibleLabel = label.endsWith('帖子') ? label : `${label}帖子`;

  return (
    <span
      className={`featured-badge ${className}`}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <span className="featured-badge__seal" aria-hidden="true">精</span>
      <span className="featured-badge__label">{label}</span>
    </span>
  );
};

export default FeaturedBadge;
