import fs from 'fs';
import path from 'path';

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const groupBy = (items, keyFn) => {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return map;
};

const pickMedianRun = (entries) => {
  const scores = entries.map((e) => e.summary?.performance ?? null).filter((v) => typeof v === 'number');
  if (!scores.length) return entries[0] ?? null;
  const m = median(scores);
  let best = entries[0];
  let bestDiff = Infinity;
  for (const e of entries) {
    const s = e.summary?.performance;
    if (typeof s !== 'number') continue;
    const diff = Math.abs(s - m);
    if (diff < bestDiff) {
      best = e;
      bestDiff = diff;
    }
  }
  return best;
};

const extract = (report) => {
  const num = (id) => report.audits?.[id]?.numericValue;
  const opportunities = Object.values(report.audits ?? {})
    .filter((a) => a?.details?.type === 'opportunity' && (a.details.overallSavingsMs ?? 0) > 0)
    .map((a) => ({
      id: a.id,
      title: a.title,
      saveMs: Math.round(a.details.overallSavingsMs),
    }))
    .sort((a, b) => b.saveMs - a.saveMs)
    .slice(0, 6);

  return {
    score: Math.round((report.categories?.performance?.score ?? 0) * 100),
    fcpMs: num('first-contentful-paint') ? Math.round(num('first-contentful-paint')) : null,
    lcpMs: num('largest-contentful-paint') ? Math.round(num('largest-contentful-paint')) : null,
    tbtMs: num('total-blocking-time') ? Math.round(num('total-blocking-time')) : null,
    cls: report.audits?.['cumulative-layout-shift']?.numericValue ?? null,
    siMs: num('speed-index') ? Math.round(num('speed-index')) : null,
    opportunities,
  };
};

const summarizeManifest = (manifestPath) => {
  const manifest = readJson(manifestPath);
  const grouped = groupBy(manifest, (e) => e.url);
  const results = [];
  for (const [url, entries] of grouped) {
    const chosen = pickMedianRun(entries);
    if (!chosen?.jsonPath) continue;
    const report = readJson(chosen.jsonPath);
    results.push({
      url,
      runs: entries.length,
      report: path.basename(chosen.jsonPath),
      ...extract(report),
    });
  }
  results.sort((a, b) => a.url.localeCompare(b.url));
  return results;
};

const main = () => {
  const device = process.argv[2];
  if (!device || !['mobile', 'desktop'].includes(device)) {
    console.error('用法：node scripts/lh-summary.mjs <mobile|desktop>');
    process.exit(2);
  }
  const manifestPath = path.resolve(process.cwd(), `.lighthouseci/${device}/manifest.json`);
  if (!fs.existsSync(manifestPath)) {
    console.error(`未找到 ${manifestPath}，请先运行 npm run perf:budget`);
    process.exit(2);
  }
  const results = summarizeManifest(manifestPath);
  console.log(JSON.stringify({ device, results }, null, 2));
};

main();

