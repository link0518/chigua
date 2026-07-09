import React from 'react';

import {
  getNameStyleDef,
  useNameStyleRegistryVersion,
  type NameStyleColor,
} from './nameStyles';

interface ColorfulNameProps {
  children: React.ReactNode;
  styleId?: string | null;
  /** 直接传色（管理预览），优先于 registry */
  color?: NameStyleColor | null;
  className?: string;
  as?: 'span' | 'div';
}

/**
 * 炫彩昵称展示（发帖 / 回复共用）
 * 纯色行内文字，避免 inline-block 把「1楼 / 楼主」拆成两行
 */
const ColorfulName: React.FC<ColorfulNameProps> = ({
  children,
  styleId = null,
  color = null,
  className = '',
  as: Tag = 'span',
}) => {
  useNameStyleRegistryVersion();
  const id = String(styleId || '').trim();
  const def = id ? getNameStyleDef(id) : null;
  const rgb = color || def?.color || null;

  if (!rgb) {
    return (
      <Tag className={className || undefined}>
        {children}
      </Tag>
    );
  }

  const { r, g, b } = rgb;

  return (
    <Tag
      className={`font-bold ${className}`.trim()}
      data-name-style={id || 'custom'}
      style={{ color: `rgb(${r}, ${g}, ${b})` }}
    >
      {children}
    </Tag>
  );
};

export default ColorfulName;
