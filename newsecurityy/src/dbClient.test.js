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

test('webDB exitLog rejects duplicate exit attempts on the same record', async () => {
  const log = await webDB.insertLog({
    type: 'vehicle',
    plate: '34 SAFE 34'
  });

  await webDB.exitLog(log.id);

  await expect(webDB.exitLog(log.id)).rejects.toThrow('Bu kayıt zaten çıkış yapmış görünüyor.');
});

test('webDB exitLog rejects stale or missing record ids', async () => {
  await expect(webDB.exitLog('missing-log-id')).rejects.toThrow('Çıkış yapılacak kayıt bulunamadı.');
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

test('webDB rejects reverse chronology on insert', async () => {
  await expect(webDB.insertLog({
    type: 'vehicle',
    plate: '34 CHRON 34',
    created_at: '2026-03-20T10:00:00.000Z',
    exit_at: '2026-03-20T09:30:00.000Z'
  })).rejects.toThrow('Çıkış saati giriş saatinden önce olamaz.');
});

test('webDB rejects reverse chronology on update', async () => {
  const log = await webDB.insertLog({
    type: 'vehicle',
    plate: '34 SAFE 34',
    created_at: '2026-03-20T08:00:00.000Z'
  });

  await expect(webDB.updateLog(log.id, {
    exit_at: '2026-03-20T07:30:00.000Z'
  })).rejects.toThrow('Çıkış saati giriş saatinden önce olamaz.');

  const all = await webDB.getAllLogs();
  expect(all[0].exit_at).toBeFalsy();
});
