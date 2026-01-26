import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const PACK_NAME = 'Default';
const PACK_DIR = path.join(ROOT, 'public', 'meme', PACK_NAME);
const MANIFEST_PATH = path.join(PACK_DIR, 'manifest.json');
const TS_MANIFEST_PATH = path.join(ROOT, 'components', 'memeManifest.ts');

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.svg']);

const isImageFile = (filename) => {
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return false;
  return filename.toLowerCase() !== 'manifest.json';
};

const buildLabel = (filename) => {
  const base = path.basename(filename, path.extname(filename));
  const parts = base.split('__');
  const label = parts.length >= 2 ? parts.slice(1).join('__') : base;
  return label || filename;
};

const escapeTsString = (value) => {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
};

const readExisting = () => {
  try {
    return fs.readFileSync(MANIFEST_PATH, 'utf8');
  } catch {
    return '';
  }
};

const readExistingTs = () => {
  try {
    return fs.readFileSync(TS_MANIFEST_PATH, 'utf8');
  } catch {
    return '';
  }
};

const main = () => {
  if (!fs.existsSync(PACK_DIR)) {
    console.error(`[meme] 目录不存在：${PACK_DIR}`);
    process.exitCode = 1;
    return;
  }

  const files = fs
    .readdirSync(PACK_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(isImageFile)
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));

  const manifest = {
    pack: PACK_NAME,
    generatedAt: new Date().toISOString(),
    items: files.map((file) => ({
      file,
      label: buildLabel(file),
    })),
  };

  const nextContent = `${JSON.stringify(manifest, null, 2)}\n`;
  const prevContent = readExisting();
  if (prevContent === nextContent) {
    // 仍尝试生成 TS 映射（可能首次引入）
  }
  fs.writeFileSync(MANIFEST_PATH, nextContent, 'utf8');

  const tsLines = [];
  tsLines.push('export type MemeItem = {');
  tsLines.push('  file: string;');
  tsLines.push('  label: string;');
  tsLines.push('};');
  tsLines.push('');
  tsLines.push('export const MEME_PACK = `Default` as const;');
  tsLines.push('export const MEME_BASE_PATH = `/meme/Default` as const;');
  tsLines.push('');
  tsLines.push('export const MEME_ITEMS: MemeItem[] = [');
  manifest.items.forEach((item) => {
    tsLines.push(`  { file: \`${escapeTsString(item.file)}\`, label: \`${escapeTsString(item.label)}\` },`);
  });
  tsLines.push('];');
  tsLines.push('');
  tsLines.push('export const MEME_LABEL_TO_FILE = new Map<string, string>(');
  tsLines.push('  MEME_ITEMS.map((item) => [item.label, item.file])');
  tsLines.push(');');
  tsLines.push('');

  const nextTs = `${tsLines.join('\n')}\n`;
  const prevTs = readExistingTs();
  if (prevTs !== nextTs) {
    fs.writeFileSync(TS_MANIFEST_PATH, nextTs, 'utf8');
  }
};

main();
