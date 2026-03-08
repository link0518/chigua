import crypto from 'crypto';
import signature from 'cookie-signature';

const CLIENT_ID_COOKIE_NAME = 'gs_client_id_v2';
const CLIENT_ID_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const CLIENT_ID_HASH_NAMESPACE = 'client_id_v2';

const normalizeHashList = (value) => {
  const source = Array.isArray(value) ? value : [value];
  return Array.from(new Set(
    source
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
};

const parseCookieHeader = (request, cookieLib) => {
  const header = String(request?.headers?.cookie || '').trim();
  if (!header) {
    return {};
  }
  try {
    return cookieLib.parse(header);
  } catch {
    return {};
  }
};

export const createIdentityService = ({
  db,
  cookie,
  sessionSecret,
  fingerprintSalt,
  fingerprintHeader,
}) => {
  const upsertIdentityAliasStmt = db.prepare(
    `
      INSERT INTO identity_aliases (
        canonical_hash,
        legacy_fingerprint_hash,
        source,
        first_seen_at,
        last_seen_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(canonical_hash, legacy_fingerprint_hash) DO UPDATE SET
        source = excluded.source,
        last_seen_at = excluded.last_seen_at
    `
  );
  const getAliasRowsByCanonicalStmt = db.prepare(
    `
      SELECT id, legacy_fingerprint_hash, first_seen_at
      FROM identity_aliases
      WHERE canonical_hash = ?
      ORDER BY last_seen_at DESC
    `
  );

  const readClientIdFromRequest = (request) => {
    const parsedCookies = parseCookieHeader(request, cookie);
    const rawValue = String(parsedCookies?.[CLIENT_ID_COOKIE_NAME] || '').trim();
    if (!rawValue.startsWith('s:')) {
      return '';
    }
    const unsigned = signature.unsign(rawValue.slice(2), sessionSecret);
    return typeof unsigned === 'string' ? unsigned.trim() : '';
  };

  const hashLegacyFingerprint = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '';
    }
    return crypto.createHmac('sha256', fingerprintSalt).update(normalized).digest('hex');
  };

  const hashClientId = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) {
      return '';
    }
    return crypto.createHmac('sha256', fingerprintSalt)
      .update(`${CLIENT_ID_HASH_NAMESPACE}:${normalized}`)
      .digest('hex');
  };

  const getFingerprintValue = (request) => {
    const headerValue = request?.headers?.[fingerprintHeader];
    if (Array.isArray(headerValue) && headerValue.length) {
      const first = String(headerValue[0] || '').trim();
      if (first) {
        return first;
      }
    }
    if (typeof headerValue === 'string' && headerValue.trim()) {
      return headerValue.trim();
    }
    const bodyValue = request?.body?.fingerprint;
    if (typeof bodyValue === 'string' && bodyValue.trim()) {
      return bodyValue.trim();
    }
    return '';
  };

  const issueClientIdCookie = (response, clientId) => {
    if (!response || typeof response.cookie !== 'function') {
      return;
    }
    response.cookie(CLIENT_ID_COOKIE_NAME, `s:${signature.sign(clientId, sessionSecret)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: String(process.env.NODE_ENV || '').trim() === 'production',
      path: '/',
      maxAge: CLIENT_ID_COOKIE_MAX_AGE_MS,
    });
  };

  const upsertIdentityAlias = (canonicalHash, legacyFingerprintHash, source = 'request') => {
    if (!canonicalHash || !legacyFingerprintHash) {
      return;
    }
    const now = Date.now();
    upsertIdentityAliasStmt.run(canonicalHash, legacyFingerprintHash, source, now, now);
  };

  const buildLookupHashes = ({ canonicalHash = '', legacyFingerprintHash = '' } = {}) => normalizeHashList([
    canonicalHash,
    legacyFingerprintHash,
  ]);

  const getLookupHashesForCanonicalHash = (canonicalHash, currentLegacyFingerprintHash = '') => {
    const normalizedCanonicalHash = String(canonicalHash || '').trim();
    const normalizedLegacyFingerprintHash = String(currentLegacyFingerprintHash || '').trim();
    if (!normalizedCanonicalHash && !normalizedLegacyFingerprintHash) {
      return [];
    }
    return buildLookupHashes({
      canonicalHash: normalizedCanonicalHash,
      legacyFingerprintHash: normalizedLegacyFingerprintHash,
    });
  };

  const getLookupHashesForIdentityHash = (identityHash) => {
    const normalizedIdentityHash = String(identityHash || '').trim();
    if (!normalizedIdentityHash) {
      return [];
    }
    return [normalizedIdentityHash];
  };

  const getPreferredFingerprintHashForCanonicalHash = (canonicalHash) => {
    const normalizedCanonicalHash = String(canonicalHash || '').trim();
    if (!normalizedCanonicalHash) {
      return '';
    }
    return normalizedCanonicalHash;
  };

  const getStableLegacyFingerprintHashForIdentityHashes = (identityHashes) => normalizeHashList(identityHashes)[0] || '';

  const getStableIdentityKeyFromContext = (context) => {
    return String(context?.canonicalHash || '').trim()
      || String(context?.legacyFingerprintHash || '').trim()
      || '';
  };

  const resolveRequestIdentity = (request, response, options = {}) => {
    if (request?.identityContext) {
      return request.identityContext;
    }

    const allowIssueCookie = options.allowIssueCookie !== false;
    let clientId = readClientIdFromRequest(request);
    let cookieIssued = false;

    if (!clientId && allowIssueCookie && response) {
      clientId = crypto.randomUUID();
      issueClientIdCookie(response, clientId);
      cookieIssued = true;
    }

    const legacyFingerprintRaw = getFingerprintValue(request);
    const legacyFingerprintHash = hashLegacyFingerprint(legacyFingerprintRaw);
    const canonicalHash = hashClientId(clientId);

    if (canonicalHash && legacyFingerprintHash) {
      upsertIdentityAlias(canonicalHash, legacyFingerprintHash);
    }

    const lookupHashes = getLookupHashesForCanonicalHash(canonicalHash, legacyFingerprintHash);

    const context = {
      rawClientId: clientId,
      cookieIssued,
      canonicalHash,
      legacyFingerprintRaw,
      legacyFingerprintHash,
      effectiveHash: canonicalHash || legacyFingerprintHash || '',
      lookupHashes,
      source: canonicalHash ? 'cookie_v2' : legacyFingerprintHash ? 'legacy_fingerprint' : 'none',
    };

    if (request) {
      request.identityContext = context;
    }
    return context;
  };

  const ensureRequestIdentity = (request, response) => resolveRequestIdentity(request, response, { allowIssueCookie: true });

  const requireRequestIdentityHash = (request, response) => {
    const context = resolveRequestIdentity(request, response, { allowIssueCookie: true });
    if (context.effectiveHash) {
      return context.effectiveHash;
    }
    response.status(400).json({ error: '身份标识缺失，请刷新后重试' });
    return null;
  };

  const getOptionalRequestIdentityHash = (request, response) => (
    resolveRequestIdentity(request, response, { allowIssueCookie: true }).effectiveHash || ''
  );

  const getRequestIdentityContext = (request, response) => {
    const context = resolveRequestIdentity(request, response, { allowIssueCookie: true });
    return {
      ...context,
      lookupHashes: context.lookupHashes.slice(),
    };
  };

  const getRequestIdentityLookupHashes = (request, response) => (
    resolveRequestIdentity(request, response, { allowIssueCookie: true }).lookupHashes.slice()
  );

  const getRequestStableIdentityKey = (request, response) => (
    getStableIdentityKeyFromContext(resolveRequestIdentity(request, response, { allowIssueCookie: true }))
  );

  const sharesIdentityHashes = (leftHash, rightHash) => {
    const left = String(leftHash || '').trim();
    const right = String(rightHash || '').trim();
    return Boolean(left && right && left === right);
  };

  const resolveSocketIdentity = (request) => {
    const clientId = readClientIdFromRequest(request);
    const canonicalHash = hashClientId(clientId);
    const lookupHashes = getLookupHashesForCanonicalHash(canonicalHash);
    const preferredFingerprintHash = getPreferredFingerprintHashForCanonicalHash(canonicalHash);
    const stableIdentityHash = canonicalHash || preferredFingerprintHash;
    return {
      rawClientId: clientId,
      canonicalHash,
      preferredFingerprintHash,
      stableIdentityHash,
      lookupHashes,
      source: canonicalHash ? 'cookie_v2' : 'none',
    };
  };

  return {
    clientIdCookieName: CLIENT_ID_COOKIE_NAME,
    clientIdCookieMaxAgeMs: CLIENT_ID_COOKIE_MAX_AGE_MS,
    ensureRequestIdentity,
    requireRequestIdentityHash,
    getOptionalRequestIdentityHash,
    getRequestIdentityContext,
    getRequestIdentityLookupHashes,
    getRequestStableIdentityKey,
    hashLegacyFingerprint,
    getFingerprintValue,
    upsertIdentityAlias,
    getLookupHashesForCanonicalHash,
    getLookupHashesForIdentityHash,
    getPreferredFingerprintHashForCanonicalHash,
    getStableLegacyFingerprintHashForIdentityHashes,
    sharesIdentityHashes,
    resolveSocketIdentity,
  };
};
