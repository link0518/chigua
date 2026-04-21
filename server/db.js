import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve(process.cwd(), 'server', 'data', 'app.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '匿名',
  tags TEXT,
  location TEXT,
  image_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0,
  hidden_at INTEGER,
  hidden_review_status TEXT,
  rumor_status TEXT,
  rumor_status_updated_at INTEGER,
  session_id TEXT,
  likes_count INTEGER NOT NULL DEFAULT 0,
  dislikes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  views_count INTEGER NOT NULL DEFAULT 0,
  comment_identity_enabled INTEGER NOT NULL DEFAULT 0,
  comment_identity_guest_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS post_reactions (
  post_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  reaction TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, session_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_reactions_fingerprint (
  post_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  reaction TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, fingerprint),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_views (
  post_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, session_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS post_favorites (
  post_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, fingerprint),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  parent_id TEXT,
  content TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '匿名',
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  hidden INTEGER NOT NULL DEFAULT 0,
  hidden_at INTEGER,
  hidden_review_status TEXT,
  rumor_status TEXT,
  rumor_status_updated_at INTEGER,
  ip TEXT,
  post_identity_key TEXT,
  post_identity_label TEXT,
  post_identity_role TEXT,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comment_likes (
  comment_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  comment_id TEXT,
  target_type TEXT NOT NULL DEFAULT 'post',
  reason TEXT NOT NULL,
  reason_code TEXT,
  evidence TEXT,
  content_snippet TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  risk_level TEXT NOT NULL DEFAULT 'low',
  action TEXT,
  resolved_at INTEGER,
  fingerprint TEXT,
  reporter_ip TEXT
);

CREATE TABLE IF NOT EXISTS report_sessions (
  post_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, session_id),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comment_report_sessions (
  comment_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, session_id)
);

CREATE TABLE IF NOT EXISTS banned_sessions (
  session_id TEXT PRIMARY KEY,
  banned_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS banned_ips (
  ip TEXT PRIMARY KEY,
  banned_at INTEGER NOT NULL,
  expires_at INTEGER,
  permissions TEXT,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS banned_fingerprints (
  fingerprint TEXT PRIMARY KEY,
  banned_at INTEGER NOT NULL,
  expires_at INTEGER,
  permissions TEXT,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS banned_identities (
  identity TEXT PRIMARY KEY,
  banned_at INTEGER NOT NULL,
  expires_at INTEGER,
  permissions TEXT,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS report_fingerprints (
  post_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (post_id, fingerprint),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comment_report_fingerprints (
  comment_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comment_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS feedback_messages (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  email TEXT NOT NULL,
  wechat TEXT,
  qq TEXT,
  created_at INTEGER NOT NULL,
  session_id TEXT,
  ip TEXT,
  read_at INTEGER
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  recipient_fingerprint TEXT NOT NULL,
  type TEXT NOT NULL,
  post_id TEXT,
  comment_id TEXT,
  preview TEXT,
  actor_fingerprint TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS update_announcements (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS wiki_entries (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  narrative TEXT NOT NULL,
  tags TEXT,
  display_order INTEGER,
  status TEXT NOT NULL DEFAULT 'approved',
  current_revision_id TEXT,
  version_number INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER
);

CREATE TABLE IF NOT EXISTS wiki_entry_revisions (
  id TEXT PRIMARY KEY,
  entry_id TEXT,
  action_type TEXT NOT NULL,
  base_revision_id TEXT,
  base_version_number INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL,
  edit_summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  submitter_fingerprint TEXT,
  submitter_ip TEXT,
  created_at INTEGER NOT NULL,
  review_reason TEXT,
  reviewed_at INTEGER,
  reviewed_by TEXT,
  FOREIGN KEY (entry_id) REFERENCES wiki_entries(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vocabulary_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  normalized TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS post_edits (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  editor_id INTEGER,
  editor_username TEXT,
  before_content TEXT NOT NULL,
  after_content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  reason TEXT,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  admin_username TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  ip TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stats_daily (
  date TEXT PRIMARY KEY,
  visits INTEGER NOT NULL DEFAULT 0,
  posts INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_visits (
  date TEXT NOT NULL,
  session_id TEXT NOT NULL,
  PRIMARY KEY (date, session_id)
);

CREATE TABLE IF NOT EXISTS fingerprint_login_days (
  date TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY (date, fingerprint)
);

CREATE TABLE IF NOT EXISTS easter_egg_seen (
  fingerprint TEXT NOT NULL,
  egg_key TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (fingerprint, egg_key)
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  fingerprint_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  left_reason TEXT,
  connection_count_peak INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  fingerprint_hash TEXT NOT NULL,
  ip_snapshot TEXT,
  nickname_snapshot TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  admin_anonymous INTEGER NOT NULL DEFAULT 0,
  msg_type TEXT NOT NULL,
  text_content TEXT,
  image_url TEXT,
  sticker_shortcode TEXT,
  reply_to_message_id INTEGER,
  reply_to_nickname TEXT,
  reply_preview TEXT,
  client_msg_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,
  deleted_by_admin_id INTEGER,
  delete_reason TEXT
);

CREATE TABLE IF NOT EXISTS chat_mutes (
  fingerprint_hash TEXT PRIMARY KEY,
  muted_until INTEGER,
  reason TEXT,
  created_at INTEGER NOT NULL,
  created_by_admin_id INTEGER
);

CREATE TABLE IF NOT EXISTS chat_ban_sync (
  fingerprint_hash TEXT PRIMARY KEY,
  ip TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS identity_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_hash TEXT NOT NULL,
  legacy_fingerprint_hash TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'request',
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE (canonical_hash, legacy_fingerprint_hash)
);

`);

const ensureColumn = (table, column, definition) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = columns.some((col) => col.name === column);
  if (!exists) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
};

ensureColumn('posts', 'ip', 'TEXT');
ensureColumn('posts', 'fingerprint', 'TEXT');
ensureColumn('posts', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('posts', 'hidden_at', 'INTEGER');
ensureColumn('posts', 'hidden_review_status', 'TEXT');
ensureColumn('posts', 'rumor_status', 'TEXT');
ensureColumn('posts', 'rumor_status_updated_at', 'INTEGER');
ensureColumn('posts', 'comment_identity_enabled', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('posts', 'comment_identity_guest_seq', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('comments', 'fingerprint', 'TEXT');
ensureColumn('comments', 'parent_id', 'TEXT');
ensureColumn('comments', 'reply_to_id', 'TEXT');
ensureColumn('comments', 'deleted', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('comments', 'deleted_at', 'INTEGER');
ensureColumn('comments', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('comments', 'hidden_at', 'INTEGER');
ensureColumn('comments', 'hidden_review_status', 'TEXT');
ensureColumn('comments', 'rumor_status', 'TEXT');
ensureColumn('comments', 'rumor_status_updated_at', 'INTEGER');
ensureColumn('comments', 'ip', 'TEXT');
ensureColumn('comments', 'post_identity_key', 'TEXT');
ensureColumn('comments', 'post_identity_label', 'TEXT');
ensureColumn('comments', 'post_identity_role', 'TEXT');
ensureColumn('reports', 'fingerprint', 'TEXT');
ensureColumn('reports', 'reporter_ip', 'TEXT');
ensureColumn('reports', 'comment_id', 'TEXT');
ensureColumn('reports', 'target_type', "TEXT NOT NULL DEFAULT 'post'");
ensureColumn('reports', 'reason_code', 'TEXT');
ensureColumn('reports', 'evidence', 'TEXT');
ensureColumn('wiki_entries', 'display_order', 'INTEGER');
ensureColumn('banned_ips', 'expires_at', 'INTEGER');
ensureColumn('banned_ips', 'permissions', 'TEXT');
ensureColumn('banned_ips', 'reason', 'TEXT');
ensureColumn('banned_fingerprints', 'expires_at', 'INTEGER');
ensureColumn('banned_fingerprints', 'permissions', 'TEXT');
ensureColumn('banned_fingerprints', 'reason', 'TEXT');
ensureColumn('banned_identities', 'expires_at', 'INTEGER');
ensureColumn('banned_identities', 'permissions', 'TEXT');
ensureColumn('banned_identities', 'reason', 'TEXT');
ensureColumn('feedback_messages', 'fingerprint', 'TEXT');
ensureColumn('update_announcements', 'created_at', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('chat_messages', 'reply_to_message_id', 'INTEGER');
ensureColumn('chat_messages', 'reply_to_nickname', 'TEXT');
ensureColumn('chat_messages', 'reply_preview', 'TEXT');
ensureColumn('chat_messages', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('chat_messages', 'admin_anonymous', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('chat_messages', 'ip_snapshot', 'TEXT');

db.prepare(`
  UPDATE update_announcements
  SET created_at = CASE
    WHEN created_at IS NULL OR created_at = 0 THEN updated_at
    ELSE created_at
  END
  WHERE created_at IS NULL OR created_at = 0
`).run();

const migrateReportsTableForChatTargets = () => {
  const tableSqlRow = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'reports'")
    .get();
  const tableSql = String(tableSqlRow?.sql || '');
  const hasPostForeignKey = /foreign key\s*\(\s*post_id\s*\)\s*references\s+posts/i.test(tableSql);
  if (!hasPostForeignKey) {
    return;
  }

  const migrate = db.transaction(() => {
    db.exec('DROP TABLE IF EXISTS reports_migrated;');
    db.exec(`
      CREATE TABLE reports_migrated (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        comment_id TEXT,
        target_type TEXT NOT NULL DEFAULT 'post',
        reason TEXT NOT NULL,
        reason_code TEXT,
        evidence TEXT,
        content_snippet TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        risk_level TEXT NOT NULL DEFAULT 'low',
        action TEXT,
        resolved_at INTEGER,
        fingerprint TEXT,
        reporter_ip TEXT
      );
    `);
    db.exec(`
      INSERT INTO reports_migrated (
        id,
        post_id,
        comment_id,
        target_type,
        reason,
        reason_code,
        evidence,
        content_snippet,
        created_at,
        status,
        risk_level,
        action,
        resolved_at,
        fingerprint,
        reporter_ip
      )
      SELECT
        id,
        post_id,
        comment_id,
        target_type,
        reason,
        reason_code,
        evidence,
        content_snippet,
        created_at,
        status,
        risk_level,
        action,
        resolved_at,
        fingerprint,
        reporter_ip
      FROM reports;
    `);
    db.exec('DROP TABLE reports;');
    db.exec('ALTER TABLE reports_migrated RENAME TO reports;');
  });
  migrate();
  db.exec('CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);');
};

migrateReportsTableForChatTargets();

const hasColumn = (table, column) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((col) => col.name === column);
};

const migratePostReactionsFingerprintTable = () => {
  // 新点赞体系使用独立表；旧 post_reactions(session_id) 数据保持不动，确保历史数据可用。
  // 兼容中间态：如果某次误迁移导致 post_reactions 里出现 fingerprint 列，尝试把数据搬运到新表。
  if (!hasColumn('post_reactions', 'fingerprint')) {
    return;
  }

  try {
    db.exec(`
      INSERT OR IGNORE INTO post_reactions_fingerprint (post_id, fingerprint, reaction, created_at)
      SELECT post_id, fingerprint, reaction, created_at
      FROM post_reactions
      WHERE fingerprint IS NOT NULL AND fingerprint != '';
    `);
  } catch {
    // 忽略：保证启动可用
  }
};

migratePostReactionsFingerprintTable();

const backfillWikiDisplayOrder = () => {
  const rows = db
    .prepare('SELECT id, display_order FROM wiki_entries ORDER BY rowid ASC')
    .all();

  if (!rows.length) {
    return;
  }

  const assignedOrders = new Set();
  const missingRows = [];
  let nextDisplayOrder = 1;

  rows.forEach((row) => {
    const currentDisplayOrder = Number(row.display_order || 0);
    if (currentDisplayOrder > 0 && !assignedOrders.has(currentDisplayOrder)) {
      assignedOrders.add(currentDisplayOrder);
      return;
    }
    missingRows.push(row);
  });

  if (!missingRows.length) {
    return;
  }

  const updateDisplayOrder = db.prepare('UPDATE wiki_entries SET display_order = ? WHERE id = ?');
  const assignMissing = db.transaction(() => {
    missingRows.forEach((row) => {
      while (assignedOrders.has(nextDisplayOrder)) {
        nextDisplayOrder += 1;
      }
      updateDisplayOrder.run(nextDisplayOrder, row.id);
      assignedOrders.add(nextDisplayOrder);
      nextDisplayOrder += 1;
    });
  });
  assignMissing();
};

backfillWikiDisplayOrder();

const ensureIndexes = () => {
  db.exec(`
  CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at);
  CREATE INDEX IF NOT EXISTS idx_posts_deleted ON posts(deleted);
  CREATE INDEX IF NOT EXISTS idx_posts_hidden_deleted_created_at ON posts(hidden, deleted, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_rumor_status_updated_at ON posts(rumor_status, rumor_status_updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_post_reactions_fingerprint_post_id ON post_reactions_fingerprint(post_id);
  CREATE INDEX IF NOT EXISTS idx_post_reactions_fingerprint_fingerprint_created_at ON post_reactions_fingerprint(fingerprint, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_post_favorites_fingerprint_created_at ON post_favorites(fingerprint, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_post_id ON comments(post_id);
  CREATE INDEX IF NOT EXISTS idx_comments_created_at ON comments(created_at);
  CREATE INDEX IF NOT EXISTS idx_comments_hidden_deleted_created_at ON comments(hidden, deleted, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_rumor_status_updated_at ON comments(rumor_status, rumor_status_updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
  CREATE INDEX IF NOT EXISTS idx_comments_post_identity_key ON comments(post_id, post_identity_key);
  CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id ON comment_likes(comment_id);
  CREATE INDEX IF NOT EXISTS idx_comment_likes_fingerprint_created_at ON comment_likes(fingerprint, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
  CREATE INDEX IF NOT EXISTS idx_reports_reason_code_status_created_at ON reports(reason_code, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_post_status_created_at ON reports(post_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reports_comment_status_created_at ON reports(comment_id, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_feedback_created_at ON feedback_messages(created_at);
  CREATE INDEX IF NOT EXISTS idx_feedback_read_at ON feedback_messages(read_at);
  CREATE INDEX IF NOT EXISTS idx_update_announcements_updated_at ON update_announcements(updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wiki_entries_status_deleted_updated_at ON wiki_entries(status, deleted, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wiki_entries_slug ON wiki_entries(slug);
  DROP INDEX IF EXISTS idx_wiki_entries_display_order;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_entries_display_order_unique ON wiki_entries(display_order);
  CREATE INDEX IF NOT EXISTS idx_wiki_entry_revisions_status_created_at ON wiki_entry_revisions(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wiki_entry_revisions_entry_id_created_at ON wiki_entry_revisions(entry_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wiki_entry_revisions_action_type ON wiki_entry_revisions(action_type);
  CREATE INDEX IF NOT EXISTS idx_post_edits_post_id ON post_edits(post_id);
  CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_action ON admin_audit_logs(action);
  CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_target ON admin_audit_logs(target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_recipient_created_at ON notifications(recipient_fingerprint, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read_at ON notifications(recipient_fingerprint, read_at);
  CREATE INDEX IF NOT EXISTS idx_banned_identities_expires_at ON banned_identities(expires_at);
  CREATE INDEX IF NOT EXISTS idx_fingerprint_login_days_fingerprint_date ON fingerprint_login_days(fingerprint, date DESC);
  CREATE INDEX IF NOT EXISTS idx_vocabulary_enabled ON vocabulary_words(enabled);
  CREATE INDEX IF NOT EXISTS idx_vocabulary_updated_at ON vocabulary_words(updated_at);
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_fingerprint_active ON chat_sessions(fingerprint_hash, left_at);
  CREATE INDEX IF NOT EXISTS idx_chat_sessions_joined_at ON chat_sessions(joined_at DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created_at ON chat_messages(session_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_deleted_created_at ON chat_messages(deleted, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_mutes_muted_until ON chat_mutes(muted_until);
  CREATE INDEX IF NOT EXISTS idx_chat_ban_sync_updated_at ON chat_ban_sync(updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_fingerprint_client_msg_id ON chat_messages(fingerprint_hash, client_msg_id);
  CREATE INDEX IF NOT EXISTS idx_identity_aliases_canonical_hash ON identity_aliases(canonical_hash, last_seen_at DESC);
  CREATE INDEX IF NOT EXISTS idx_identity_aliases_legacy_hash ON identity_aliases(legacy_fingerprint_hash, last_seen_at DESC);
  `);
};

ensureIndexes();

export const formatDateKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const startOfDay = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
};

export const startOfWeek = (date = new Date()) => {
  const start = new Date(date);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start.getTime();
};

export const ensureDailyStats = (dateKey) => {
  db.prepare('INSERT OR IGNORE INTO stats_daily (date) VALUES (?)').run(dateKey);
};

export const incrementDailyStat = (dateKey, field, amount = 1) => {
  const allowed = new Set(['visits', 'posts', 'reports']);
  if (!allowed.has(field)) {
    throw new Error('Unsupported stat field');
  }
  ensureDailyStats(dateKey);
  db.prepare(`UPDATE stats_daily SET ${field} = ${field} + ? WHERE date = ?`).run(amount, dateKey);
};

export const trackDailyVisit = (dateKey, sessionId) => {
  if (!sessionId) {
    return;
  }
  const result = db.prepare('INSERT OR IGNORE INTO daily_visits (date, session_id) VALUES (?, ?)').run(dateKey, sessionId);
  if (result.changes > 0) {
    incrementDailyStat(dateKey, 'visits', 1);
  }
};

export const formatRelativeTime = (timestamp) => {
  const diff = Date.now() - timestamp;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
};
