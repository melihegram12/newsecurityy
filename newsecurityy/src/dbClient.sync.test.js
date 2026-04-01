const mockSupabase = {
  from: jest.fn(),
};

jest.mock('./supabaseClient', () => ({
  supabase: mockSupabase,
}));

describe('dbClient created_at integrity guards', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.clearAllTimers();
    localStorage.clear();
    delete window.electronAPI;
    delete window.Capacitor;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete window.electronAPI;
    delete window.Capacitor;
  });

  function loadDbClient({ electronDb = null } = {}) {
    if (electronDb) {
      window.electronAPI = { db: electronDb };
    } else {
      delete window.electronAPI;
    }

    return require('./dbClient');
  }

  function buildConflictError() {
    return {
      code: '42P10',
      message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
    };
  }

  test('syncToSupabase INSERT fails fast instead of falling back to plain insert when created_at conflict protection is unavailable', async () => {
    const upsertSelect = jest.fn().mockResolvedValue({
      data: null,
      error: buildConflictError(),
    });
    const insertSelect = jest.fn().mockResolvedValue({
      data: [{ id: 'should-not-insert' }],
      error: null,
    });
    const insert = jest.fn(() => ({ select: insertSelect }));
    const upsert = jest.fn(() => ({ select: upsertSelect }));

    mockSupabase.from.mockReturnValue({ upsert, insert });

    const { syncToSupabase, getSyncStatus } = loadDbClient();

    const result = await syncToSupabase('INSERT', {
      type: 'vehicle',
      plate: '34 SAFE 001',
      created_at: '2026-04-01T10:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/created_at/i);
    expect(result.error?.message).toMatch(/unique|schema/i);
    expect(insert).not.toHaveBeenCalled();

    const queue = JSON.parse(localStorage.getItem('supabase_sync_queue') || '[]');
    expect(queue).toHaveLength(1);

    const status = getSyncStatus();
    expect(status.lastPushStatus).toBe('error');
    expect(status.lastPushError).toMatch(/created_at/i);
  });

  test('exportLocalLogsToSupabase fails fast instead of plain insert fallback when created_at conflict protection is unavailable', async () => {
    const upsert = jest.fn().mockResolvedValue({
      error: buildConflictError(),
    });
    const insert = jest.fn().mockResolvedValue({
      error: null,
    });

    mockSupabase.from.mockReturnValue({ upsert, insert });

    const electronDb = {
      getLogsCount: jest.fn().mockResolvedValue(1),
      getLogsPage: jest.fn().mockResolvedValue([
        {
          type: 'vehicle',
          plate: '34 SAFE 002',
          created_at: '2026-04-01T10:05:00.000Z',
          exit_at: null,
        },
      ]),
      getAllLogs: jest.fn().mockResolvedValue([]),
    };

    const { exportLocalLogsToSupabase, getSyncStatus } = loadDbClient({ electronDb });

    const result = await exportLocalLogsToSupabase({ pageSize: 50 });

    expect(result.ok).toBe(false);
    expect(result.error?.message).toMatch(/created_at/i);
    expect(result.error?.message).toMatch(/unique|schema/i);
    expect(insert).not.toHaveBeenCalled();

    const status = getSyncStatus();
    expect(status.lastBulkExportStatus).toBe('error');
    expect(status.lastBulkExportError).toMatch(/created_at/i);
  });
});
