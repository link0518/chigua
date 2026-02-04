import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const MEME_ROOT = path.join(ROOT, 'public', 'meme');
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

const readFileSafe = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
};

const writeIfChanged = (filePath, nextContent) => {
  const prevContent = readFileSafe(filePath);
  if (prevContent === nextContent) {
    return false;
  }
  fs.writeFileSync(filePath, nextContent, 'utf8');
  return true;
};

const DEFAULT_PACK_DIR = 'Default';

const listPackDirs = () => {
  if (!fs.existsSync(MEME_ROOT)) {
    return [];
  }
  const names = fs
    .readdirSync(MEME_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);

  const others = names
    .filter((name) => name !== DEFAULT_PACK_DIR)
    .map((name) => {
      const dirPath = path.join(MEME_ROOT, name);
      try {
        const stat = fs.statSync(dirPath);
        const createdAtMs = Number(stat.birthtimeMs || 0);
        const mtimeMs = Number(stat.mtimeMs || 0);
        return { name, createdAtMs, mtimeMs };
      } catch {
        return { name, createdAtMs: 0, mtimeMs: 0 };
      }
    })
    .sort((a, b) => {
      const left = a.createdAtMs || a.mtimeMs;
      const right = b.createdAtMs || b.mtimeMs;
      if (left !== right) {
        return left - right;
      }
      // 兜底：同一时间戳时保持稳定顺序（按名称）
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    })
    .map((item) => item.name);

  return names.includes(DEFAULT_PACK_DIR) ? [DEFAULT_PACK_DIR, ...others] : others;
};

const listPackItems = (packDir) => {
  const files = fs
    .readdirSync(packDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter(isImageFile)
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));

  const items = files.map((file) => ({
    file,
    label: buildLabel(file),
  }));

  let latestMtimeMs = 0;
  for (const file of files) {
    try {
      const stat = fs.statSync(path.join(packDir, file));
      latestMtimeMs = Math.max(latestMtimeMs, Number(stat.mtimeMs || 0));
    } catch {
      // ignore
    }
  }

  return {
    items,
    generatedAt: latestMtimeMs > 0 ? new Date(latestMtimeMs).toISOString() : new Date(0).toISOString(),
  };
};

const main = () => {
  const packNames = listPackDirs();
  if (packNames.length === 0) {
    console.error(`[meme] 未发现表情包目录：${MEME_ROOT}`);
    process.exitCode = 1;
    return;
  }

  const packs = packNames.map((name) => {
    const packDir = path.join(MEME_ROOT, name);
    const { items, generatedAt } = listPackItems(packDir);
    const manifest = {
      pack: name,
      generatedAt,
      items,
    };
    const manifestPath = path.join(packDir, 'manifest.json');
    writeIfChanged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return { name, items };
  });

  const defaultPack = packNames.includes('Default') ? 'Default' : packNames[0];

  const tsLines = [];
  tsLines.push('export type MemeItem = {');
  tsLines.push('  file: string;');
  tsLines.push('  label: string;');
  tsLines.push('};');
  tsLines.push('');
  tsLines.push('export type MemePack = {');
  tsLines.push('  name: string;');
  tsLines.push('  items: MemeItem[];');
  tsLines.push('};');
  tsLines.push('');
  tsLines.push(`export const DEFAULT_MEME_PACK = \`${escapeTsString(defaultPack)}\` as const;`);
  tsLines.push('');
  tsLines.push('export const MEME_PACKS: MemePack[] = [');
  packs.forEach((pack) => {
    tsLines.push(`  { name: \`${escapeTsString(pack.name)}\`, items: [`);
    pack.items.forEach((item) => {
      tsLines.push(`    { file: \`${escapeTsString(item.file)}\`, label: \`${escapeTsString(item.label)}\` },`);
    });
    tsLines.push('  ] },');
  });
  tsLines.push('];');
  tsLines.push('');
  tsLines.push('export const MEME_PACK_TO_ITEMS = new Map<string, MemeItem[]>(');
  tsLines.push('  MEME_PACKS.map((pack) => [pack.name, pack.items])');
  tsLines.push(');');
  tsLines.push('');
  tsLines.push('export const MEME_KEY_TO_FILE = new Map<string, string>(');
  tsLines.push('  MEME_PACKS.flatMap((pack) => pack.items.map((item) => [`${pack.name}/${item.label}`, item.file]))');
  tsLines.push(');');
  tsLines.push('');

  writeIfChanged(TS_MANIFEST_PATH, `${tsLines.join('\n')}\n`);
};

main();
