// netlify/functions/send-report.js
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || '';

const RECIPIENTS = (process.env.REPORT_RECIPIENTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

exports.handler = async (event) => {
  // CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }

  try {
    if (!RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY env eksik');
    }
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY env eksik');
    }
    if (!RECIPIENTS || RECIPIENTS.length === 0) {
      throw new Error('REPORT_RECIPIENTS env eksik (virgülle ayrılmış)');
    }

    const { date } = event.queryStringParameters || {};
    
    // Tarih belirle
    let targetDate;
    if (date) {
      targetDate = new Date(date);
    } else {
      targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - 1); // Dün
    }

    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const dateStr = targetDate.toLocaleDateString('tr-TR');

    // Supabase'den veri çek
    const supabaseRes = await fetch(
      `${SUPABASE_URL}/rest/v1/security_logs?created_at=gte.${startOfDay.toISOString()}&created_at=lte.${endOfDay.toISOString()}&order=created_at.asc`,
      {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      }
    );
    
    const logs = await supabaseRes.json();

    // İstatistikler
    const stats = {
      total: logs.length,
      exited: logs.filter(l => l.exit_at).length,
      inside: logs.filter(l => !l.exit_at).length
    };

    // HTML oluştur
    const html = generateHTML(logs, dateStr, stats);

    // E-posta gönder
    const subject = `🏭 Güvenlik Raporu - ${dateStr}`;
    const results = [];
    
    for (const to of RECIPIENTS) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Güvenlik Paneli <onboarding@resend.dev>',
            to,
            subject,
            html
          })
        });
        
        if (res.ok) {
          results.push({ email: to, status: 'ok' });
        } else {
          const err = await res.text();
          results.push({ email: to, status: 'error', error: err });
        }
      } catch (e) {
        results.push({ email: to, status: 'error', error: e.message });
      }
    }

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, date: dateStr, stats, results })
    };

  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

function generateHTML(logs, date, stats) {
  const formatTime = (d) => new Date(d).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  
  const calcDuration = (entry, exit) => {
    if (!exit) return '<span style="color:#22c55e;font-weight:bold">İçeride</span>';
    const diff = new Date(exit) - new Date(entry);
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}s ${m}dk` : `${m}dk`;
  };

  const rows = logs.map(l => `
    <tr style="border-bottom:1px solid #334155">
      <td style="padding:10px;font-size:12px;color:#94a3b8">${l.sub_category || '-'}</td>
      <td style="padding:10px;font-weight:bold;color:#fff">${l.plate || l.name || '-'}</td>
      <td style="padding:10px;font-size:12px;color:#94a3b8">${l.driver || '-'}</td>
      <td style="padding:10px;font-size:12px;color:#94a3b8">${l.host || '-'}</td>
      <td style="padding:10px;font-size:12px;color:#22c55e">${formatTime(l.created_at)}</td>
      <td style="padding:10px;font-size:12px;color:#ef4444">${l.exit_at ? formatTime(l.exit_at) : '-'}</td>
      <td style="padding:10px;font-size:12px;color:#94a3b8">${calcDuration(l.created_at, l.exit_at)}</td>
    </tr>
  `).join('');

  const insideList = logs.filter(l => !l.exit_at);
  const insideSection = insideList.length > 0 ? `
    <div style="background:#7f1d1d;border:1px solid #ef4444;border-radius:8px;padding:16px;margin-top:20px">
      <h3 style="color:#fca5a5;margin:0 0 10px 0;font-size:14px">⚠️ Hala İçeride (${insideList.length})</h3>
      <ul style="margin:0;padding-left:20px;color:#fecaca;font-size:13px">
        ${insideList.map(l => `<li>${l.plate || l.name} - ${l.sub_category} (${formatTime(l.created_at)})</li>`).join('')}
      </ul>
    </div>
  ` : '';

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:20px;background:#0f172a;font-family:Arial,sans-serif;color:#e2e8f0">
  <div style="max-width:800px;margin:auto">
    <div style="background:#1e293b;border-radius:12px;padding:20px;margin-bottom:20px;border:1px solid #334155">
      <h1 style="color:#fff;margin:0 0 5px 0;font-size:22px">🏭 Malhotra Kablo Güvenlik Raporu</h1>
      <p style="color:#94a3b8;margin:0;font-size:14px">📅 ${date}</p>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:20px">
      <div style="flex:1;background:#1e293b;border-radius:8px;padding:16px;text-align:center;border:1px solid #334155">
        <div style="font-size:28px;font-weight:bold;color:#3b82f6">${stats.total}</div>
        <div style="font-size:11px;color:#94a3b8">Toplam Giriş</div>
      </div>
      <div style="flex:1;background:#1e293b;border-radius:8px;padding:16px;text-align:center;border:1px solid #334155">
        <div style="font-size:28px;font-weight:bold;color:#22c55e">${stats.exited}</div>
        <div style="font-size:11px;color:#94a3b8">Çıkış Yapan</div>
      </div>
      <div style="flex:1;background:${stats.inside > 0 ? '#7f1d1d' : '#1e293b'};border-radius:8px;padding:16px;text-align:center;border:1px solid ${stats.inside > 0 ? '#ef4444' : '#334155'}">
        <div style="font-size:28px;font-weight:bold;color:${stats.inside > 0 ? '#fca5a5' : '#64748b'}">${stats.inside}</div>
        <div style="font-size:11px;color:#94a3b8">Hala İçeride</div>
      </div>
    </div>

    <div style="background:#1e293b;border-radius:8px;overflow:hidden;border:1px solid #334155">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#0f172a">
            <th style="padding:12px 10px;text-align:left;font-size:11px;color:#64748b">Kategori</th>
            <th style="padding:12px 10px;text-align:left;font-size:11px;color:#64748b">Plaka/İsim</th>
            <th style="padding:12px 10px;text-align:left;font-size:11px;color:#64748b">Sürücü</th>
            <th style="padding:12px 10px;text-align:left;font-size:11px;color:#64748b">İlgili</th>
            <th style="padding:12px 10px;text-align:left;font-size:11px;color:#64748b">Giriş</th>
            <th style="padding:12px 10px;text-align:left;font-size:11px;color:#64748b">Çıkış</th>
            <th style="padding:12px 10px;text-align:left;font-size:11px;color:#64748b">Süre</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="7" style="padding:30px;text-align:center;color:#64748b">Kayıt bulunamadı</td></tr>'}
        </tbody>
      </table>
    </div>

    ${insideSection}

    <p style="margin-top:20px;font-size:11px;color:#64748b;text-align:center">
      Bu rapor Güvenlik Paneli üzerinden gönderilmiştir.
    </p>
  </div>
</body>
</html>`;
}
