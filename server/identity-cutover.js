const DEFAULT_IDENTITY_V2_CUTOVER_AT = Date.UTC(2026, 2, 8, 0, 0, 0, 0);

const normalizeTimestamp = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return null;
  }
  return Math.trunc(num);
};

export const resolveIdentityV2CutoverAt = (value) => {
  const normalized = normalizeTimestamp(value);
  return normalized || DEFAULT_IDENTITY_V2_CUTOVER_AT;
};

export const resolveIdentityStorageType = (createdAt, cutoverAt) => {
  const normalizedCreatedAt = normalizeTimestamp(createdAt);
  const normalizedCutoverAt = resolveIdentityV2CutoverAt(cutoverAt);
  if (!normalizedCreatedAt) {
    return 'legacy_fingerprint';
  }
  return normalizedCreatedAt >= normalizedCutoverAt ? 'identity' : 'legacy_fingerprint';
};

