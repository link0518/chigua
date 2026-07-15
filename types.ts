export enum ViewType {
  HOME = 'HOME',
  SUBMISSION = 'SUBMISSION',
  FEED = 'FEED',
  SEARCH = 'SEARCH',
  FAVORITES = 'FAVORITES',
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
  viewerIsAuthor?: boolean;
  viewerDeleteRequestStatus?: 'pending' | null;
  /** 作者装备的昵称框 id */
  authorFrameId?: string | null;
  /** 发帖快照：炫彩昵称样式 id */
  authorNameStyleId?: string | null;
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
  targetType: 'post' | 'comment';
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
  postIdentity?: CommentPostIdentity | null;
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
  /** 评论者装备的昵称框 id */
  authorFrameId?: string | null;
  /** 评论快照：炫彩昵称样式 id */
  authorNameStyleId?: string | null;
}

export interface CommentPostIdentity {
  key: string;
  label: string;
  role: 'op' | 'guest';
}

/** 搜索结果按帖子聚合，命中的评论仅返回当前页所需的预览。 */
export interface SearchPost extends Post {
  matchedComments?: Comment[];
  matchedCommentCount?: number;
}

export interface NotificationItem {
  id: string;
  type:
    | 'post_comment'
    | 'post_like'
    | 'comment_like'
    | 'comment_reply'
    | 'rumor_marked'
    | 'rumor_rejected'
    | 'feedback_reply'
    | 'post_delete_request_approved'
    | 'post_delete_request_rejected';
  postId?: string | null;
  commentId?: string | null;
  preview?: string | null;
  createdAt: number;
  readAt?: number | null;
}

export type WikiEntrySort = 'updated' | 'number';

export interface WikiAttachment {
  title: string;
  imageUrls: string[];
}

export interface WikiRelatedPost {
  id: string;
  available: boolean;
  excerpt?: string;
}

export interface WikiEntry {
  id: string;
  slug: string;
  name: string;
  narrative: string;
  tags: string[];
  status?: string;
  currentRevisionId?: string | null;
  versionNumber: number;
  displayOrder?: number | null;
  createdAt: number;
  updatedAt: number;
  deleted?: boolean;
  deletedAt?: number | null;
  relatedPostIds?: string[];
  relatedPosts?: WikiRelatedPost[];
  attachments?: WikiAttachment[];
}

export interface WikiRevisionData {
  name: string;
  narrative: string;
  tags: string[];
  relatedPostIds?: string[];
  attachments?: WikiAttachment[];
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
  relatedPosts?: WikiRelatedPost[];
  editSummary?: string;
  status: 'pending' | 'approved' | 'rejected';
  submitterFingerprint?: string | null;
  submitterIp?: string | null;
  createdAt: number;
  reviewReason?: string;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  versionNumber?: number | null;
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
  category?: string | null;
  riskLevel?: 'normal' | 'high' | string | null;
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
  replies?: FeedbackReply[];
}

export interface FeedbackReply {
  id: string;
  feedbackId: string;
  content: string;
  adminId?: number | null;
  adminUsername?: string | null;
  createdAt: number;
}

export interface PostDeleteRequest extends AdminIdentityInfo {
  id: string;
  postId: string;
  postContent: string;
  postDeleted?: boolean;
  postDeletedAt?: number | null;
  postHidden?: boolean;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
  timestamp?: string;
  requesterFingerprint?: string | null;
  requesterIp?: string | null;
  reviewedAt?: number | null;
  reviewedBy?: number | null;
  reviewedByUsername?: string | null;
  reviewReason?: string | null;
}

export interface UpdateAnnouncementItem {
  id: string;
  content: string;
  updatedAt: number;
}

export type AdminPermissionLevel = 'read' | 'manage';
export type AdminPermissionModuleKey =
  | 'content_review'
  | 'posts'
  | 'wiki'
  | 'feedback'
  | 'user_safety'
  | 'publish'
  | 'settings';

export type AdminPermissions = Partial<Record<AdminPermissionModuleKey, AdminPermissionLevel>>;

export interface AdminPermissionDefinitions {
  modules: Array<{
    key: AdminPermissionModuleKey;
    label: string;
    description?: string;
  }>;
  levels: Array<{
    key: AdminPermissionLevel;
    label: string;
    description?: string;
  }>;
}

export interface AdminUserAccount {
  id: number;
  username: string;
  role: 'admin' | 'super_admin';
  isSuperAdmin: boolean;
  disabled: boolean;
  permissions: AdminPermissions;
  createdAt: number;
  updatedAt?: number | null;
}

export interface ChartDataPoint {
  name: string;
  value: number;
}
