const assert = require('node:assert/strict');

const localImport = require('./import-security-excel.js');
const supabaseImport = require('./import-security-excel-to-supabase.js');

function run() {
  {
    const row = {
      'TARİH': '10.03.2026',
      'KAYNAK': '34 GHK 292',
      'PLAKA': '34 GHK 292',
      'AD SOYAD': 'MURAT CİK',
      'GİRİŞ': '10:28:00',
      'ÇIKIŞ': '10:24:00',
      'LOKASYON': 'NKD-1',
    };
    const log = localImport.mapRow(row);
    assert.equal(log.sub_category, 'Şirket Aracı');
    assert.equal(new Date(log.created_at).toISOString(), '2026-03-10T07:24:00.000Z');
    assert.equal(new Date(log.exit_at).toISOString(), '2026-03-10T07:28:00.000Z');
  }

  {
    const row = {
      'TARİH': '16.03.2026',
      'KAYNAK': '34 MPP 153',
      'PLAKA': '34 MPP 153',
      'AD SOYAD': 'NİYAZİ TUNÇ',
      'GİRİŞ': '',
      'ÇIKIŞ': '11:40:00',
      'LOKASYON': 'KÜTAHYA',
    };
    const log = localImport.mapRow(row);
    assert.equal(new Date(log.created_at).toISOString(), '2026-03-16T08:40:00.000Z');
    assert.equal(log.exit_at, null);
  }

  {
    const row = {
      'TARİH': '18.03.2026',
      'KAYNAK': 'Misafir Sivil Araç',
      'PLAKA': '35 ABC 123',
      'AD SOYAD': 'DENEME SURUCU',
      'GİRİŞ': '09:15:00',
      'ÇIKIŞ': '11:45:00',
    };
    const log = localImport.mapRow(row);
    assert.equal(log.sub_category, 'Misafir Araç');
    assert.equal(new Date(log.created_at).toISOString(), '2026-03-18T06:15:00.000Z');
    assert.equal(new Date(log.exit_at).toISOString(), '2026-03-18T08:45:00.000Z');
  }

  {
    const row = {
      'TARİH': '10.03.2026',
      'KAYNAK': '34 GHK 292',
      'PLAKA': '34 GHK 292',
      'AD SOYAD': 'MURAT CİK',
      'GİRİŞ': '10:28:00',
      'ÇIKIŞ': '10:24:00',
    };
    const log = supabaseImport.mapRow(row);
    assert.equal(log.sub_category, 'Şirket Aracı');
    assert.equal(new Date(log.created_at).toISOString(), '2026-03-10T07:24:00.000Z');
    assert.equal(new Date(log.exit_at).toISOString(), '2026-03-10T07:28:00.000Z');
  }

  console.log('script import tests: ok');
}

run();
