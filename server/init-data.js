import { db, formatDateKey } from './db.js';

const now = Date.now();
const hour = 60 * 60 * 1000;
const day = 24 * hour;

const posts = [
  {
    id: 'seed-post-001',
    content: '听说会议室的投影仪只有在领导到场前 10 分钟才会奇迹般复活。',
    tags: ['职场', '奇闻'],
    createdAt: now - 2 * hour,
    likes: 48,
    dislikes: 3,
    views: 420,
    deleted: false,
    deletedAt: null,
    sessionId: 'seed-session-001',
  },
  {
    id: 'seed-post-002',
    content: '图书馆自习区最近多了一个神秘留字本，记录着所有“迟到原因”。',
    tags: ['校园'],
    createdAt: now - 6 * hour,
    likes: 132,
    dislikes: 8,
    views: 980,
    deleted: false,
    deletedAt: null,
    sessionId: 'seed-session-002',
  },
  {
    id: 'seed-post-003',
    content: '保安大叔的巡逻路线被大家画成了藏宝图，结果真的找到一箱零食。',
    tags: ['轻松', '生活'],
    createdAt: now - 28 * hour,
    likes: 78,
    dislikes: 2,
    views: 760,
    deleted: false,
    deletedAt: null,
    sessionId: 'seed-session-003',
  },
  {
    id: 'seed-post-004',
    content: '食堂新品“火锅味凉面”上线 3 天就被悄悄下架了，有人吃出人生哲理。',
    tags: ['吃瓜', '美食'],
    createdAt: now - 3 * day,
    likes: 54,
    dislikes: 15,
    views: 640,
    deleted: true,
    deletedAt: now - 2 * day,
    sessionId: 'seed-session-004',
  },
  {
    id: 'seed-post-005',
    content: '小区电梯里贴着“文明乘梯公约”，但署名竟然是匿名。',
    tags: ['日常'],
    createdAt: now - 4 * day,
    likes: 29,
    dislikes: 1,
    views: 300,
    deleted: false,
    deletedAt: null,
    sessionId: 'seed-session-005',
  },
  {
    id: 'seed-post-006',
    content: '据说楼下便利店的老板会根据天气调整热狗的“灵魂配方”。',
    tags: ['城市'],
    createdAt: now - 6 * day,
    likes: 15,
    dislikes: 0,
    views: 180,
    deleted: true,
    deletedAt: now - 5 * day,
    sessionId: 'seed-session-006',
  },
];

const comments = [
  {
    id: 'seed-comment-001',
    postId: 'seed-post-001',
    content: '投影仪：我只对领导负责。',
    createdAt: now - 90 * 60 * 1000,
  },
  {
    id: 'seed-comment-002',
    postId: 'seed-post-001',
    content: '会议室设备通灵现场。',
    createdAt: now - 70 * 60 * 1000,
  },
  {
    id: 'seed-comment-003',
    postId: 'seed-post-002',
    content: '那个留字本我也见过，写过“起晚了”。',
    createdAt: now - 4 * hour,
  },
  {
    id: 'seed-comment-004',
    postId: 'seed-post-003',
    content: '藏宝图那箱零食我可以作证是真的。',
    createdAt: now - 20 * hour,
  },
  {
    id: 'seed-comment-005',
    postId: 'seed-post-004',
    content: '凉面版本的火锅精神，确实难以理解。',
    createdAt: now - 2 * day,
  },
  {
    id: 'seed-comment-006',
    postId: 'seed-post-005',
    content: '公约还写了“严禁摆拍”，笑死。',
    createdAt: now - 3 * day,
  },
];

const reports = [
  {
    id: 'seed-report-001',
    postId: 'seed-post-004',
    reason: '垃圾广告',
    contentSnippet: '食堂新品“火锅味凉面”上线',
    createdAt: now - 2 * day,
    status: 'pending',
    riskLevel: 'low',
    action: null,
    resolvedAt: null,
  },
  {
    id: 'seed-report-002',
    postId: 'seed-post-002',
    reason: '虚假信息',
    contentSnippet: '图书馆自习区最近多了一个神秘留字本',
    createdAt: now - 5 * hour,
    status: 'resolved',
    riskLevel: 'medium',
    action: 'ignore',
    resolvedAt: now - 2 * hour,
  },
  {
    id: 'seed-report-003',
    postId: 'seed-post-006',
    reason: '其他',
    contentSnippet: '便利店的老板会根据天气调整热狗',
    createdAt: now - 4 * day,
    status: 'resolved',
    riskLevel: 'high',
    action: 'delete',
    resolvedAt: now - 3 * day,
  },
];

const dailyStats = [
  { daysAgo: 0, visits: 120, posts: 12, reports: 3 },
  { daysAgo: 1, visits: 96, posts: 9, reports: 1 },
  { daysAgo: 2, visits: 88, posts: 10, reports: 2 },
  { daysAgo: 3, visits: 75, posts: 7, reports: 1 },
  { daysAgo: 4, visits: 64, posts: 6, reports: 0 },
  { daysAgo: 5, visits: 52, posts: 5, reports: 1 },
  { daysAgo: 6, visits: 48, posts: 4, reports: 0 },
];

const commentCountByPost = comments.reduce((acc, comment) => {
  acc[comment.postId] = (acc[comment.postId] || 0) + 1;
  return acc;
}, {});

const insertPost = db.prepare(
  `
  INSERT OR IGNORE INTO posts (
    id, content, author, tags, created_at, deleted, deleted_at, session_id,
    likes_count, dislikes_count, comments_count, views_count
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
);

const insertComment = db.prepare(
  `
  INSERT OR IGNORE INTO comments (id, post_id, content, author, created_at)
  VALUES (?, ?, ?, ?, ?)
  `
);

const insertReport = db.prepare(
  `
  INSERT OR IGNORE INTO reports (
    id, post_id, reason, content_snippet, created_at, status, risk_level, action, resolved_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
);

const insertStats = db.prepare(
  `
  INSERT OR IGNORE INTO stats_daily (date, visits, posts, reports)
  VALUES (?, ?, ?, ?)
  `
);

const insertVisit = db.prepare(
  `
  INSERT OR IGNORE INTO daily_visits (date, session_id)
  VALUES (?, ?)
  `
);

const run = () => {
  const insertedPostIds = new Set();
  posts.forEach((post) => {
    const result = insertPost.run(
      post.id,
      post.content,
      '匿名',
      JSON.stringify(post.tags),
      post.createdAt,
      post.deleted ? 1 : 0,
      post.deletedAt,
      post.sessionId,
      post.likes,
      post.dislikes,
      commentCountByPost[post.id] || 0,
      post.views
    );
    if (result.changes > 0) {
      insertedPostIds.add(post.id);
    }
  });

  const existingSeedPosts = new Set(
    db
      .prepare(`SELECT id FROM posts WHERE id IN (${posts.map(() => '?').join(',')})`)
      .all(...posts.map((post) => post.id))
      .map((row) => row.id)
  );

  comments.forEach((comment) => {
    if (!existingSeedPosts.has(comment.postId)) {
      return;
    }
    insertComment.run(comment.id, comment.postId, comment.content, '匿名', comment.createdAt);
  });

  reports.forEach((report) => {
    if (!existingSeedPosts.has(report.postId)) {
      return;
    }
    insertReport.run(
      report.id,
      report.postId,
      report.reason,
      report.contentSnippet,
      report.createdAt,
      report.status,
      report.riskLevel,
      report.action,
      report.resolvedAt
    );
  });

  dailyStats.forEach((item) => {
    const date = new Date(now - item.daysAgo * day);
    const dateKey = formatDateKey(date);
    insertStats.run(dateKey, item.visits, item.posts, item.reports);

    const visitSamples = Math.min(item.visits, 5);
    for (let i = 1; i <= visitSamples; i += 1) {
      insertVisit.run(dateKey, `seed-visit-${dateKey}-${i}`);
    }
  });

  if (insertedPostIds.size > 0) {
    console.log(`Initialized ${insertedPostIds.size} posts with comments/reports/stats.`);
  } else {
    console.log('Seed data already exists. No new records inserted.');
  }
};

run();
