export enum ViewType {
  HOME = 'HOME',
  SUBMISSION = 'SUBMISSION',
  FEED = 'FEED',
  SEARCH = 'SEARCH',
  FAVORITES = 'FAVORITES',
  CHAT = 'CHAT',
  WIKI = 'WIKI',
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
  dislikes: number;
  comments: number;
  tags?: string[];
  rank?: number;
  isHot?: boolean;
  imageUrl?: string;
  createdAt?: number; // Unix timestamp for sorting
  hidden?: boolean;
  rumorStatus?: 'suspected' | null;
  rumorStatusUpdatedAt?: number | null;
  viewerReaction?: 'like' | 'dislike' | null;
  viewerFavorited?: boolean;
}

export type ReportReasonCode = 'privacy' | 'harassment' | 'spam' | 'misinformation' | 'rumor';

export interface ReportSubmissionPayload {
  reason: string;
  reasonCode?: ReportReasonCode;
  evidence?: string;
}

export interface ReportSubmissionResult {
  id: string;
  autoHidden?: boolean;
  targetType?: 'post' | 'comment';
  targetId?: string;
}

export interface Report {
  id: string;
  targetId: string;
  targetType: 'post' | 'comment' | 'chat';
  postId?: string;
  reason: string;
  reasonCode?: string | null;
  evidence?: string | null;
  contentSnippet: string;
  postContent?: string;
  commentContent?: string;
  targetContent?: string;
  targetIp?: string | null;
  targetSessionId?: string | null;
  targetFingerprint?: string | null;
  targetIdentityKey?: string | null;
  targetIdentityHashes?: string[];
  reporterIp?: string | null;
  reporterFingerprint?: string | null;
  reporterIdentityKey?: string | null;
  reporterIdentityHashes?: string[];
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
  hidden?: boolean;
  hiddenAt?: number | null;
  rumorStatus?: 'suspected' | null;
  rumorStatusUpdatedAt?: number | null;
  likes?: number;
  viewerLiked?: boolean;
}

export interface NotificationItem {
  id: string;
  type: 'post_comment' | 'post_like' | 'comment_reply' | 'rumor_marked' | 'rumor_rejected';
  postId?: string | null;
  commentId?: string | null;
  preview?: string | null;
  createdAt: number;
  readAt?: number | null;
}

export interface AdminIdentityInfo {
  sessionId?: string | null;
  ip?: string | null;
  fingerprint?: string | null;
  identityKey?: string | null;
  identityHashes?: string[];
}

export interface AdminPost extends AdminIdentityInfo {
  id: string;
  content: string;
  author: string;
  timestamp: string;
  createdAt: number;
  likes: number;
  comments: number;
  reports: number;
  pendingReportCount?: number;
  deleted: boolean;
  deletedAt?: number | null;
  hidden?: boolean;
  hiddenAt?: number | null;
  hiddenReviewStatus?: 'pending' | 'kept' | null;
  hotScore?: number;
  matchedComments?: AdminComment[];
  matchedCommentCount?: number;
}

export interface AdminComment extends AdminIdentityInfo {
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
  hidden?: boolean;
  hiddenAt?: number | null;
  hiddenReviewStatus?: 'pending' | 'kept' | null;
  rumorStatus?: 'suspected' | 'rejected' | null;
  rumorStatusUpdatedAt?: number | null;
  pendingReportCount?: number;
  replies?: AdminComment[];
}

export interface RumorEvidenceSample {
  reportId: string;
  content: string;
  createdAt: number;
}

export interface RumorReviewItem {
  id: string;
  targetId: string;
  targetType: 'post' | 'comment';
  postId?: string | null;
  postContent?: string;
  commentContent?: string;
  targetContent: string;
  rumorStatus?: 'suspected' | 'rejected' | null;
  rumorStatusUpdatedAt?: number | null;
  reportCount: number;
  pendingReportCount: number;
  reporterCount: number;
  latestReportedAt: number;
  reportIds: string[];
  evidenceSamples: RumorEvidenceSample[];
  reasons: string[];
  targetIp?: string | null;
  targetSessionId?: string | null;
  targetFingerprint?: string | null;
  targetIdentityKey?: string | null;
  targetIdentityHashes?: string[];
}

export interface AdminHiddenItem extends AdminIdentityInfo {
  type: 'post' | 'comment';
  id: string;
  postId?: string;
  parentId?: string | null;
  replyToId?: string | null;
  postContent?: string;
  content: string;
  author: string;
  timestamp: string;
  createdAt: number;
  hiddenAt?: number | null;
  hiddenReviewStatus?: 'pending' | 'kept' | null;
  pendingReportCount?: number;
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
  type: 'ip' | 'fingerprint' | 'identity';
  identityKey?: string | null;
  identityHashes?: string[];
}

export interface FeedbackMessage extends AdminIdentityInfo {
  id: string;
  content: string;
  email: string;
  wechat?: string | null;
  qq?: string | null;
  createdAt: number;
  readAt?: number | null;
}

export interface UpdateAnnouncementItem {
  id: string;
  content: string;
  updatedAt: number;
}

export interface ChartDataPoint {
  name: string;
  value: number;
}

export interface ChatReplyRef {
  id: number;
  nickname: string;
  preview: string;
}

export interface ChatMessage {
  id: number;
  sessionId: string;
  nickname: string;
  isAdmin?: boolean;
  type: 'text' | 'image' | 'sticker';
  content: string;
  imageUrl?: string;
  stickerCode?: string;
  clientMsgId?: string;
  createdAt: number;
  deleted?: boolean;
  deletedAt?: number | null;
  deleteReason?: string | null;
  pending?: boolean;
  replyTo?: ChatReplyRef | null;
}

export interface ChatOnlineUser {
  nickname: string;
  isAdmin?: boolean;
  joinedAt: number;
  lastActiveAt: number;
  connections: number;
}

export interface AdminChatOnlineUser extends ChatOnlineUser {
  fingerprintHash: string;
  sessionId: string;
  identityKey?: string | null;
  identityHashes?: string[];
  hiddenInOnline?: boolean;
}

export interface ChatMuteEntry {
  fingerprintHash: string;
  identityKey?: string | null;
  identityHashes?: string[];
  mutedUntil: number | null;
  reason: string | null;
  createdAt: number;
  createdByAdminId: number | null;
}

export interface ChatRoomConfig {
  chatEnabled: boolean;
  muteAll: boolean;
  adminOnly: boolean;
  messageIntervalMs: number;
  maxTextLength: number;
}

export interface WikiEntry {
  id: string;
  slug: string;
  name: string;
  narrative: string;
  tags: string[];
  status: 'pending' | 'approved' | 'rejected';
  currentRevisionId?: string | null;
  versionNumber: number;
  displayOrder?: number | null;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  deletedAt?: number | null;
}

export type WikiEntrySort = 'updated' | 'number';

export interface WikiRevisionData {
  name: string;
  narrative: string;
  tags: string[];
  editSummary?: string;
}

export interface WikiRevision {
  id: string;
  entryId?: string | null;
  entryName?: string | null;
  entrySlug?: string | null;
  actionType: 'create' | 'edit';
  baseRevisionId?: string | null;
  baseVersionNumber: number;
  data: WikiRevisionData;
  editSummary: string;
  status: 'pending' | 'approved' | 'rejected';
  submitterFingerprint?: string | null;
  submitterIp?: string | null;
  createdAt: number;
  reviewReason?: string;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  versionNumber?: number | null;
}
