import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DAY_MS,
  addOrExtendOwnership,
  filterActiveOwnership,
  normalizePriceTiers,
  ownershipIds,
  parseOwnershipList,
  pickPriceTier,
  serializeOwnershipList,
} from '../shop-inventory.js';

test('parseOwnershipList supports legacy id arrays and object form', () => {
  const legacy = parseOwnershipList(JSON.stringify(['a', 'b', 'a']));
  assert.deepEqual(ownershipIds(legacy), ['a', 'b']);
  assert.equal(legacy[0].expiresAt, null);

  const timed = parseOwnershipList(JSON.stringify([
    { id: 'x', expiresAt: 100 },
    { id: 'y', expiresAt: null },
  ]));
  assert.equal(timed.find((i) => i.id === 'x')?.expiresAt, 100);
});

test('filterActiveOwnership drops expired', () => {
  const now = 1_000_000;
  const list = [
    { id: 'live', expiresAt: now + 1000 },
    { id: 'dead', expiresAt: now - 1 },
    { id: 'forever', expiresAt: null },
  ];
  const active = filterActiveOwnership(list, now);
  assert.deepEqual(ownershipIds(active).sort(), ['forever', 'live']);
});

test('addOrExtendOwnership timed and permanent', () => {
  const now = 1_000_000;
  let list = addOrExtendOwnership([], 'red', 1, now);
  assert.equal(list[0].expiresAt, now + DAY_MS);

  // extend from remaining expiry
  list = addOrExtendOwnership(list, 'red', 1, now + 1000);
  assert.equal(list[0].expiresAt, now + DAY_MS + DAY_MS);

  // permanent
  list = addOrExtendOwnership([], 'frame', 0, now);
  assert.equal(list[0].expiresAt, null);
  assert.equal(serializeOwnershipList(list).includes('frame'), true);
});

test('normalizePriceTiers supports multi-tier and text lines', () => {
  const tiers = normalizePriceTiers([
    { price: 70, durationDays: 7 },
    { price: 10, durationDays: 1 },
    { price: 300, durationDays: 0 },
  ], 0, 0);
  assert.equal(tiers.length, 3);
  assert.equal(tiers[0].durationDays, 1);
  assert.equal(tiers[0].price, 10);
  assert.equal(tiers[1].durationDays, 7);
  assert.equal(tiers[2].durationDays, 0);
  assert.equal(tiers[2].label, '永久');

  const fromText = normalizePriceTiers('10/1\n70/7', 0, 0);
  assert.equal(fromText.length, 2);
  assert.equal(pickPriceTier(fromText, fromText[1].id)?.price, 70);

  const fallback = normalizePriceTiers([], 50, 0);
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].price, 50);
  assert.equal(fallback[0].durationDays, 0);
});
