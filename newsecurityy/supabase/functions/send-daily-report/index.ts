// Deno ve Nodemailer Entegrasyonu
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import nodemailer from "npm:nodemailer@6.9.7"

// SMTP ayarları (ENV üzerinden)
// Örnek Gmail:
// SMTP_HOST=smtp.gmail.com, SMTP_PORT=465, SMTP_SECURE=true, SMTP_USER=..., SMTP_PASS=...
const SMTP_HOST = Deno.env.get('SMTP_HOST') || 'smtp.gmail.com'
const SMTP_PORT = Number(Deno.env.get('SMTP_PORT') || '465')
const SMTP_SECURE = (Deno.env.get('SMTP_SECURE') || 'true').toLowerCase() === 'true'
const SMTP_USER = Deno.env.get('SMTP_USER') || ''
const SMTP_PASS = Deno.env.get('SMTP_PASS') || ''
const SMTP_FROM = Deno.env.get('SMTP_FROM') || SMTP_USER
const SMTP_FROM_NAME = Deno.env.get('SMTP_FROM_NAME') || 'Güvenlik Raporu'

// Supabase Credentials - Sadece standart isimler kullan
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const RECIPIENTS = (Deno.env.get('REPORT_RECIPIENTS') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

serve(async (req) => {
  try {
    // 1. Supabase Bağlantı Kontrolü
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(`Supabase credentials eksik! URL: ${SUPABASE_URL ? 'VAR' : 'YOK'}, KEY: ${SUPABASE_SERVICE_ROLE_KEY ? 'VAR' : 'YOK'}`)
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    if (!SMTP_USER || !SMTP_PASS) {
      throw new Error('SMTP credentials eksik! SMTP_USER/SMTP_PASS env set edilmeli.')
    }
    if (!RECIPIENTS || RECIPIENTS.length === 0) {
      throw new Error('Alıcı listesi boş! REPORT_RECIPIENTS env set edilmeli (virgülle ayrılmış).')
    }

    // 2. Tarih ve Veri Çekme
    const url = new URL(req.url)
    const dateParam = url.searchParams.get('date')

    // Türkiye saati ile bugünü hesapla (UTC+3)
    const nowInTurkey = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" }))

    let targetDate: Date
    if (dateParam) {
      targetDate = new Date(dateParam)
    } else {
      // Varsayılan: Dün (Türkiye saatine göre)
      targetDate = new Date(nowInTurkey)
      targetDate.setDate(targetDate.getDate() - 1)
    }

    // Türkiye saatine göre günün başlangıç ve bitişi (UTC olarak)
    // Örnek: 28.01.2026 Türkiye saati 00:00 = 27.01.2026 21:00 UTC
    const year = targetDate.getFullYear()
    const month = targetDate.getMonth()
    const day = targetDate.getDate()

    // Türkiye 00:00 = UTC -3 saat = önceki gün 21:00
    const startOfDayUTC = new Date(Date.UTC(year, month, day - 1, 21, 0, 0, 0))
    // Türkiye 23:59:59 = UTC -3 saat = aynı gün 20:59:59
    const endOfDayUTC = new Date(Date.UTC(year, month, day, 20, 59, 59, 999))

    const dateStr = targetDate.toLocaleDateString('tr-TR')

    // Veritabanından Kayıtları Al
    console.log(`Sorgu aralığı: ${startOfDayUTC.toISOString()} - ${endOfDayUTC.toISOString()}`)

    const { data: logs, error: dbError } = await supabase
      .from('security_logs')
      .select('*')
      .gte('created_at', startOfDayUTC.toISOString())
      .lte('created_at', endOfDayUTC.toISOString())
      .order('created_at', { ascending: true })

    if (dbError) {
      console.error('Veritabanı hatası:', dbError)
      throw new Error(`Veritabanı hatası: ${dbError.message}`)
    }

    // Null kontrolü
    const safeLogging = logs || []
    console.log(`Bulunan kayıt sayısı: ${safeLogging.length}`)

    // 3. Rapor İstatistikleri
    const stats = {
      total: safeLogging.length,
      exited: safeLogging.filter((l: any) => l.exit_at).length,
      inside: safeLogging.filter((l: any) => !l.exit_at).length
    }

    // 4. HTML Oluştur
    const html = generateHTML(safeLogging, dateStr, stats)

    // 5. Nodemailer ile Gönderim
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const info = await transporter.sendMail({
      from: `\"${SMTP_FROM_NAME}\" <${SMTP_FROM}>`,
      to: RECIPIENTS.join(", "),
      subject: `🏭 Güvenlik Raporu - ${dateStr}`,
      html: html,
    });

    return new Response(JSON.stringify({ success: true, messageId: info.messageId, stats }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    })
  }
})

// === HTML OLUŞTURUCU ===
function generateHTML(logs: any[], date: string, stats: any) {
  const formatTime = (d: string) => new Date(d).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) // Timezone eklendi
  const escapeHtml = (value: any) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  const calcDuration = (entry: string, exit: string) => {
    if (!exit) return '<span style="color:#22c55e;font-weight:bold">İçeride</span>'
    const diff = new Date(exit).getTime() - new Date(entry).getTime()
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    return h > 0 ? `${h}s ${m}dk` : `${m}dk`
  }
  const rows = logs.map(l => `
    <tr style="border-bottom:1px solid #334155">
      <td style="padding:10px;font-size:12px;color:#94a3b8">${escapeHtml(l.sub_category || '-')}</td>
      <td style="padding:10px;font-weight:bold;color:#fff">${escapeHtml(l.plate || l.name || '-')}</td>
      <td style="padding:10px;font-size:12px;color:#94a3b8">${escapeHtml(l.driver || '-')}</td>
      <td style="padding:10px;font-size:12px;color:#94a3b8">${escapeHtml(l.host || '-')}</td>
      <td style="padding:10px;font-size:12px;color:#22c55e">${escapeHtml(formatTime(l.created_at))}</td>
      <td style="padding:10px;font-size:12px;color:#ef4444">${l.exit_at ? escapeHtml(formatTime(l.exit_at)) : '-'}</td>
      <td style="padding:10px;font-size:12px;color:#94a3b8">${calcDuration(l.created_at, l.exit_at)}</td>
    </tr>`).join('')

  const insideList = logs.filter(l => !l.exit_at)
  const insideSection = insideList.length > 0 ? `
    <div style="background:#7f1d1d;border:1px solid #ef4444;border-radius:8px;padding:16px;margin-top:20px">
      <h3 style="color:#fca5a5;margin:0 0 10px 0;font-size:14px">⚠️ Hala İçeride (${insideList.length})</h3>
      <ul style="margin:0;padding-left:20px;color:#fecaca;font-size:13px">
        ${insideList.map(l => `<li>${escapeHtml(l.plate || l.name || '-')} - ${escapeHtml(l.sub_category || '-')} (${escapeHtml(formatTime(l.created_at))})</li>`).join('')}
      </ul>
    </div>` : ''

  return `<!DOCTYPE html><html><body style="background:#0f172a;color:#fff;font-family:Arial,sans-serif;padding:20px">
    <div style="max-width:800px;margin:auto">
      <div style="background:#1e293b;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #334155">
        <h1 style="color:#fff;margin:0 0 5px 0;font-size:22px">🏭 Malhotra Kablo Güvenlik Raporu</h1>
        <p style="color:#94a3b8;margin:0;font-size:14px">📅 ${escapeHtml(date)}</p>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:20px;text-align:center">
        <div style="flex:1;background:#1e293b;padding:15px;border-radius:8px"><div style="font-size:24px;color:#3b82f6">${stats.total}</div><div style="font-size:12px;color:#aaa">Toplam</div></div>
        <div style="flex:1;background:#1e293b;padding:15px;border-radius:8px"><div style="font-size:24px;color:#22c55e">${stats.exited}</div><div style="font-size:12px;color:#aaa">Çıkan</div></div>
        <div style="flex:1;background:${stats.inside > 0 ? '#7f1d1d' : '#1e293b'};padding:15px;border-radius:8px"><div style="font-size:24px;color:${stats.inside > 0 ? '#fca5a5' : '#aaa'}">${stats.inside}</div><div style="font-size:12px;color:#aaa">İçeride</div></div>
      </div>
      <table style="width:100%;border-collapse:collapse;background:#1e293b;border-radius:8px;overflow:hidden">
        <thead style="background:#0f172a;color:#94a3b8;font-size:12px;text-align:left"><tr><th style="padding:10px">Kategori</th><th style="padding:10px">Plaka</th><th style="padding:10px">Sürücü</th><th style="padding:10px">İlgili</th><th style="padding:10px">Giriş</th><th style="padding:10px">Çıkış</th><th style="padding:10px">Süre</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="padding:20px;text-align:center;color:#64748b">Kayıt Bulunamadı</td></tr>'}</tbody>
      </table>
      ${insideSection}
    </div></body></html>`
}
