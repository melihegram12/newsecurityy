/**
 * ARAÇ KAYIT BİLGİSİ - MART.xlsx
 * 25 ve 26 Mart 2026 verilerini security_panel.db'ye import eder.
 * Çalıştırma: node scripts/import-mart-25-26.js [--dry-run]
 */

const XLSX = require('xlsx');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const EXCEL_PATH = 'C:/Users/ENGINME1/Desktop/ARAÇ KAYIT BİLGİSİ - MART.xlsx';
const DB_PATH = 'C:/Users/ENGINME1/AppData/Roaming/newsecurityy/security_panel.db';
const DRY_RUN = process.argv.includes('--dry-run');

// 25 ve 26 Mart 2026 Excel serial numaraları
const MAR_25 = 46106;
const MAR_26 = 46107;
const TARGET_SERIALS = new Set([MAR_25, MAR_26]);

// Türkiye sabit UTC+3 (2016'dan beri DST yok)
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

// Excel serial + time fraction → ISO string (Türkiye saati → UTC)
function excelToISO(serial, timeFraction) {
  if (!serial || !timeFraction && timeFraction !== 0) return null;
  const baseDate = new Date(Date.UTC(1899, 11, 30));
  const dayMs = serial * 86400000;
  const timeMs = (timeFraction || 0) * 86400000;
  // Excel saatleri Türkiye yerel saati → UTC'ye çevir (-3 saat)
  return new Date(baseDate.getTime() + dayMs + timeMs - TR_OFFSET_MS).toISOString();
}

function getShift(isoString) {
  if (!isoString) return 'Vardiya 1 (08:00-16:00)';
  const hour = new Date(isoString).getHours();
  if (hour >= 8 && hour < 16) return 'Vardiya 1 (08:00-16:00)';
  if (hour >= 16) return 'Vardiya 2 (16:00-00:00)';
  return 'Vardiya 3 (00:00-08:00)';
}

function trim(v) {
  return v ? String(v).trim() : '';
}

// ── Kayıt oluşturucular ──────────────────────────────────────────────────────

function makeVehicleLog({ serial, plate, driver, host, note, entrySec, exitSec, subCategory, sealEntry, sealExit }) {
  const created_at = excelToISO(serial, entrySec);
  const exit_at = exitSec ? excelToISO(serial, exitSec) : null;
  return {
    type: 'vehicle',
    sub_category: subCategory,
    shift: getShift(created_at),
    plate: trim(plate).toUpperCase(),
    driver: trim(driver) || null,
    name: null,
    host: trim(host) || null,
    note: trim(note) || null,
    location: null,
    entry_location: null,
    exit_location: null,
    seal_number: sealEntry && sealExit ? `${sealEntry}→${sealExit}` : null,
    seal_number_entry: sealEntry ? String(sealEntry) : null,
    seal_number_exit: sealExit ? String(sealExit) : null,
    tc_no: null,
    phone: null,
    user_email: 'import@local',
    created_at,
    exit_at,
  };
}

function makeVisitorLog({ serial, name, host, note, entrySec, exitSec }) {
  const created_at = excelToISO(serial, entrySec);
  const exit_at = exitSec ? excelToISO(serial, exitSec) : null;
  return {
    type: 'visitor',
    sub_category: 'Misafir',
    shift: getShift(created_at),
    plate: null,
    driver: null,
    name: trim(name) || null,
    host: trim(host) || null,
    note: trim(note) || null,
    location: null,
    entry_location: null,
    exit_location: null,
    seal_number: null,
    seal_number_entry: null,
    seal_number_exit: null,
    tc_no: null,
    phone: null,
    user_email: 'import@local',
    created_at,
    exit_at,
  };
}

// ── Excel'den kayıt çıkarma ──────────────────────────────────────────────────

function parseSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
}

function extractAllLogs(wb) {
  const logs = [];

  // 1. B.YAKA ARAÇ — Personel Aracı
  // Kolon: TARİH | PLAKA | AÇIKLAMA(şöför) | GİRİŞ | ÇIKIŞ
  parseSheet(wb, 'B.YAKA ARAÇ').forEach((row, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(row[0]))) return;
    if (!trim(row[1])) return;
    logs.push(makeVehicleLog({
      serial: Number(row[0]),
      plate: row[1],
      driver: row[2],
      host: null,
      note: null,
      entrySec: row[3] || null,
      exitSec: row[4] || null,
      subCategory: 'Personel Aracı',
    }));
  });

  // 2. YÖNETİM ARAÇ — Yönetim Aracı
  // Kolon: TARİH | PLAKA | AÇIKLAMA(şöför) | GİRİŞ | ÇIKIŞ | AÇIKLAMA2
  parseSheet(wb, 'YÖNETİM ARAÇ').forEach((row, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(row[0]))) return;
    if (!trim(row[1])) return;
    logs.push(makeVehicleLog({
      serial: Number(row[0]),
      plate: row[1],
      driver: row[2],
      host: 'Yönetim',
      note: trim(row[5]) || null,
      entrySec: row[3] || null,
      exitSec: row[4] || null,
      subCategory: 'Yönetim Aracı',
    }));
  });

  // 3. MİSAFİR VE SİVİL ARAÇ — Misafir Araç
  // Kolon: TARİH | PLAKA | AD SOYAD | AÇIKLAMA(firma) | GİRİŞ | ÇIKIŞ
  parseSheet(wb, 'MİSAFİR VE SİVİL ARAÇ').forEach((row, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(row[0]))) return;
    if (!trim(row[1])) return;
    logs.push(makeVehicleLog({
      serial: Number(row[0]),
      plate: row[1],
      driver: row[2],
      host: null,
      note: trim(row[3]) || null,
      entrySec: row[4] || null,
      exitSec: row[5] || null,
      subCategory: 'Misafir Araç',
    }));
  });

  // 4. MÜHÜRLÜ ARAÇLAR — Mühürlü Araç
  // Kolon: TARİH | PLAKA | AD SOYAD | FİRMA ADI | GİRİŞ | ÇIKIŞ | GİRİŞ MÜHÜR NO | ÇIKIŞ MÜHÜR NO
  parseSheet(wb, 'MÜHÜRLÜ ARAÇLAR').forEach((row, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(row[0]))) return;
    if (!trim(row[1])) return;
    logs.push(makeVehicleLog({
      serial: Number(row[0]),
      plate: row[1],
      driver: row[2],
      host: trim(row[3]) || null,
      note: trim(row[3]) || null,
      entrySec: row[4] || null,
      exitSec: row[5] || null,
      subCategory: 'Mühürlü Araç',
      sealEntry: row[6] || null,
      sealExit: row[7] || null,
    }));
  });

  // 5. 34 GHK 292 — Şirket Aracı
  // Kolon: TARİH | AD SOYAD | ÇIKIŞ | GİRİŞ | LOKASYON | AÇIKLAMA
  // Araç tesisten önce ÇIKIŞ (r[2]), sonra geri GİRİŞ (r[3]) yapar.
  // created_at = ÇIKIŞ, exit_at = GİRİŞ
  parseSheet(wb, '34 GHK 292').forEach((row, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(row[0]))) return;
    if (!trim(row[1])) return;
    const cikis = row[2] || null;
    const giris = row[3] || null;
    logs.push(makeVehicleLog({
      serial: Number(row[0]),
      plate: '34 GHK 292',
      driver: row[1],
      host: trim(row[4]) || null,
      note: trim(row[5]) || null,
      entrySec: cikis || giris,    // created_at = ÇIKIŞ zamanı
      exitSec: (cikis && giris) ? giris : null,  // exit_at = GİRİŞ zamanı
      subCategory: 'Şirket Aracı',
    }));
  });

  // 6. 34 MPP 153 — Şirket Aracı
  // Kolon: TARİH | AD SOYAD | ÇIKIŞ | GİRİŞ | LOKASYON | AÇIKLAMA
  parseSheet(wb, '34 MPP 153').forEach((row, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(row[0]))) return;
    if (!trim(row[1])) return;
    const cikis = row[2] || null;
    const giris = row[3] || null;
    logs.push(makeVehicleLog({
      serial: Number(row[0]),
      plate: '34 MPP 153',
      driver: row[1],
      host: trim(row[4]) || null,
      note: trim(row[5]) || null,
      entrySec: cikis || giris,
      exitSec: (cikis && giris) ? giris : null,
      subCategory: 'Şirket Aracı',
    }));
  });

  // 7. DENEME-GÖRÜŞM — Misafir (ziyaretçi)
  // Kolon: TARİH | AD SOYAD | AÇIKLAMA | GÖRÜŞECEĞİ KİŞİ | GİRİŞ | ÇIKIŞ | ZİYARETCİ KART NO
  parseSheet(wb, 'DENEME-GÖRÜŞM').forEach((row, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(row[0]))) return;
    if (!trim(row[1])) return;
    logs.push(makeVisitorLog({
      serial: Number(row[0]),
      name: row[1],
      host: trim(row[3]) || null,
      note: trim(row[2]) || null,
      entrySec: row[4] || null,
      exitSec: row[5] || null,
    }));
  });

  return logs;
}

// ── Veritabanına yaz ─────────────────────────────────────────────────────────

const INSERT_SQL = `
INSERT OR IGNORE INTO security_logs
  (type, sub_category, shift, plate, driver, name, host, note, location,
   entry_location, exit_location, seal_number, seal_number_entry, seal_number_exit,
   tc_no, phone, user_email, created_at, exit_at)
VALUES
  (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`;

async function run() {
  console.log(DRY_RUN ? '=== DRY RUN (veritabanına yazmıyor) ===' : '=== CANLI IMPORT ===');

  const wb = XLSX.readFile(EXCEL_PATH);
  const logs = extractAllLogs(wb);

  console.log(`\nToplam ${logs.length} kayıt bulundu:\n`);
  const bySheet = {};
  logs.forEach(l => {
    const k = `${l.sub_category} (${l.type})`;
    bySheet[k] = (bySheet[k] || 0) + 1;
  });
  Object.entries(bySheet).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  if (DRY_RUN) {
    console.log('\nÖrnek kayıtlar:');
    logs.slice(0, 3).forEach(l => console.log(JSON.stringify(l, null, 2)));
    return;
  }

  // DB yedek al
  const backupPath = DB_PATH + '.import-bak-' + new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(DB_PATH, backupPath);
  console.log(`\nYedek alındı: ${path.basename(backupPath)}`);

  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);

  let inserted = 0;
  let skipped = 0;

  for (const log of logs) {
    if (!log.created_at) { skipped++; continue; }
    try {
      db.run(INSERT_SQL, [
        log.type, log.sub_category, log.shift, log.plate, log.driver,
        log.name, log.host, log.note, log.location,
        log.entry_location, log.exit_location,
        log.seal_number, log.seal_number_entry, log.seal_number_exit,
        log.tc_no, log.phone, log.user_email,
        log.created_at, log.exit_at,
      ]);
      inserted++;
    } catch (e) {
      console.warn(`SKIP (conflict): ${log.plate || log.name} @ ${log.created_at} — ${e.message}`);
      skipped++;
    }
  }

  // Kaydet
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
  db.close();

  console.log(`\n✓ İşlem tamamlandı`);
  console.log(`  Eklendi : ${inserted}`);
  console.log(`  Atlandı : ${skipped} (zaten mevcut veya timestamp eksik)`);
  console.log(`\nUygulamayı yeniden başlatın — veriler görünecek.`);
}

run().catch(e => {
  console.error('HATA:', e.message);
  process.exit(1);
});
