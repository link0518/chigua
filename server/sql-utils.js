const normalizeSqlValues = (values) => Array.from(new Set(
  (Array.isArray(values) ? values : [values])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
));

/**
 * 构造安全的 SQL 身份匹配片段。
 * column 只能传入代码内固定列名，外部输入必须放入 params。
 */
export const buildIdentityMatch = (column, identityHashes) => {
  const values = normalizeSqlValues(identityHashes);
  if (!values.length) {
    return { clause: '1 = 0', params: [] };
  }
  if (values.length === 1) {
    return { clause: `${column} = ?`, params: values };
  }
  return {
    clause: `${column} IN (${values.map(() => '?').join(', ')})`,
    params: values,
  };
};
