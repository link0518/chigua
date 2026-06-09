import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeConfig } from '../runtime-config.js';

test('runtime config can read legacy image bed variable names on the server', () => {
  const config = createRuntimeConfig({
    VITE_IMGBED_BASE_URL: 'https://legacy.example',
    VITE_IMGBED_TOKEN: 'legacy-token',
  });
  assert.equal(config.imgbedBaseUrl, 'https://legacy.example');
  assert.equal(config.imgbedToken, 'legacy-token');
});

test('runtime config prefers server-side image bed variables and trims values', () => {
  const config = createRuntimeConfig({
    IMGBED_BASE_URL: ' https://img.example ',
    IMGBED_TOKEN: ' server-token ',
    VITE_IMGBED_BASE_URL: 'https://legacy.example',
    VITE_IMGBED_TOKEN: 'legacy-token',
  });
  assert.equal(config.imgbedBaseUrl, 'https://img.example');
  assert.equal(config.imgbedToken, 'server-token');
});
