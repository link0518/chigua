import { db } from './db.js';

const tables = [
  'reports',
  'report_sessions',
  'comments',
  'post_reactions',
  'post_views',
  'posts',
  'stats_daily',
  'daily_visits',
  'banned_sessions',
];

const run = () => {
  const existing = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((row) => row.name);

  tables.forEach((table) => {
    if (existing.includes(table)) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
  });

  console.log('Data reset completed (users preserved).');
};

run();
