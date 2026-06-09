import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const loadEnvFile = (filename) => {
  const filePath = path.resolve(process.cwd(), filename);
  if (!fs.existsSync(filePath)) {
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      return;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  });
};

export const initializeRuntimeEnv = () => {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
};

const readImageBedEnv = (env, key) => {
  const preferred = String(env[key] || '').trim();
  if (preferred) {
    return preferred;
  }
  return String(env[`VITE_${key}`] || '').trim();
};

export const createRuntimeConfig = (env = process.env) => {
  const sessionSecretRaw = String(env.SESSION_SECRET || '').trim();
  const adminUsername = String(env.ADMIN_USERNAME || '').trim();
  const adminPassword = String(env.ADMIN_PASSWORD || '').trim();

  return {
    port: Number(env.PORT || 4395),
    turnstileSecretKey: String(env.TURNSTILE_SECRET_KEY || '').trim(),
    turnstileVerifyUrl: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    imgbedBaseUrl: readImageBedEnv(env, 'IMGBED_BASE_URL'),
    imgbedToken: readImageBedEnv(env, 'IMGBED_TOKEN'),
    fingerprintHeader: 'x-client-fingerprint',
    fingerprintSalt: String(env.FINGERPRINT_SALT || sessionSecretRaw || 'gossipsketch-fingerprint-salt').trim(),
    sessionSecret: sessionSecretRaw || crypto.randomBytes(32).toString('hex'),
    sessionSecretConfigured: Boolean(sessionSecretRaw),
    adminUsername,
    adminPassword,
    adminEnabled: Boolean(sessionSecretRaw && adminUsername && adminPassword),
    siteUrl: String(env.SITE_URL || 'https://933211.xyz').replace(/\/+$/, ''),
  };
};
