const https = require('https');
const fs = require('fs');
const path = require('path');

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzRIJVW9m13d2HaHady_WokAjBxBsCQNehc60T_qlvxM_kE_TVC0Il9mwy_00pWnejQXw/exec";
const DB_FILE = path.join(__dirname, 'database.json');

if (!fs.existsSync(DB_FILE)) {
  console.log("Database file database.json tidak ditemukan!");
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const responses = db.responses || [];

console.log(`Mengirim ${responses.length} data respons dari database.json ke Google Spreadsheet...`);

function fetchWithRedirect(url) {
  return new Promise((resolve, reject) => {
    function req(u, depth = 5) {
      if (depth <= 0) return reject(new Error("Terlalu banyak pengalihan"));
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          req(res.headers.location, depth - 1);
        } else {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => resolve(body));
        }
      }).on('error', reject);
    }
    req(url);
  });
}

async function syncAll() {
  for (let i = 0; i < responses.length; i++) {
    const item = responses[i];
    const params = new URLSearchParams({
      action: 'submit',
      ticket: item.ticket,
      website: item.website,
      username: item.username,
      nama_lengkap: item.namaLengkap,
      wa_lama: item.waLama,
      wa_baru: item.waBaru,
      timestamp: item.timestamp
    });

    const targetUrl = `${APPS_SCRIPT_URL}?${params.toString()}`;
    try {
      const res = await fetchWithRedirect(targetUrl);
      console.log(`[${i + 1}/${responses.length}] Tiket ${item.ticket} (${item.username}):`, res);
    } catch (err) {
      console.error(`[${i + 1}/${responses.length}] Gagal sync Tiket ${item.ticket}:`, err.message);
    }
  }
  console.log("\n✅ Seluruh data respons berhasil disinkronisasi ke Google Spreadsheet!");
}

syncAll();
