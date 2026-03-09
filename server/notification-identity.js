const normalizeHash = (value) => String(value || '').trim();

export const getNotificationActorHashes = (identityContext) => {
  const values = [
    ...(Array.isArray(identityContext?.lookupHashes) ? identityContext.lookupHashes : []),
    identityContext?.canonicalHash,
    identityContext?.legacyFingerprintHash,
    identityContext?.effectiveHash,
  ];

  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const normalized = normalizeHash(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
};

export const matchesNotificationActor = (identityContext, targetHash) => {
  const normalizedTarget = normalizeHash(targetHash);
  if (!normalizedTarget) {
    return false;
  }
  return getNotificationActorHashes(identityContext).includes(normalizedTarget);
};

export const resolveNotificationActorFingerprint = (identityContext, recipientFingerprint) => {
  const normalizedRecipient = normalizeHash(recipientFingerprint);
  const canonicalHash = normalizeHash(identityContext?.canonicalHash);
  const legacyFingerprintHash = normalizeHash(identityContext?.legacyFingerprintHash);
  const effectiveHash = normalizeHash(identityContext?.effectiveHash);

  if (normalizedRecipient) {
    if (normalizedRecipient === canonicalHash) {
      return canonicalHash;
    }
    if (normalizedRecipient === legacyFingerprintHash) {
      return legacyFingerprintHash;
    }
  }

  return canonicalHash || legacyFingerprintHash || effectiveHash || '';
};
