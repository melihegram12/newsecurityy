/**
 * ARAÇ KAYIT BİLGİSİ - MART.xlsx
 * 25 ve 26 Mart 2026 verilerini doğrudan Supabase'e upsert eder.
 * Çalıştırma: node scripts/push-mart-25-26-to-supabase.js [--dry-run]
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { readWorkbookArraySheets } = require('./lib/exceljs-utils');

const EXCEL_PATH = 'C:/Users/ENGINME1/Desktop/ARAÇ KAYIT BİLGİSİ - MART.xlsx';
const DRY_RUN = process.argv.includes('--dry-run');

const MAR_25 = 46106;
const MAR_26 = 46107;
const TARGET_SERIALS = new Set([MAR_25, MAR_26]);

// Türkiye sabit UTC+3 (2016'dan beri DST yok)
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};

  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return acc;

      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) return acc;

      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      acc[key] = value;
      return acc;
    }, {});
}

function getSupabaseConfig() {
  const fileEnv = readEnvFile(path.join(__dirname, '..', '.env'));
  const supabaseUrl = (
    process.env.NEW_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    fileEnv.NEW_SUPABASE_URL ||
    fileEnv.SUPABASE_URL ||
    process.env.REACT_APP_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    fileEnv.REACT_APP_SUPABASE_URL ||
    fileEnv.VITE_SUPABASE_URL ||
    ''
  ).trim();
  const supabaseKey = (
    process.env.NEW_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    fileEnv.NEW_SERVICE_ROLE_KEY ||
    fileEnv.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase URL or service-role key in .env.');
  }

  return { supabaseUrl, supabaseKey };
}

function excelToISO(serial, timeFraction) {
  if (!serial || (timeFraction === '' || timeFraction === null || timeFraction === undefined)) return null;
  const tf = Number(timeFraction);
  if (isNaN(tf)) return null;
  const base = new Date(Date.UTC(1899, 11, 30));
  // Excel saatleri Türkiye yerel saati → UTC'ye çevir (-3 saat)
  const localMs = base.getTime() + serial * 86400000 + tf * 86400000;
  return new Date(localMs - TR_OFFSET_MS).toISOString();
}

function getShift(isoStr) {
  if (!isoStr) return 'Vardiya 1 (08:00-16:00)';
  // UTC saatine +3 ekle (TR)
  const localHour = (new Date(isoStr).getUTCHours() + 3) % 24;
  if (localHour >= 8 && localHour < 16) return 'Vardiya 1 (08:00-16:00)';
  if (localHour >= 16) return 'Vardiya 2 (16:00-00:00)';
  return 'Vardiya 3 (00:00-08:00)';
}

function t(v) { return v ? String(v).trim() : null; }

function makeVehicle({ serial, plate, driver, host, note, entrySec, exitSec, sub, sealIn, sealOut }) {
  const created_at = excelToISO(serial, entrySec);
  if (!created_at || !t(plate)) return null;
  const exit_at = (exitSec !== '' && exitSec !== null && exitSec !== undefined) ? excelToISO(serial, exitSec) : null;
  return {
    type: 'vehicle',
    sub_category: sub,
    shift: getShift(created_at),
    plate: t(plate).toUpperCase(),
    driver: t(driver),
    name: null,
    host: t(host),
    note: t(note),
    location: null,
    seal_number: (sealIn && sealOut) ? `${sealIn}→${sealOut}` : null,
    seal_number_entry: sealIn ? String(sealIn) : null,
    seal_number_exit: sealOut ? String(sealOut) : null,
    tc_no: null,
    phone: null,
    user_email: 'import@local',
    created_at,
    exit_at,
  };
}

function makeVisitor({ serial, name, host, note, entrySec, exitSec }) {
  const created_at = excelToISO(serial, entrySec);
  if (!created_at || !t(name)) return null;
  const exit_at = (exitSec !== '' && exitSec !== null && exitSec !== undefined) ? excelToISO(serial, exitSec) : null;
  return {
    type: 'visitor',
    sub_category: 'Misafir',
    shift: getShift(created_at),
    plate: null,
    driver: null,
    name: t(name),
    host: t(host),
    note: t(note),
    location: null,
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

function rows(wb, name) {
  return wb[name] || [];
}

function extractLogs(wb) {
  const logs = [];

  rows(wb, 'B.YAKA ARAÇ').forEach((r, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(r[0]))) return;
    const l = makeVehicle({ serial: r[0], plate: r[1], driver: r[2], host: null, note: null, entrySec: r[3], exitSec: r[4], sub: 'Personel Aracı' });
    if (l) logs.push(l);
  });

  rows(wb, 'YÖNETİM ARAÇ').forEach((r, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(r[0]))) return;
    const l = makeVehicle({ serial: r[0], plate: r[1], driver: r[2], host: 'Yönetim', note: t(r[5]), entrySec: r[3], exitSec: r[4], sub: 'Yönetim Aracı' });
    if (l) logs.push(l);
  });

  rows(wb, 'MİSAFİR VE SİVİL ARAÇ').forEach((r, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(r[0]))) return;
    const l = makeVehicle({ serial: r[0], plate: r[1], driver: r[2], host: null, note: t(r[3]), entrySec: r[4], exitSec: r[5], sub: 'Misafir Araç' });
    if (l) logs.push(l);
  });

  rows(wb, 'MÜHÜRLÜ ARAÇLAR').forEach((r, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(r[0]))) return;
    const l = makeVehicle({ serial: r[0], plate: r[1], driver: r[2], host: t(r[3]), note: t(r[3]), entrySec: r[4], exitSec: r[5], sub: 'Mühürlü Araç', sealIn: r[6] || null, sealOut: r[7] || null });
    if (l) logs.push(l);
  });

  // Şirket araçları: kolon sırası TARİH | AD SOYAD | ÇIKIŞ | GİRİŞ | LOKASYON | AÇIKLAMA
  // Araç tesisten önce ÇIKIŞ yapar, sonra geri GİRİŞ yapar.
  // created_at = ÇIKIŞ (r[2]), exit_at = GİRİŞ (r[3])
  rows(wb, '34 GHK 292').forEach((r, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(r[0]))) return;
    const cikis = r[2]; // ÇIKIŞ = araç tesisten ayrılma = created_at
    const giris = r[3]; // GİRİŞ = araç tesise dönüş = exit_at
    const effectiveEntry = (cikis !== '') ? cikis : giris;
    const effectiveExit = (cikis !== '' && giris !== '') ? giris : null;
    const l = makeVehicle({ serial: r[0], plate: '34 GHK 292', driver: r[1], host: t(r[4]), note: t(r[5]), entrySec: effectiveEntry, exitSec: effectiveExit, sub: 'Şirket Aracı' });
    if (l) logs.push(l);
  });

  rows(wb, '34 MPP 153').forEach((r, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(r[0]))) return;
    const cikis = r[2];
    const giris = r[3];
    const effectiveEntry = (cikis !== '') ? cikis : giris;
    const effectiveExit = (cikis !== '' && giris !== '') ? giris : null;
    const l = makeVehicle({ serial: r[0], plate: '34 MPP 153', driver: r[1], host: t(r[4]), note: t(r[5]), entrySec: effectiveEntry, exitSec: effectiveExit, sub: 'Şirket Aracı' });
    if (l) logs.push(l);
  });

  rows(wb, 'DENEME-GÖRÜŞM').forEach((r, i) => {
    if (i === 0 || !TARGET_SERIALS.has(Number(r[0]))) return;
    const l = makeVisitor({ serial: r[0], name: r[1], host: t(r[3]), note: t(r[2]), entrySec: r[4], exitSec: r[5] });
    if (l) logs.push(l);
  });

  return logs;
}

async function run() {
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== SUPABASE PUSH ===\n');

  const wb = await readWorkbookArraySheets(EXCEL_PATH);
  const logs = extractLogs(wb);

  // Özet
  const bycat = {};
  logs.forEach(l => { bycat[l.sub_category] = (bycat[l.sub_category] || 0) + 1; });
  console.log(`Toplam ${logs.length} kayıt:\n`);
  Object.entries(bycat).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  if (DRY_RUN) {
    console.log('\n--- Tüm kayıtlar ---');
    logs.forEach(l => console.log(`${l.created_at?.substring(0,16)} | ${l.sub_category.padEnd(16)} | ${(l.plate || l.name || '').padEnd(14)} | ${l.driver || l.name || ''} | çıkış: ${l.exit_at?.substring(0,16) || '-'}`));
    return;
  }

  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  const supabase = createClient(supabaseUrl, supabaseKey);

  // created_at çakışmalarını önlemek için milisaniye offset ekle
  const seen = new Map();
  logs.forEach(l => {
    const base = l.created_at.substring(0, 19); // saniye hassasiyetine kes
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    if (count > 0) {
      // Aynı saniyedeki N. kayda N*100ms ekle
      const d = new Date(l.created_at);
      d.setMilliseconds(count * 100);
      l.created_at = d.toISOString();
    }
  });

  // Batch upsert (50'şer)
  const BATCH = 50;
  let ok = 0, fail = 0;

  for (let i = 0; i < logs.length; i += BATCH) {
    const chunk = logs.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('security_logs')
      .upsert(chunk, { onConflict: 'created_at' })
      .select('created_at');

    if (error) {
      console.error(`Batch ${i}-${i + chunk.length} HATA:`, error.message);
      fail += chunk.length;
    } else {
      ok += data.length;
      console.log(`Batch ${i + 1}-${i + chunk.length}: ${data.length} kayıt işlendi`);
    }
  }

  console.log(`\n✓ Tamamlandı`);
  console.log(`  Başarılı : ${ok}`);
  console.log(`  Hatalı   : ${fail}`);
  if (ok > 0) console.log('\nTüm cihazlarda uygulama sayfayı yenileyince veriler görünecek.');
}

run().catch(e => { console.error('HATA:', e.message); process.exit(1); });
