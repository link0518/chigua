export enum ViewType {
  HOME = 'HOME',
  SUBMISSION = 'SUBMISSION',
  FEED = 'FEED',
  SEARCH = 'SEARCH',
  FAVORITES = 'FAVORITES',
  ADMIN = 'ADMIN',
  NOT_FOUND = 'NOT_FOUND'
}

export interface Post {
  id: string;
  content: string;
  author: string;
  timestamp: string;
  location?: string;
  likes: number;
  comments: number;
  tags?: string[];
  rank?: number;
  isHot?: boolean;
  imageUrl?: string;
  createdAt?: number; // Unix timestamp for sorting
  viewerReaction?: 'like' | 'dislike' | null;
  viewerFavorited?: boolean;
}

export interface Report {
  id: string;
  targetId: string;
  targetType: 'post' | 'comment';
  postId?: string;
  reason: string;
  contentSnippet: string;
  postContent?: string;
  commentContent?: string;
  targetContent?: string;
  targetIp?: string | null;
  targetFingerprint?: string | null;
  reporterIp?: string | null;
  reporterFingerprint?: string | null;
  reporterCount?: number;
  timestamp: string;
  status: 'pending' | 'resolved' | 'ignored';
  riskLevel: 'low' | 'medium' | 'high';
}

export interface Comment {
  id: string;
  postId: string;
  parentId?: string | null;
  replyToId?: string | null;
  content: string;
  author: string;
  timestamp: string;
  createdAt?: number;
  replies?: Comment[];
  deleted?: boolean;
  likes?: number;
  viewerLiked?: boolean;
}

export interface NotificationItem {
  id: string;
  type: 'post_comment' | 'post_like' | 'comment_reply';
  postId?: string | null;
  commentId?: string | null;
  preview?: string | null;
  createdAt: number;
  readAt?: number | null;
}

export interface AdminPost {
  id: string;
  content: string;
  author: string;
  timestamp: string;
  createdAt: number;
  likes: number;
  comments: number;
  reports: number;
  deleted: boolean;
  deletedAt?: number | null;
  hotScore?: number;
  sessionId?: string | null;
  ip?: string | null;
  fingerprint?: string | null;
  matchedComments?: AdminComment[];
  matchedCommentCount?: number;
}

export interface AdminComment {
  id: string;
  postId: string;
  parentId?: string | null;
  replyToId?: string | null;
  content: string;
  author: string;
  timestamp: string;
  createdAt: number;
  deleted: boolean;
  deletedAt?: number | null;
  ip?: string | null;
  fingerprint?: string | null;
  replies?: AdminComment[];
}

export interface AdminAuditLog {
  id: number;
  adminId?: number | null;
  adminUsername?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: string | null;
  after?: string | null;
  reason?: string | null;
  ip?: string | null;
  sessionId?: string | null;
  createdAt: number;
}

export interface BanEntry {
  value: string;
  bannedAt: number;
  expiresAt?: number | null;
  permissions?: string[];
  reason?: string | null;
  type: 'ip' | 'fingerprint';
}

export interface FeedbackMessage {
  id: string;
  content: string;
  email: string;
  wechat?: string | null;
  qq?: string | null;
  createdAt: number;
  readAt?: number | null;
  sessionId?: string | null;
  ip?: string | null;
  fingerprint?: string | null;
}

export interface ChartDataPoint {
  name: string;
  value: number;
}
