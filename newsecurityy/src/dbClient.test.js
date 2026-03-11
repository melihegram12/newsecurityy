import { webDB } from './dbClient';

beforeEach(() => {
  localStorage.removeItem(webDB.LOGS_KEY);
  localStorage.removeItem(webDB.SETTINGS_KEY);
});

test('webDB insertLog stores a record and keeps it active', async () => {
  const log = await webDB.insertLog({
    type: 'vehicle',
    plate: '34 ABC 123',
    created_at: '2026-02-02T10:00:00.000Z'
  });

  expect(log.id).toBeTruthy();
  expect(log.created_at).toBe('2026-02-02T10:00:00.000Z');

  const active = await webDB.getActiveLogs();
  expect(active).toHaveLength(1);
  expect(active[0].exit_at).toBeFalsy();
});

test('webDB exitLog marks record as exited and removes from active list', async () => {
  const log = await webDB.insertLog({
    type: 'visitor',
    name: 'Ali Veli'
  });

  await webDB.exitLog(log.id);

  const active = await webDB.getActiveLogs();
  expect(active).toHaveLength(0);

  const all = await webDB.getAllLogs();
  expect(all[0].exit_at).toBeTruthy();
});

test('webDB preserves separate entry and exit locations', async () => {
  const log = await webDB.insertLog({
    type: 'vehicle',
    plate: '34 XYZ 34',
    location: 'Merkez Ofis',
    entry_location: 'Merkez Ofis'
  });

  await webDB.updateLog(log.id, {
    location: 'Depo',
    exit_location: 'Depo'
  });

  const all = await webDB.getAllLogs();
  expect(all[0].entry_location).toBe('Merkez Ofis');
  expect(all[0].exit_location).toBe('Depo');
  expect(all[0].location).toBe('Depo');
});

test('webDB searchLogs finds plate or name', async () => {
  await webDB.insertLog({ type: 'vehicle', plate: '06 TEST 06', driver: 'Mehmet' });
  await webDB.insertLog({ type: 'visitor', name: 'Ay\u015fe Demir', host: 'Idari' });

  const byPlate = await webDB.searchLogs('TEST');
  expect(byPlate.length).toBeGreaterThan(0);
  expect(byPlate[0].plate).toContain('TEST');

  const byName = await webDB.searchLogs('Ayse');
  expect(byName.length).toBeGreaterThan(0);
  expect(byName[0].name).toContain('Ayşe');
});
