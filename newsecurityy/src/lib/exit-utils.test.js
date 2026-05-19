import {
  buildExitOptionLabel,
  getExitCandidates,
  matchesVehicleSubCategory,
  resolveExitRecord,
  shouldCreateIndependentExit,
  shouldAskVehicleEntryLocation,
  shouldAskVehicleExitLocation,
} from './exit-utils';

describe('exit-utils', () => {
  const now = Date.now();
  const activeLogs = [
    {
      id: 'veh-1',
      type: 'vehicle',
      sub_category: 'Misafir Araç',
      plate: '34 ABC 123',
      driver: 'AHMET YILMAZ',
      host: 'Depo',
      entry_location: 'Merkez',
      created_at: new Date(now - 60_000).toISOString(),
      exit_at: null,
    },
    {
      id: 'veh-2',
      type: 'vehicle',
      sub_category: 'Misafir Araç',
      plate: '35 XYZ 456',
      driver: 'AHMET YILMAZ',
      host: 'Lojistik',
      entry_location: 'Liman',
      created_at: new Date(now - 10_000).toISOString(),
      exit_at: null,
    },
    {
      id: 'vis-1',
      type: 'visitor',
      name: 'ALİ DEMİR',
      host: 'İdari',
      created_at: new Date(now - 20_000).toISOString(),
      exit_at: null,
    },
    {
      id: 'vis-2',
      type: 'visitor',
      name: 'ALİ DEMİR',
      host: 'Üretim',
      created_at: new Date(now - 5_000).toISOString(),
      exit_at: null,
    },
    {
      id: 'veh-company-1',
      type: 'vehicle',
      sub_category: 'Şirket Aracı',
      plate: '34 CMP 789',
      driver: 'MEHMET KAYA',
      host: 'Şirket',
      created_at: new Date(now - 30_000).toISOString(),
      exit_at: null,
    },
    {
      id: 'veh-company-entry-variant',
      type: 'vehicle',
      sub_category: 'Şirket Aracı (Giriş)',
      plate: '34 CMP 999',
      driver: 'AYSE KAYA',
      host: 'Şirket',
      created_at: new Date(now - 25_000).toISOString(),
      exit_at: null,
    },
  ];

  test('getExitCandidates filters by tab and sorts newest first', () => {
    const result = getExitCandidates(activeLogs, 'vehicle');

    expect(result.map((log) => log.id)).toEqual(['veh-2', 'veh-company-entry-variant', 'veh-company-1', 'veh-1']);
  });

  test('getExitCandidates filters by vehicleSubTab when provided', () => {
    const companyOnly = getExitCandidates(activeLogs, 'vehicle', 'company');
    expect(companyOnly.map((log) => log.id)).toEqual(['veh-company-entry-variant', 'veh-company-1']);

    const guestOnly = getExitCandidates(activeLogs, 'vehicle', 'guest');
    expect(guestOnly.map((log) => log.id)).toEqual(['veh-2', 'veh-1']);
  });

  test('resolveExitRecord with vehicleSubTab only matches correct sub_category', () => {
    const result = resolveExitRecord({
      activeLogs,
      allLogs: activeLogs,
      mainTab: 'vehicle',
      rawIdentifier: '34 CMP 789',
      vehicleSubTab: 'company',
    });

    expect(result.reason).toBe('identifier');
    expect(result.record?.id).toBe('veh-company-1');
  });

  test('resolveExitRecord with wrong vehicleSubTab still finds record via cross-subtab fallback', () => {
    const result = resolveExitRecord({
      activeLogs,
      allLogs: activeLogs,
      mainTab: 'vehicle',
      rawIdentifier: '34 CMP 789',
      vehicleSubTab: 'guest',
    });

    // Gün-sonu / yanlış sekme senaryosu: araç içerde, operatör farklı sekmede
    // → çıkış yine de yapılabilmeli (içerideki kayıt bulunsun).
    expect(result.reason).toBe('identifier_cross_subtab');
    expect(result.record?.id).toBe('veh-company-1');
  });

  test('matchesVehicleSubCategory accepts company entry variants', () => {
    expect(matchesVehicleSubCategory({ sub_category: 'Şirket Aracı (Giriş)' }, 'company')).toBe(true);
    expect(matchesVehicleSubCategory({ sub_category: 'Şirket Aracı Eski' }, 'company')).toBe(true);
    expect(matchesVehicleSubCategory({ sub_category: 'Misafir Araç' }, 'company')).toBe(false);
  });

  test('shouldAskVehicleExitLocation only asks for managed vehicle delegated drivers', () => {
    for (const driverType of ['driver', 'supervisor', 'manual']) {
      expect(shouldAskVehicleExitLocation({
        mainTab: 'vehicle',
        isExitDirection: true,
        vehicleSubTab: 'management',
        driverType,
      })).toBe(true);
    }

    for (const [vehicleSubTab, driverType] of [
      ['guest', 'driver'],
      ['staff', 'driver'],
      ['sealed', 'driver'],
      ['company', 'driver'],
      ['management', 'owner'],
      ['management', 'other'],
    ]) {
      expect(shouldAskVehicleExitLocation({
        mainTab: 'vehicle',
        isExitDirection: true,
        vehicleSubTab,
        driverType,
      })).toBe(false);
    }

    expect(shouldAskVehicleExitLocation({
      mainTab: 'visitor',
      isExitDirection: true,
      vehicleSubTab: 'management',
      driverType: 'driver',
    })).toBe(false);
  });

  test('shouldAskVehicleEntryLocation excludes the hidden service tab', () => {
    expect(shouldAskVehicleEntryLocation({
      mainTab: 'vehicle',
      isEntryDirection: true,
      vehicleSubTab: 'company',
      driverType: 'other',
    })).toBe(true);
    expect(shouldAskVehicleEntryLocation({
      mainTab: 'vehicle',
      isEntryDirection: true,
      vehicleSubTab: 'management',
      driverType: 'driver',
    })).toBe(true);
    expect(shouldAskVehicleEntryLocation({
      mainTab: 'vehicle',
      isEntryDirection: true,
      vehicleSubTab: 'management',
      driverType: 'owner',
    })).toBe(false);
    expect(shouldAskVehicleEntryLocation({
      mainTab: 'vehicle',
      isEntryDirection: true,
      vehicleSubTab: 'service',
      driverType: 'other',
    })).toBe(false);
  });

  test('shouldCreateIndependentExit treats company vehicle exits as movement records', () => {
    expect(shouldCreateIndependentExit({
      mainTab: 'vehicle',
      isExitDirection: true,
      vehicleSubTab: 'company',
    })).toBe(true);
    expect(shouldCreateIndependentExit({
      mainTab: 'vehicle',
      isExitDirection: true,
      vehicleSubTab: 'guest',
    })).toBe(false);
    expect(shouldCreateIndependentExit({
      mainTab: 'vehicle',
      isExitDirection: false,
      vehicleSubTab: 'company',
    })).toBe(false);
  });

  test('resolveExitRecord uses typed identifier instead of a stale selected id', () => {
    const result = resolveExitRecord({
      selectedExitLogId: 'veh-2',
      activeLogs,
      allLogs: activeLogs,
      mainTab: 'vehicle',
      rawIdentifier: '34 ABC 123',
    });

    expect(result.reason).toBe('identifier');
    expect(result.record?.id).toBe('veh-1');
    expect(result.record?.plate).toBe('34 ABC 123');
  });

  test('resolveExitRecord keeps selected id when typed identifier matches it', () => {
    const result = resolveExitRecord({
      selectedExitLogId: 'veh-2',
      activeLogs,
      allLogs: activeLogs,
      mainTab: 'vehicle',
      rawIdentifier: '35 XYZ 456',
    });

    expect(result.reason).toBe('selected');
    expect(result.record?.id).toBe('veh-2');
  });

  test('resolveExitRecord keeps working with selected id even when input is empty', () => {
    const result = resolveExitRecord({
      selectedExitLogId: 'veh-1',
      activeLogs,
      allLogs: activeLogs,
      mainTab: 'vehicle',
      rawIdentifier: '',
    });

    expect(result.reason).toBe('selected');
    expect(result.record?.id).toBe('veh-1');
  });

  test('resolveExitRecord accepts created_at based binding ids when remote ids change', () => {
    const log = {
      id: 'remote-veh-1',
      type: 'vehicle',
      plate: '34 SAFE 001',
      created_at: '2026-03-20T10:00:00.000Z',
      exit_at: null,
    };

    const result = resolveExitRecord({
      selectedExitLogId: '2026-03-20T10:00:00.000Z',
      activeLogs: [log],
      allLogs: [log],
      mainTab: 'vehicle',
      rawIdentifier: '',
    });

    expect(result.reason).toBe('selected');
    expect(result.record?.id).toBe('remote-veh-1');
  });

  test('resolveExitRecord reports ambiguous matches instead of choosing the first record', () => {
    const result = resolveExitRecord({
      activeLogs,
      allLogs: activeLogs,
      mainTab: 'visitor',
      rawIdentifier: 'ali demir',
    });

    expect(result.reason).toBe('ambiguous');
    expect(result.record).toBeNull();
    expect(result.matches).toHaveLength(2);
  });

  test('resolveExitRecord reports missing input when nothing is selected', () => {
    const result = resolveExitRecord({
      activeLogs,
      allLogs: activeLogs,
      mainTab: 'vehicle',
      rawIdentifier: '',
    });

    expect(result.reason).toBe('missing_input');
    expect(result.record).toBeNull();
  });

  test('buildExitOptionLabel includes identifier and contextual details', () => {
    const label = buildExitOptionLabel(activeLogs[0]);

    expect(label).toContain('34 ABC 123');
    expect(label).toContain('AHMET YILMAZ');
    expect(label).toContain('Depo');
    expect(label).toContain('Merkez');
  });
});
