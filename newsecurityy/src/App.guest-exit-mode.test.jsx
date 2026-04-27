import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const mockGetSetting = jest.fn();
const mockGetActiveLogs = jest.fn();
const mockGetAllLogs = jest.fn();
const mockSetSetting = jest.fn();
const mockInsertLog = jest.fn();
const mockUpdateLog = jest.fn();
const mockDeleteLog = jest.fn();
const mockExitLog = jest.fn();
const mockGetSyncStatus = jest.fn();
const mockSupabaseFrom = jest.fn();
let mockIsElectron = true;

jest.mock('./dbClient', () => ({
  db: {
    getSetting: (...args) => mockGetSetting(...args),
    getActiveLogs: (...args) => mockGetActiveLogs(...args),
    getAllLogs: (...args) => mockGetAllLogs(...args),
    setSetting: (...args) => mockSetSetting(...args),
    insertLog: (...args) => mockInsertLog(...args),
    updateLog: (...args) => mockUpdateLog(...args),
    deleteLog: (...args) => mockDeleteLog(...args),
    exitLog: (...args) => mockExitLog(...args),
  },
  get isElectron() {
    return mockIsElectron;
  },
  isMobile: false,
  processSyncQueue: jest.fn(),
  processLocalSyncQueue: jest.fn(),
  syncFromSupabase: jest.fn(),
  syncFromLocalApi: jest.fn(),
  exportLocalLogsToSupabase: jest.fn(),
  getSyncStatus: (...args) => mockGetSyncStatus(...args),
}));

jest.mock('./supabaseClient', () => ({
  supabase: {
    from: (...args) => mockSupabaseFrom(...args),
    auth: {
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
    },
  },
}));

describe('App anonymous guest exit mode', () => {
  beforeEach(() => {
    mockIsElectron = true;
    mockGetSetting.mockResolvedValue(null);
    mockGetActiveLogs.mockResolvedValue([]);
    mockGetAllLogs.mockResolvedValue([]);
    mockSetSetting.mockResolvedValue(null);
    mockInsertLog.mockResolvedValue({ id: 'log-1' });
    mockUpdateLog.mockResolvedValue(null);
    mockDeleteLog.mockResolvedValue(null);
    mockExitLog.mockResolvedValue({ success: true });
    mockGetSyncStatus.mockReturnValue({});
    mockSupabaseFrom.mockReset();
    mockSupabaseFrom.mockImplementation(() => ({
      select: jest.fn(() => ({
        is: jest.fn(() => ({
          order: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
        order: jest.fn(() => ({
          limit: jest.fn().mockResolvedValue({ data: [], error: null }),
        })),
        limit: jest.fn().mockResolvedValue({ data: [], error: null }),
      })),
      insert: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      is: jest.fn(),
      eq: jest.fn(),
      order: jest.fn(),
      limit: jest.fn(),
    }));
    localStorage.clear();
    window.electronAPI = {
      backup: { getStatus: jest.fn().mockResolvedValue({ success: true }) },
      scheduler: { getStatus: jest.fn().mockResolvedValue({ enabled: false }) },
      email: {
        getSettings: jest.fn().mockResolvedValue({ enabled: false }),
        sendDailyReport: jest.fn().mockResolvedValue({ success: true }),
      },
      updater: { setUpdateUrl: jest.fn().mockResolvedValue('') },
      app: { quit: jest.fn() },
      db: {
        importLogs: jest.fn().mockResolvedValue({ success: true, data: [] }),
        upsertLogByCreatedAt: jest.fn().mockResolvedValue({ success: true, data: null }),
      },
    };
    global.Audio = jest.fn(() => ({
      play: jest.fn().mockResolvedValue(),
      pause: jest.fn(),
      currentTime: 0,
    }));
  });

  test('opens restricted vehicle exit mode directly when there is no session', async () => {
    render(<App />);

    expect(await screen.findByText(/Sadece araç çıkışı yapılabilir/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rol Girişi/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Giriş Yap/i })).not.toBeInTheDocument();
  });

  test('does not show user identity or build version under the main title', async () => {
    render(<App />);

    expect(await screen.findByText(/Malhotra/i)).toBeInTheDocument();
    expect(screen.queryByText(/guvenlik@local/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^v(dev|\d)/i)).not.toBeInTheDocument();
  });

  test('shows the role login screen without a separate guest exit action', async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Rol Girişi/i }));

    expect(await screen.findByRole('button', { name: /Giriş Yap/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Girişsiz Araç Çıkışı/i })).not.toBeInTheDocument();
  });
  test('still renders when localStorage access throws during boot', async () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    render(<App />);

    expect(await screen.findByText(/Malhotra/i)).toBeInTheDocument();

    getItemSpy.mockRestore();
  });

  test('handles online event when offline queue storage read throws', async () => {
    mockIsElectron = false;

    render(<App />);
    expect(await screen.findByText(/Malhotra/i)).toBeInTheDocument();

    mockSupabaseFrom.mockClear();
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'security_offline_queue') {
        throw new Error('storage blocked');
      }
      return null;
    });

    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(mockSupabaseFrom).toHaveBeenCalled());
    expect(screen.getByText(/Malhotra/i)).toBeInTheDocument();

    getItemSpy.mockRestore();
  });
});
