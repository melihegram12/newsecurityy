import React from 'react';
import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getActiveLogs: vi.fn(),
  getAllLogs: vi.fn(),
  setSetting: vi.fn(),
  insertLog: vi.fn(),
  updateLog: vi.fn(),
  deleteLog: vi.fn(),
  exitLog: vi.fn(),
  getSyncStatus: vi.fn(),
  supabaseFrom: vi.fn(),
  isElectron: true,
}));

vi.mock('./dbClient', () => ({
  db: {
    getSetting: (...args) => mocks.getSetting(...args),
    getActiveLogs: (...args) => mocks.getActiveLogs(...args),
    getAllLogs: (...args) => mocks.getAllLogs(...args),
    setSetting: (...args) => mocks.setSetting(...args),
    insertLog: (...args) => mocks.insertLog(...args),
    updateLog: (...args) => mocks.updateLog(...args),
    deleteLog: (...args) => mocks.deleteLog(...args),
    exitLog: (...args) => mocks.exitLog(...args),
  },
  get isElectron() {
    return mocks.isElectron;
  },
  isMobile: false,
  processSyncQueue: vi.fn(),
  processLocalSyncQueue: vi.fn(),
  syncFromSupabase: vi.fn(),
  syncFromLocalApi: vi.fn(),
  exportLocalLogsToSupabase: vi.fn(),
  getSyncStatus: (...args) => mocks.getSyncStatus(...args),
}));

vi.mock('./supabaseClient', () => ({
  supabase: {
    from: (...args) => mocks.supabaseFrom(...args),
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

describe('App anonymous guest exit mode', () => {
  beforeEach(() => {
    mocks.isElectron = true;
    mocks.getSetting.mockResolvedValue(null);
    mocks.getActiveLogs.mockResolvedValue([]);
    mocks.getAllLogs.mockResolvedValue([]);
    mocks.setSetting.mockResolvedValue(null);
    mocks.insertLog.mockResolvedValue({ id: 'log-1' });
    mocks.updateLog.mockResolvedValue(null);
    mocks.deleteLog.mockResolvedValue(null);
    mocks.exitLog.mockResolvedValue({ success: true });
    mocks.getSyncStatus.mockReturnValue({});
    mocks.supabaseFrom.mockReset();
    mocks.supabaseFrom.mockImplementation(() => ({
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
    mocks.isElectron = false;

    render(<App />);
    expect(await screen.findByText(/Malhotra/i)).toBeInTheDocument();

    mocks.supabaseFrom.mockClear();
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key) => {
      if (key === 'security_offline_queue') {
        throw new Error('storage blocked');
      }
      return null;
    });

    window.dispatchEvent(new Event('online'));

    await waitFor(() => expect(mocks.supabaseFrom).toHaveBeenCalled());
    expect(screen.getByText(/Malhotra/i)).toBeInTheDocument();

    getItemSpy.mockRestore();
  });
});
