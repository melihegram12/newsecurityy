import { buildAuditHash, verifyAuditChain } from './audit-utils';

// Helpers
const makeEntry = (overrides = {}) => ({
  prev_hash: 'GENESIS',
  at: '2026-01-01T10:00:00.000Z',
  action: 'IN',
  user: 'user1',
  role: 'SECURITY',
  message: 'test',
  ...overrides,
});

const signedEntry = (fields = {}) => {
  const entry = makeEntry(fields);
  entry.hash = buildAuditHash(entry);
  return entry;
};

describe('buildAuditHash', () => {
  test('ürettiği hash deterministik — aynı giriş her zaman aynı hash', () => {
    const e = makeEntry();
    expect(buildAuditHash(e)).toBe(buildAuditHash(e));
  });

  test('herhangi bir alan değişince hash değişir', () => {
    const base = makeEntry();
    const modified = makeEntry({ action: 'OUT' });
    expect(buildAuditHash(base)).not.toBe(buildAuditHash(modified));
  });

  test('prev_hash eksikse GENESIS kullanır', () => {
    const withNull = makeEntry({ prev_hash: null });
    const withGenesis = makeEntry({ prev_hash: 'GENESIS' });
    expect(buildAuditHash(withNull)).toBe(buildAuditHash(withGenesis));
  });
});

describe('verifyAuditChain', () => {
  test('boş dizi — ok: true döner', () => {
    expect(verifyAuditChain([])).toEqual({ ok: true, brokenIndex: -1 });
  });

  test('undefined/null — ok: true döner', () => {
    expect(verifyAuditChain(undefined)).toEqual({ ok: true, brokenIndex: -1 });
    expect(verifyAuditChain(null)).toEqual({ ok: true, brokenIndex: -1 });
  });

  test('tek kayıt — hash uyumluysa ok: true', () => {
    const entry = signedEntry();
    expect(verifyAuditChain([entry])).toEqual({ ok: true, brokenIndex: -1 });
  });

  test('tek kayıt — hash yanlışsa ok: false, brokenIndex: 0', () => {
    const entry = makeEntry({ hash: 'TAMPERED' });
    expect(verifyAuditChain([entry])).toEqual({ ok: false, brokenIndex: 0 });
  });

  test('iki kayıt — doğru zincir ok döner', () => {
    const a = signedEntry({ prev_hash: 'GENESIS', at: 't1' });
    const b = signedEntry({ prev_hash: a.hash, at: 't2', action: 'OUT' });
    expect(verifyAuditChain([a, b])).toEqual({ ok: true, brokenIndex: -1 });
  });

  test('iki kayıt — ikincinin prev_hash uyumsuzluğu brokenIndex: 1 döner', () => {
    const a = signedEntry({ prev_hash: 'GENESIS', at: 't1' });
    // b kasıtlı yanlış prev_hash ile imzalanıyor
    const b = signedEntry({ prev_hash: 'TAMPERED_PREV', at: 't2', action: 'OUT' });
    expect(verifyAuditChain([a, b])).toEqual({ ok: false, brokenIndex: 1 });
  });

  test('üç kayıt — ortadaki bozuksa brokenIndex: 1 döner', () => {
    const a = signedEntry({ prev_hash: 'GENESIS', at: 't1' });
    const b = makeEntry({ prev_hash: a.hash, at: 't2', hash: 'BROKEN' });
    const c = signedEntry({ prev_hash: b.hash, at: 't3', action: 'OUT' });
    const result = verifyAuditChain([a, b, c]);
    expect(result.ok).toBe(false);
    expect(result.brokenIndex).toBe(1);
  });

  // REGRESYON: bu test daha önce sessizce geçiyordu çünkü
  // verifyAuditChain yanlış yönde (i+1) kontrol ediyordu
  test('REGRESYON: zincir doğrulaması doğru yönde (i-1) çalışıyor', () => {
    const a = signedEntry({ prev_hash: 'GENESIS', at: 't1' });
    // b'nin prev_hash'i a.hash değil — bu kırık bir zincir
    const b = signedEntry({ prev_hash: 'WRONG_HASH_NOT_A', at: 't2', action: 'OUT' });
    const result = verifyAuditChain([a, b]);
    // Eski bug: i+1'e bakıyordu → son eleman kontrolsüz kalıyordu → ok: true dönüyordu
    // Düzeltme: i-1'e bakıyor → b'nin prev_hash uyumsuzluğunu yakalar
    expect(result.ok).toBe(false);
    expect(result.brokenIndex).toBe(1);
  });

  test('hash alanı yoksa hash kontrolü atlanır, sadece prev_hash kontrol edilir', () => {
    const a = { prev_hash: 'GENESIS', at: 't1', action: 'IN', user: 'u', role: 'S', message: 'm' };
    a.hash = buildAuditHash(a);
    const b = { prev_hash: a.hash, at: 't2', action: 'OUT', user: 'u', role: 'S', message: 'm' };
    // b.hash yok — hash kontrolü atlanmalı, sadece prev_hash bakılmalı
    expect(verifyAuditChain([a, b])).toEqual({ ok: true, brokenIndex: -1 });
  });
});
