import { buildExitOptionLabel, getExitCandidates, resolveExitRecord } from './exit-utils';

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
  ];

  test('getExitCandidates filters by tab and sorts newest first', () => {
    const result = getExitCandidates(activeLogs, 'vehicle');

    expect(result.map((log) => log.id)).toEqual(['veh-2', 'veh-1']);
  });

  test('resolveExitRecord prefers selected id over text lookup', () => {
    const result = resolveExitRecord({
      selectedExitLogId: 'veh-2',
      activeLogs,
      allLogs: activeLogs,
      mainTab: 'vehicle',
      rawIdentifier: '34 ABC 123',
    });

    expect(result.reason).toBe('selected');
    expect(result.record?.id).toBe('veh-2');
    expect(result.record?.plate).toBe('35 XYZ 456');
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
