import React from 'react';
import type { AdminAuditLog, FeedbackMessage, Report } from '@/types';
import type { AdminIdentityLike } from '@/components/adminIdentity';

export type ReportAction = 'ignore' | 'delete' | 'mute' | 'ban';
export type AdminFeedbackStatus = 'unread' | 'read' | 'all';
export type AdminBanType = 'ip' | 'fingerprint' | 'identity';
export type AdminChartDatum = {
  name: string;
  value: number;
};

export type AdminMergedBanItem = {
  type: AdminBanType;
  value: string;
  bannedAt: number;
  expiresAt?: number | null;
  permissions?: string[];
  reason?: string | null;
  fingerprint?: string | null;
  identityKey?: string | null;
  identityHashes?: string[];
};

export type RenderIdentity = (
  identity?: AdminIdentityLike | null,
  options?: {
    label?: string | null;
    showIp?: boolean;
    showSession?: boolean;
    enableSearchActions?: boolean;
    enableBanActions?: boolean;
    className?: string;
    textClassName?: string;
  }
) => React.ReactNode;

export type AdminAuditDetail = {
  isOpen: boolean;
  log: AdminAuditLog | null;
};

export type AdminReportDetail = {
  isOpen: boolean;
  report: Report | null;
};

export type AdminFeedbackAction = 'delete' | 'ban';

export type AdminFeedbackActionHandler = (message: FeedbackMessage, action: AdminFeedbackAction) => void;
