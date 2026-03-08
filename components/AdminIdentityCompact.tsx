import React, { useMemo, useState } from 'react';
import {
  type AdminIdentityBanTargetType,
  type AdminIdentityField,
  type AdminIdentityLike,
  getAdminIdentityAliases,
  getAdminIdentityFields,
} from './adminIdentity';

type AdminIdentityActionTarget = AdminIdentityField;

type AdminIdentityCompactProps = {
  identity?: AdminIdentityLike | null;
  label?: string | null;
  className?: string;
  textClassName?: string;
  buttonClassName?: string;
  detailsClassName?: string;
  emptyText?: string;
  showAliases?: boolean;
  showIp?: boolean;
  showSession?: boolean;
  actions?: {
    onSearch?: (target: AdminIdentityActionTarget) => void;
    onBan?: (target: AdminIdentityActionTarget & { type: AdminIdentityBanTargetType }) => void;
  };
};

const AdminIdentityCompact: React.FC<AdminIdentityCompactProps> = ({
  identity,
  label = '标识',
  className = '',
  textClassName = '',
  buttonClassName = '',
  detailsClassName = '',
  emptyText = '-',
  showAliases = true,
  showIp = true,
  showSession = true,
  actions,
}) => {
  const [expanded, setExpanded] = useState(false);
  const fields = useMemo(
    () => getAdminIdentityFields(identity, { includeIp: showIp, includeSession: showSession }),
    [identity, showIp, showSession]
  );
  const aliases = useMemo(
    () => (identity && showAliases ? getAdminIdentityAliases(identity) : []),
    [identity, showAliases]
  );
  const primary = fields[0] || null;
  const hasActions = fields.some((field) => (
    Boolean(actions?.onSearch)
    || (field.type !== 'session' && Boolean(actions?.onBan))
  ));
  const hasDetails = fields.length > 1 || aliases.length > 0 || hasActions;

  return (
    <span className={`inline-flex max-w-full flex-wrap items-start gap-x-2 gap-y-1 align-top ${className}`}>
      {label ? <span>{label}：</span> : null}
      {primary ? (
        <>
          <span className="inline-flex items-center rounded-full border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
            {primary.label}
          </span>
          <span className={`break-all ${textClassName}`}>{primary.value}</span>
        </>
      ) : (
        <span className={`break-all ${textClassName}`}>{emptyText}</span>
      )}
      {hasDetails && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className={`text-[11px] font-bold text-gray-500 hover:text-ink transition-colors ${buttonClassName}`}
        >
          {expanded ? '收起' : '查看详情'}
        </button>
      )}
      {expanded && hasDetails && (
        <span className={`w-full rounded-md border border-gray-200 bg-white/90 px-2 py-1.5 text-[11px] leading-5 text-gray-600 ${detailsClassName}`}>
          {fields.map((field) => (
            <span key={`${field.type}:${field.value}`} className="mt-1 flex flex-wrap items-center gap-2 first:mt-0">
              <span className="inline-flex items-center rounded-full border border-gray-300 bg-gray-50 px-1.5 py-0.5 text-[10px] font-bold text-gray-600">
                {field.label}
              </span>
              <span className="break-all text-ink">{field.value}</span>
              {actions?.onSearch && (
                <button
                  type="button"
                  onClick={() => actions.onSearch?.(field)}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 hover:border-ink hover:text-ink"
                >
                  搜索
                </button>
              )}
              {field.type !== 'session' && actions?.onBan && (
                <button
                  type="button"
                  onClick={() => actions.onBan?.(field as AdminIdentityActionTarget & { type: AdminIdentityBanTargetType })}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] font-bold text-gray-600 hover:border-ink hover:text-ink"
                >
                  封禁
                </button>
              )}
            </span>
          ))}
          {aliases.length > 0 && (
            <span className="mt-1 block break-all">附加哈希：{aliases.join(' / ')}</span>
          )}
        </span>
      )}
    </span>
  );
};

export default AdminIdentityCompact;
