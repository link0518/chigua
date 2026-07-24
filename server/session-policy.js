const STATELESS_POLLING_PATHS = [
  /^\/api\/notifications\/?$/,
  /^\/api\/recruitment\/notifications\/?$/,
  /^\/api\/recruitment\/threads\/[^/]+\/messages\/?$/,
  /^\/api\/recruitment\/threads\/[^/]+\/contact-exchanges\/?$/,
];

export const shouldSkipSessionForRequest = (request) => {
  if (String(request?.method || '').trim().toUpperCase() !== 'GET') {
    return false;
  }
  const requestPath = String(request?.path || request?.url || '')
    .split('?')[0]
    .trim();
  return STATELESS_POLLING_PATHS.some((pattern) => pattern.test(requestPath));
};

export default shouldSkipSessionForRequest;
