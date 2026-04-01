import { getLogBindingId, resolveOfflineSyncAction } from './log-sync-utils';

describe('log-sync-utils', () => {
  test('getLogBindingId prefers created_at over transient id', () => {
    expect(getLogBindingId({
      id: 'remote-uuid-1',
      created_at: '2026-03-20T10:00:00.000Z',
    })).toBe('2026-03-20T10:00:00.000Z');
  });

  test('getLogBindingId falls back to id when created_at is missing', () => {
    expect(getLogBindingId({ id: 'remote-uuid-2' })).toBe('remote-uuid-2');
  });

  test('resolveOfflineSyncAction targets updates by created_at even when a local id exists', () => {
    expect(resolveOfflineSyncAction({
      action: 'UPDATE',
      id: 'local-17',
      localId: '2026-03-20T10:00:00.000Z',
      data: {
        created_at: '2026-03-20T10:00:00.000Z',
        exit_at: '2026-03-20T11:00:00.000Z',
        note: 'Çıkış işlendi',
      },
    })).toEqual({
      action: 'UPDATE',
      matchField: 'created_at',
      matchValue: '2026-03-20T10:00:00.000Z',
      payload: {
        exit_at: '2026-03-20T11:00:00.000Z',
        note: 'Çıkış işlendi',
      },
    });
  });

  test('resolveOfflineSyncAction keeps idless optimistic records addressable by created_at', () => {
    expect(resolveOfflineSyncAction({
      action: 'DELETE',
      data: {
        created_at: '2026-03-20T10:00:00.000Z',
      },
    })).toEqual({
      action: 'DELETE',
      matchField: 'created_at',
      matchValue: '2026-03-20T10:00:00.000Z',
      payload: null,
    });
  });
});
