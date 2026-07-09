import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  FramePackageError,
  sanitizeFrameCss,
  validateFramePackage,
  BUILTIN_SEED_PACKAGES,
} from '../frame-package.js';
import {
  initFrameService,
  importFramePackage,
  listShopCatalog,
  patchFrame,
  getEquippedFrameIdIfValid,
  getFrameByIdForPurchase,
} from '../frame-service.js';

const validPackage = () => ({
  schemaVersion: 2,
  frame: {
    id: 'unit-glow',
    name: '单元测试框',
    price: 25,
    rarity: 'common',
    status: 'on_sale',
    sort: 1,
    grantOnRegister: false,
  },
  render: {
    engine: 'css-slots-v1',
    html: 'default-v1',
    css: `
.fg-root { display: inline-flex; }
.fg-shell { animation: spin 1s linear infinite; }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
`.trim(),
  },
  preview: { username: '匿名用户', timestamp: '刚刚' },
});

test('validateFramePackage accepts valid schema v2 package', () => {
  const pkg = validateFramePackage(validPackage());
  assert.equal(pkg.schemaVersion, 2);
  assert.equal(pkg.frame.id, 'unit-glow');
  assert.equal(pkg.frame.price, 25);
  assert.ok(pkg.render.css.includes('fg-root'));
  assert.ok(pkg.render.css.includes('@keyframes unit-glow-spin') || pkg.render.css.includes('spin'));
});

test('validateFramePackage rejects dangerous CSS and bad schema', () => {
  assert.throws(
    () => validateFramePackage({ schemaVersion: 1, frame: validPackage().frame, render: validPackage().render }),
    (err) => err instanceof FramePackageError
  );

  const bad = validPackage();
  bad.render.css = 'body { background: url(https://evil.test/x.png); }';
  assert.throws(() => validateFramePackage(bad), (err) => err instanceof FramePackageError);

  const js = validPackage();
  js.render.css = '.x { behavior: expression(alert(1)); }';
  assert.throws(() => validateFramePackage(js), (err) => err instanceof FramePackageError);

  const noCss = validPackage();
  noCss.render.css = '   ';
  assert.throws(() => validateFramePackage(noCss), (err) => err instanceof FramePackageError);
});

test('sanitizeFrameCss prefixes keyframes', () => {
  const out = sanitizeFrameCss('@keyframes foo { from { opacity: 0 } } .a { animation: foo 1s; }', 'demo');
  assert.match(out, /@keyframes demo-foo/);
});

test('frame-service shop catalog and purchase rules use DB', () => {
  const db = new Database(':memory:');
  initFrameService(db);

  const seeded = listShopCatalog();
  assert.ok(seeded.length >= 3, 'should seed builtin frames');
  assert.ok(seeded.every((item) => item.render?.css), 'seed frames include css');

  const created = importFramePackage(validPackage(), { mode: 'create' });
  assert.equal(created.id, 'unit-glow');
  assert.equal(created.price, 25);

  const catalog = listShopCatalog();
  assert.ok(catalog.some((item) => item.id === 'unit-glow'));

  assert.equal(getFrameByIdForPurchase('unit-glow')?.price, 25);
  assert.equal(getEquippedFrameIdIfValid('unit-glow'), 'unit-glow');

  patchFrame('unit-glow', { price: 99, status: 'off_sale' });
  assert.equal(getFrameByIdForPurchase('unit-glow'), null, 'off_sale not purchasable');
  assert.equal(getEquippedFrameIdIfValid('unit-glow'), 'unit-glow', 'off_sale still renderable/equipable id');

  patchFrame('unit-glow', { status: 'hidden' });
  assert.equal(getEquippedFrameIdIfValid('unit-glow'), null);

  assert.throws(
    () => importFramePackage(validPackage(), { mode: 'create' }),
    (err) => err instanceof FramePackageError
  );

  const upserted = importFramePackage(
    {
      ...validPackage(),
      frame: { ...validPackage().frame, price: 11, status: 'on_sale' },
    },
    { mode: 'upsert' }
  );
  assert.equal(upserted.price, 11);
  assert.equal(getFrameByIdForPurchase('unit-glow')?.price, 11);
});

test('builtin seed packages validate', () => {
  for (const seed of BUILTIN_SEED_PACKAGES) {
    const pkg = validateFramePackage(seed);
    assert.ok(pkg.frame.id);
    assert.ok(pkg.render.css.length > 20);
  }
});
