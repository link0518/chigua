import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  createNameStyle,
  getEquippedNameStyleIdIfValid,
  getNameStyleById,
  initNameStyleService,
  listNameStylesForShop,
  parseOwnedNameStyles,
  patchNameStyle,
  NameStyleError,
} from '../name-style-service.js';

test('name style service seeds vip-red and supports RGB create', () => {
  const db = new Database(':memory:');
  initNameStyleService(db);

  const items = listNameStylesForShop();
  assert.ok(items.some((item) => item.id === 'vip-red'));
  const red = getNameStyleById('vip-red', { forPurchase: true });
  assert.equal(red?.name, '红色昵称');
  assert.deepEqual(red?.color, { r: 207, g: 19, b: 34 });

  const created = createNameStyle({
    id: 'blue-neon',
    name: '蓝色昵称',
    price: 50,
    rarity: 'common',
    status: 'on_sale',
    sort: 20,
    color: { r: 37, g: 99, b: 235 },
  });
  assert.equal(created.id, 'blue-neon');
  assert.equal(created.colorCss, 'rgb(37, 99, 235)');
  assert.equal(created.colorHex, '#2563eb');

  const byHex = createNameStyle({
    id: 'green-hex',
    name: '绿色昵称',
    price: 40,
    color: '#16a34a',
  });
  assert.equal(byHex.color.r, 22);
  assert.equal(byHex.color.g, 163);
  assert.equal(byHex.color.b, 74);

  assert.throws(
    () => createNameStyle({ id: 'bad', name: 'x', price: 1, color: { r: 999, g: 0, b: 0 } }),
    (err) => err instanceof NameStyleError
  );

  patchNameStyle('blue-neon', { price: 66, color: { r: 1, g: 2, b: 3 } });
  assert.equal(getNameStyleById('blue-neon')?.price, 66);
  assert.deepEqual(getNameStyleById('blue-neon')?.color, { r: 1, g: 2, b: 3 });

  assert.equal(getEquippedNameStyleIdIfValid('blue-neon'), 'blue-neon');
  assert.equal(getEquippedNameStyleIdIfValid('nope'), null);
  assert.deepEqual(parseOwnedNameStyles(JSON.stringify(['blue-neon', 'nope'])), ['blue-neon']);
});
