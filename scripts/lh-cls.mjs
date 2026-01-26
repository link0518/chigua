import fs from 'fs';

const filePath = process.argv[2];
if (!filePath) {
  console.error('用法：node scripts/lh-cls.mjs <report.json>');
  process.exit(2);
}

const report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const auditKeys = Object.keys(report.audits ?? {}).filter((key) => key.includes('shift'));
const candidates = [
  'layout-shifts',
  'layout-shift-elements',
  'layout-shift',
  ...auditKeys,
];
const pick = candidates.find((key) => report.audits?.[key]?.details?.items?.length);
const audit = pick ? report.audits[pick] : null;
const items = audit?.details?.items ?? [];

const summarizeNode = (node) => {
  if (!node) return null;
  if (node.snippet) return node.snippet;
  const selector = node.selector;
  if (selector) return selector;
  return null;
};

const rows = items
  .map((item) => ({
    score: item.score ?? null,
    value: item.value ?? null,
    hadRecentInput: item.hadRecentInput ?? null,
    node: summarizeNode(item.node),
  }))
  .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  .slice(0, 10);

console.log(JSON.stringify({
  url: report.finalDisplayedUrl,
  cls: report.audits?.['cumulative-layout-shift']?.numericValue ?? null,
  audit: pick ?? null,
  availableAudits: auditKeys,
  topShifts: rows,
}, null, 2));
