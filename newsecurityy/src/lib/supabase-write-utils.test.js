import { executeWithSupabaseColumnFallback } from './supabase-write-utils';

describe('executeWithSupabaseColumnFallback', () => {
  test('retries inserts after removing unsupported columns one by one', async () => {
    const attempts = [];
    const execute = jest.fn(async (payload) => {
      attempts.push({ ...payload });

      if ('entry_location' in payload) {
        return { data: null, error: { message: 'column "entry_location" does not exist' } };
      }

      if ('exit_location' in payload) {
        return { data: null, error: { message: 'column "exit_location" does not exist' } };
      }

      return { data: [{ id: 'row-1' }], error: null };
    });

    const result = await executeWithSupabaseColumnFallback(execute, {
      plate: '34 TEST 34',
      entry_location: 'Merkez',
      exit_location: 'Depo',
      created_at: '2026-04-09T09:00:00.000Z',
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: 'row-1' }]);
    expect(attempts).toEqual([
      {
        plate: '34 TEST 34',
        entry_location: 'Merkez',
        exit_location: 'Depo',
        created_at: '2026-04-09T09:00:00.000Z',
      },
      {
        plate: '34 TEST 34',
        exit_location: 'Depo',
        created_at: '2026-04-09T09:00:00.000Z',
      },
      {
        plate: '34 TEST 34',
        created_at: '2026-04-09T09:00:00.000Z',
      },
    ]);
  });

  test('returns the original error when it is not a missing-column failure', async () => {
    const error = { message: 'permission denied for table security_logs' };
    const execute = jest.fn(async () => ({ data: null, error }));

    const result = await executeWithSupabaseColumnFallback(execute, {
      plate: '34 TEST 35',
    });

    expect(result.error).toBe(error);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
