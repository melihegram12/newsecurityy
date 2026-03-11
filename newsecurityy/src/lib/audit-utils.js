import { simpleHash } from './utils';

export const buildAuditHash = (entry) => simpleHash([
  entry.prev_hash || 'GENESIS',
  entry.at || '',
  entry.action || '',
  entry.user || '',
  entry.role || '',
  entry.message || ''
].join('|'));

export const verifyAuditChain = (logs = []) => {
  if (!Array.isArray(logs) || logs.length === 0) return { ok: true, brokenIndex: -1 };
  for (let i = 0; i < logs.length; i += 1) {
    const item = logs[i] || {};
    const expectedHash = buildAuditHash(item);
    if (item.hash && item.hash !== expectedHash) {
      return { ok: false, brokenIndex: i };
    }
    if (i < logs.length - 1) {
      const prev = logs[i + 1] || {};
      if (item.prev_hash && prev.hash && item.prev_hash !== prev.hash) {
        return { ok: false, brokenIndex: i };
      }
    }
  }
  return { ok: true, brokenIndex: -1 };
};
