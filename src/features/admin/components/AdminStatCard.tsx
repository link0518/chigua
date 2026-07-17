import React from 'react';
import { roughBorderClassSm } from '@/components/SketchUI';

interface AdminStatCardProps {
  title: string;
  value: string;
  trend: string;
  trendUp: boolean;
  icon: React.ReactNode;
  color?: string;
  valueClassName?: string;
}

const AdminStatCard: React.FC<AdminStatCardProps> = ({
  title,
  value,
  trend,
  trendUp,
  icon,
  color = 'bg-white',
  valueClassName = '',
}) => (
  <div className={`${color} p-6 border-2 border-ink shadow-sketch relative overflow-hidden group hover:-translate-y-1 transition-transform duration-200 sticky-curl ${roughBorderClassSm}`}>
    <div className="absolute -right-4 -top-4 text-ink/10 rotate-12 group-hover:rotate-0 transition-transform scale-150 opacity-100">
      {icon}
    </div>
    <p className="text-pencil text-sm font-bold mb-2 uppercase tracking-wider font-sans">{title}</p>
    <div className="flex items-end gap-3 relative z-10 flex-wrap">
      <span className={`text-5xl font-display text-ink ${valueClassName}`} title={value}>{value}</span>
      <span className={`text-xs font-bold border border-ink px-2 py-1 rounded-sm shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] ${trendUp ? 'bg-alert' : 'bg-gray-200'}`}>
        {trend}
      </span>
    </div>
  </div>
);

export default AdminStatCard;
