import { dedupeLogsByCreatedAt, isMissingColumnError, mapCsvRowToImportRecord, mapCsvRowToLog } from './csv-utils';

describe('mapCsvRowToLog', () => {
  test('maps vehicle Excel rows with separate date and time columns', () => {
    const log = mapCsvRowToLog({
      'TARİH': '10.03.2026',
      'KAYNAK': 'B.YAKA ARAÇ',
      'PLAKA': '43 ADP 657',
      'AD SOYAD': 'ZAHİDE AKSOY',
      'FİRMA / AÇIKLAMA': '',
      'GİRİŞ': '08:00:00',
      'ÇIKIŞ': '22:01:00',
      'LOKASYON': '',
      'DETAY': ''
    });

    expect(log.type).toBe('vehicle');
    expect(log.sub_category).toBe('Personel Aracı');
    expect(log.shift).toBe('Vardiya 1 (08:00-16:00)');
    expect(log.plate).toBe('43 ADP 657');
    expect(log.name).toBe('ZAHİDE AKSOY');
    expect(log.driver).toBe('ZAHİDE AKSOY');
    expect(log.created_at).toEqual(expect.any(String));
    expect(log.exit_at).toEqual(expect.any(String));

    const entry = new Date(log.created_at);
    const exit = new Date(log.exit_at);
    expect(Number.isNaN(entry.getTime())).toBe(false);
    expect(Number.isNaN(exit.getTime())).toBe(false);
    expect(exit.getTime() - entry.getTime()).toBe((14 * 60 + 1) * 60 * 1000);
  });

  test('maps source plate rows to company vehicles', () => {
    const log = mapCsvRowToLog({
      'TARİH': '10.03.2026',
      'KAYNAK': '34 GHK 292',
      'PLAKA': '34 GHK 292',
      'AD SOYAD': 'MURAT CİK',
      'FİRMA / AÇIKLAMA': 'İREM DOĞRU BIRAKMA',
      'GİRİŞ': '10:28:00',
      'ÇIKIŞ': '10:24:00',
      'LOKASYON': 'NKD-1',
      'DETAY': ''
    });

    expect(log.type).toBe('vehicle');
    expect(log.sub_category).toBe('Şirket Aracı');
    expect(log.location).toBe('NKD-1');
    expect(log.driver).toBe('MURAT CİK');
    expect(log.note).toBe('İREM DOĞRU BIRAKMA');
    expect(new Date(log.created_at).toISOString()).toBe('2026-03-10T07:24:00.000Z');
    expect(new Date(log.exit_at).toISOString()).toBe('2026-03-10T07:28:00.000Z');
  });

  test('keeps company vehicle row open when return time is missing', () => {
    const log = mapCsvRowToLog({
      'TARİH': '16.03.2026',
      'KAYNAK': '34 GHK 292',
      'PLAKA': '34 GHK 292',
      'AD SOYAD': 'NİYAZİ TUNÇ',
      'FİRMA / AÇIKLAMA': 'NİYAZİ TUNÇ HİNTLİ PERSONEL HAVA ALANI BIRAKMA',
      'GİRİŞ': '',
      'ÇIKIŞ': '11:40:00',
      'LOKASYON': 'KÜTAHYA',
      'DETAY': ''
    });

    expect(log.sub_category).toBe('Şirket Aracı');
    expect(new Date(log.created_at).toISOString()).toBe('2026-03-16T08:40:00.000Z');
    expect(log.exit_at).toBeNull();
  });

  test('does not change normal vehicle chronology', () => {
    const log = mapCsvRowToLog({
      'TARİH': '18.03.2026',
      'KAYNAK': 'Misafir Sivil Araç',
      'PLAKA': '35 ABC 123',
      'AD SOYAD': 'DENEME SURUCU',
      'GİRİŞ': '09:15:00',
      'ÇIKIŞ': '11:45:00',
      'LOKASYON': 'FABRIKA',
      'DETAY': ''
    });

    expect(log.sub_category).toBe('Misafir Araç');
    expect(new Date(log.created_at).toISOString()).toBe('2026-03-18T06:15:00.000Z');
    expect(new Date(log.exit_at).toISOString()).toBe('2026-03-18T08:45:00.000Z');
  });
});

describe('mapCsvRowToImportRecord', () => {
  test('marks legacy company rows with missing return as warning instead of completed record', () => {
    const result = mapCsvRowToImportRecord({
      'TARİH': '16.03.2026',
      'KAYNAK': '34 MPP 153',
      'PLAKA': '34 MPP 153',
      'AD SOYAD': 'NİYAZİ TUNÇ',
      'GİRİŞ': '',
      'ÇIKIŞ': '11:40:00',
      'LOKASYON': 'KÜTAHYA',
    });

    expect(result.log).not.toBeNull();
    expect(result.log.exit_at).toBeNull();
    expect(result.warnings.map((item) => item.code)).toContain('legacy_company_missing_return');
    expect(result.errors).toHaveLength(0);
  });

  test('rejects explicit reverse chronology rows', () => {
    const result = mapCsvRowToImportRecord({
      created_at: '2026-03-20T10:28:00.000Z',
      exit_at: '2026-03-20T10:24:00.000Z',
      type: 'vehicle',
      sub_category: 'Şirket Aracı',
      plate: '34 GHK 292',
    });

    expect(result.log).toBeNull();
    expect(result.errors.map((item) => item.code)).toContain('exit_before_entry');
  });

  test('rejects rows that only have exit time without entry context', () => {
    const result = mapCsvRowToImportRecord({
      'TARİH': '20.03.2026',
      'KAYNAK': 'Misafir Sivil Araç',
      'PLAKA': '35 ABC 123',
      'AD SOYAD': 'DENEME SURUCU',
      'GİRİŞ': '',
      'ÇIKIŞ': '13:45:00',
    });

    expect(result.log).toBeNull();
    expect(result.errors.map((item) => item.code)).toContain('missing_entry_time');
  });

  test('rejects rows with no usable date', () => {
    const result = mapCsvRowToImportRecord({
      'KAYNAK': '34 GHK 292',
      'PLAKA': '34 GHK 292',
      'AD SOYAD': 'MURAT CİK',
      'GİRİŞ': '10:28:00',
      'ÇIKIŞ': '10:24:00',
    });

    expect(result.log).toBeNull();
    expect(result.errors.map((item) => item.code)).toContain('missing_created_at');
  });

  test('can parse legacy company and normal rows from the same file independently', () => {
    const rows = [
      {
        'TARİH': '10.03.2026',
        'KAYNAK': '34 GHK 292',
        'PLAKA': '34 GHK 292',
        'AD SOYAD': 'MURAT CİK',
        'GİRİŞ': '10:28:00',
        'ÇIKIŞ': '10:24:00',
      },
      {
        'TARİH': '10.03.2026',
        'KAYNAK': 'B.YAKA ARAÇ',
        'PLAKA': '43 ADP 657',
        'AD SOYAD': 'ZAHİDE AKSOY',
        'GİRİŞ': '08:00:00',
        'ÇIKIŞ': '22:01:00',
      },
    ];

    const results = rows.map(mapCsvRowToImportRecord);

    expect(results.every((item) => item.log)).toBe(true);
    expect(results[0].warnings.map((item) => item.code)).toHaveLength(0);
    expect(results[1].warnings.map((item) => item.code)).toHaveLength(0);
    expect(new Date(results[0].log.created_at).toISOString()).toBe('2026-03-10T07:24:00.000Z');
    expect(new Date(results[1].log.created_at).toISOString()).toBe('2026-03-10T05:00:00.000Z');
  });
});

describe('dedupeLogsByCreatedAt', () => {
  test('keeps distinct rows by shifting colliding timestamps', () => {
    const first = {
      type: 'vehicle',
      sub_category: 'Personel Aracı',
      plate: '43 ADP 657',
      name: 'ZAHİDE AKSOY',
      created_at: '2026-03-12T05:01:00.000Z',
      exit_at: '2026-03-12T14:08:00.000Z'
    };
    const second = {
      type: 'vehicle',
      sub_category: 'Personel Aracı',
      plate: '43 U 9397',
      name: 'MELTEM GÜNAY TEK',
      created_at: '2026-03-12T05:01:00.000Z',
      exit_at: '2026-03-12T14:34:00.000Z'
    };

    const { uniqueLogs, duplicateCount, adjustedCount } = dedupeLogsByCreatedAt([first, second, first]);

    expect(uniqueLogs).toHaveLength(2);
    expect(new Set(uniqueLogs.map((row) => row.created_at)).size).toBe(2);
    expect(duplicateCount).toBe(1);
    expect(adjustedCount).toBe(1);
  });
});

describe('isMissingColumnError', () => {
  test('does not confuse location with entry_location', () => {
    const error = { message: "Could not find the 'entry_location' column of 'security_logs' in the schema cache" };
    expect(isMissingColumnError(error, 'entry_location')).toBe(true);
    expect(isMissingColumnError(error, 'location')).toBe(false);
  });
});
