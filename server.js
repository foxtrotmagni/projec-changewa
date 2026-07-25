const TelegramBotModule = require('node-telegram-bot-api');
const TelegramBot = typeof TelegramBotModule === 'function' ? TelegramBotModule : (TelegramBotModule.default || TelegramBotModule);
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Global Error Handler (Cegah bot mati jika koneksi internet terputus sementara)
process.on('uncaughtException', (err) => {
  console.error('[Global Warning] Uncaught Exception:', err.message || err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Global Warning] Unhandled Rejection:', reason.message || reason);
});

// =====================================================================
// KONFIGURASI
// =====================================================================
const TELEGRAM_TOKEN = "8775838848:AAEsLxIpnvGpEfM2LtJIevaA_gh9kMs4uts";
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzRIJVW9m13d2HaHady_WokAjBxBsCQNehc60T_qlvxM_kE_TVC0Il9mwy_00pWnejQXw/exec";
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const PORTAL_BASE_URL = process.env.DOMAIN_URL || "https://projec-changewa.netlify.app/";
const TARGET_GROUP_ID = process.env.TARGET_GROUP_ID || "-1004481056112";
const AUTHORIZED_CLEAR_USERS = ["khelfine", "paopao11112022", "hlmnopxyz88"]; // Username Telegram backend yang diizinkan eksekusi /clear

// =====================================================================
// DATABASE LOCAL (JSON PERSISTENT STORAGE)
// =====================================================================
let db = {
  tickets: [],    // { timestamp, chatId, msgKey, asset, username, ticket, status, opened, accessKey }
  responses: []   // { timestamp, ticket, website, username, namaLengkap, waLama, waBaru }
};

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(raw);
      if (!db.tickets) db.tickets = [];
      if (!db.responses) db.responses = [];
      console.log(`[DB] Berhasil memuat ${db.tickets.length} tiket & ${db.responses.length} respons.`);
    } else {
      saveDatabase();
    }
  } catch (err) {
    console.error("[DB Error] Gagal memuat database:", err.message);
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (err) {
    console.error("[DB Error] Gagal menyimpan database:", err.message);
  }
}

loadDatabase();

// =====================================================================
// HELPER FUNCTIONS
// =====================================================================
function generateRandomTicket() {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let r = "FX-";
  for (let i = 0; i < 6; i++) r += c.charAt(Math.floor(Math.random() * c.length));
  return r;
}

function generateRandomAccessKey() {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let r = "LK-";
  for (let i = 0; i < 6; i++) r += c.charAt(Math.floor(Math.random() * c.length));
  return r;
}

function resolveAssetName(inputAsset) {
  if (!inputAsset) return null;
  const cleaned = inputAsset.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliasMap = {
    "kr8": "KRING88", "be8": "BETPEDIA88",
    "f20": "F200M", "g20": "G200M",
    "e20": "E200M", "d20": "D200M",
    "kring88": "KRING88", "betpedia88": "BETPEDIA88",
    "f200m": "F200M", "g200m": "G200M",
    "e200m": "E200M", "d200m": "D200M"
  };
  return aliasMap[cleaned] || null;
}

function escapeHtml(text) {
  if (!text) return "";
  return text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Sync ke Google Sheets (Follow 302 Redirects agar data 100% masuk ke Sheets)
function syncToGoogleSheets(params) {
  try {
    const query = new URLSearchParams(params).toString();
    const targetUrl = `${APPS_SCRIPT_URL}?${query}`;

    function fetchWithRedirect(url, maxRedirects = 5) {
      if (maxRedirects <= 0) return;
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchWithRedirect(res.headers.location, maxRedirects - 1);
        } else {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            console.log(`[Google Sheets Sync Result]`, body.substring(0, 150));
          });
        }
      }).on('error', (err) => {
        console.log("[Sync Warning] Google Sheets sync error:", err.message);
      });
    }

    fetchWithRedirect(targetUrl);
  } catch (e) {
    console.log("[Sync Exception]", e.message);
  }
}

// =====================================================================
// HELPER FORWARD BATCH (MELAKUKAN FORWARD 1 ALBUM LENGKAP SEKALIGUS)
// =====================================================================
function forwardTelegramMessagesBatch(chatId, fromChatId, messageIds) {
  return new Promise((resolve, reject) => {
    const numericIds = messageIds.map(id => parseInt(id)).filter(id => !isNaN(id));
    numericIds.sort((a, b) => a - b);

    const postData = JSON.stringify({
      chat_id: chatId,
      from_chat_id: fromChatId,
      message_ids: numericIds
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${TELEGRAM_TOKEN}/forwardMessages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.ok) {
            resolve(parsed.result);
          } else {
            reject(new Error(parsed.description || "forwardMessages batch failed"));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.write(postData);
    req.end();
  });
}

// =====================================================================
// TELEGRAM BOT (LONG POLLING - NO WEBHOOKS, INSTANT REPLIES)
// =====================================================================
console.log("[Bot] Menghubungkan ke Telegram via Long Polling...");

const bot = new TelegramBot(TELEGRAM_TOKEN, {
  polling: {
    interval: 300,
    autoStart: true,
    params: {
      allowed_updates: ["message", "edited_message", "callback_query", "channel_post", "edited_channel_post"]
    }
  }
});

// Cache untuk mengumpulkan ID seluruh foto jika dikirim sebagai album (Media Group)
const mediaGroupStore = {};
bot.on('message', (msg) => {
  if (msg && msg.media_group_id) {
    if (!mediaGroupStore[msg.media_group_id]) {
      mediaGroupStore[msg.media_group_id] = [];
    }
    const msgIdStr = msg.message_id.toString();
    if (!mediaGroupStore[msg.media_group_id].includes(msgIdStr)) {
      mediaGroupStore[msg.media_group_id].push(msgIdStr);
    }
  }
});

// Hapus webhook lama agar Long Polling berjalan lancar dengan seluruh jenis update
bot.deleteWebhook({ drop_pending_updates: false }).then(() => {
  console.log("✅ Webhook Telegram lama berhasil dihapus & Subscription Callback Query Aktif!");
}).catch(err => {
  console.log("⚠️ Informational: deleteWebhook:", err.message);
});

// 1. Command /start (Menu Interaktif Tombol)
bot.onText(/\/start/i, (msg) => {
  const chatId = msg.chat.id;
  const menuText = "📋 <b>MENU UTAMA BOT</b> 📋\n\nSilakan pilih menu informasi di bawah ini:";
  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "🤖 PANDUAN & INFORMASI BOT 🤖", callback_data: "start_guidance" }
      ],
      [
        { text: "⚙️ INFORMASI PERINTAH HAPUS DATABASE (/CLEAR)", callback_data: "start_clear_info" }
      ]
    ]
  };

  bot.sendMessage(chatId, menuText, { parse_mode: 'HTML', reply_to_message_id: msg.message_id, reply_markup: inlineKeyboard });
});

// 2. Command /debug
bot.onText(/\/debug/i, (msg) => {
  const chatId = msg.chat.id;
  const activeTickets = db.tickets.filter(t => t.status === "ACTIVE").length;
  const report = "=== DEBUG BOT STATUS (NODE.JS STANDALONE) ===\n" +
    `🆔 <b>Chat ID Chat Ini:</b> <code>${chatId}</code>\n` +
    `🤖 Mode: <b>Long Polling (Instan Real-time)</b>\n` +
    `📁 Total Tiket di DB: <b>${db.tickets.length}</b>\n` +
    `🎟️ Tiket Aktif: <b>${activeTickets}</b>\n` +
    `📝 Respons Form: <b>${db.responses.length}</b>\n` +
    `🌐 Local Server: <code>${PORTAL_BASE_URL}</code>`;
  bot.sendMessage(chatId, report, { parse_mode: 'HTML', reply_to_message_id: msg.message_id });
});

// 3. Command /clear (Bisa /clear untuk semua ATAU /clear FX-XXXXXX untuk tiket spesifik)
bot.onText(/\/clear(?:\s+(.+))?/i, (msg, match) => {
  const chatId = msg.chat.id;
  const senderUsername = msg.from && msg.from.username ? msg.from.username.toLowerCase() : "";
  const senderDisplay = msg.from && msg.from.username ? `@${msg.from.username}` : (msg.from ? msg.from.first_name : "User");

  // Security Check: Hanya username yang terdaftar di AUTHORIZED_CLEAR_USERS yang boleh menggunakan /clear
  if (!AUTHORIZED_CLEAR_USERS.includes(senderUsername)) {
    const accessDeniedMsg = `⛔ <b>AKSES DITOLAK</b>\n\n` +
      `Maaf ${escapeHtml(senderDisplay)}, Anda tidak memiliki izin untuk menggunakan perintah <code>/clear</code>.`;
    bot.sendMessage(chatId, accessDeniedMsg, { parse_mode: 'HTML', reply_to_message_id: msg.message_id });
    console.log(`[Security Alert] User ${senderDisplay} mencoba eksekusi /clear tanpa izin.`);
    return;
  }

  const param = match && match[1] ? match[1].trim().toUpperCase() : "";

  if (param) {
    // Hapus tiket spesifik berdasarkan kode tiket (misal: /clear FX-8HNTW0)
    const initialCount = db.tickets.length;
    db.tickets = db.tickets.filter(t => (t.ticket || "").toUpperCase() !== param);
    db.responses = db.responses.filter(r => (r.ticket || "").toUpperCase() !== param);

    if (db.tickets.length < initialCount) {
      saveDatabase();
      const reply = `✅ Tiket <code>${escapeHtml(param)}</code> berhasil dihapus dari database oleh ${escapeHtml(senderDisplay)}.\n\n` +
        "Member dengan Asset & Username tersebut sekarang sudah dapat mengajukan permintaan tiket kembali.";
      bot.sendMessage(chatId, reply, { parse_mode: 'HTML', reply_to_message_id: msg.message_id });
      console.log(`[DB Delete] Tiket ${param} berhasil dihapus secara spesifik oleh ${senderDisplay}.`);
    } else {
      const reply = `❌ Tiket <code>${escapeHtml(param)}</code> tidak ditemukan di database.`;
      bot.sendMessage(chatId, reply, { parse_mode: 'HTML', reply_to_message_id: msg.message_id });
    }
  } else {
    // Verifikasi tambahan untuk hapus seluruh database
    const confirmText = "⚠️ <b>VERIFIKASI PENGHAPUSAN DATABASE</b> ⚠️\n\n" +
      "Apakah Anda yakin ingin menghapus SELURUH basis data tiket & respons?\n\n" +
      "⚠️ <b>PERINGATAN:</b> Seluruh member/customer dapat mengajukan tiket baru kembali setelah database ini dihapuskan!";

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: "🔴 Yes, HAPUS SEMUA", callback_data: "confirm_clear_all" },
          { text: "🟢 No, BATALKAN", callback_data: "cancel_clear_all" }
        ]
      ]
    };

    bot.sendMessage(chatId, confirmText, { parse_mode: 'HTML', reply_to_message_id: msg.message_id, reply_markup: inlineKeyboard });
  }
});

// 4. Format "Req Change Number" Parser & Processor
function handleIncomingTelegramMessage(msg, isEdit = false) {
  if (!msg) return;
  const text = (msg.text || msg.caption || "").trim();
  if (!text) return;

  // Skip command /start, /debug, /clear
  if (text.startsWith('/')) return;
  if (!/Req\s+Change\s+Number/i.test(text)) return;

  // Restriksi: HANYA PROSES DARI GRUP / SUPERGROUP TELEGRAM (Abaikan Private Chat)
  const chatType = msg.chat ? msg.chat.type : "";
  if (chatType === 'private') {
    const rejectPrivateMsg = "⚠️ <b>PERMINTAAN TIKET DITOLAK</b>\n\n" +
      "Format permintaan tiket penggantian nomor WA hanya dapat diproses melalui obrolan <b>Grup Telegram</b>, bukan via Pesan Pribadi (Private Chat).";
    bot.sendMessage(msg.chat.id, rejectPrivateMsg, { parse_mode: 'HTML', reply_to_message_id: msg.message_id }).catch(() => {});
    console.log(`[Bot Ignored Private Chat] Permintaan tiket dari ${msg.from ? msg.from.username || msg.from.first_name : 'User'} diabaikan karena dikirim via Private Chat.`);
    return;
  }

  const chatId = msg.chat.id.toString();
  const msgId = msg.message_id.toString();

  // Multi-form parsing
  const parts = text.split(/Req\s+Change\s+Number/i);
  const forms = [];
  for (let p = 1; p < parts.length; p++) {
    const partText = parts[p];
    const assetMatch = partText.match(/Asset\s*:\s*([^\n\r]+)/i);
    const userMatch = partText.match(/Username\s*:\s*([^\n\r]+)/i);
    forms.push({
      rawAsset: assetMatch ? assetMatch[1].trim() : "",
      username: userMatch ? userMatch[1].trim().toUpperCase() : ""
    });
  }

  if (forms.length === 0) return;

  forms.forEach((form, f) => {
    const msgKey = forms.length > 1 ? `${msgId}_${f}` : msgId;
    const rawAsset = form.rawAsset;
    const username = form.username;

    // 1. Validasi Kelengkapan Form
    if (!rawAsset || !username) {
      bot.sendMessage(chatId, "❌ Format form tidak lengkap. Pastikan Asset dan Username diisi.", { reply_to_message_id: msg.message_id });
      return;
    }

    // 2. ATURAN 11 & REVISI: Jika pesan (msgKey) sudah pernah dibuatkan tiketnya,
    // UPDATE Asset & Username pada tiket tersebut sesuai pesan editan terbaru!
    const existingForMsgKey = db.tickets.find(t => t.chatId === chatId && t.msgKey === msgKey);
    if (existingForMsgKey) {
      const fullAssetName = resolveAssetName(rawAsset);
      if (!fullAssetName) {
        const reply = `❌ Asset <code>${escapeHtml(rawAsset)}</code> tidak dikenali.\n` +
          "Gunakan: KR8, BE8, F20, G20, E20, D20 (atau nama lengkap).";
        bot.sendMessage(chatId, reply, { parse_mode: 'HTML', reply_to_message_id: msg.message_id });
        return;
      }

      // Update data tiket yang ada
      existingForMsgKey.asset = fullAssetName;
      existingForMsgKey.username = username;
      saveDatabase();

      const existingUrl = `${PORTAL_BASE_URL}?k=${existingForMsgKey.accessKey}`;
      const notice = "⚠️ <b>TIKET DIPERBARUI DARI PESAN YANG DIEDIT</b>\n\n" +
        "Data tiket Anda telah diperbarui sesuai pesan editan terbaru:\n\n" +
        `• Asset: <code>${escapeHtml(existingForMsgKey.asset)}</code>\n` +
        `• Username: <code>${escapeHtml(existingForMsgKey.username)}</code>\n` +
        `• Tiket: <code>${escapeHtml(existingForMsgKey.ticket)}</code>\n\n` +
        `🔗 Link Portal:\n<code>${escapeHtml(existingUrl)}</code>\n\n` +
        "Silakan buka link yang kami kirim untuk mengisi nomor WhatsApp lama & baru.\n\n" +
        "⚠️ Link hanya dapat diakses 1 kali. Pastikan seluruh data diisi hingga selesai. Setelah link dibuka, jangan melakukan refresh atau menutup halaman sebelum proses pengisian selesai ya, Kak.";
      bot.sendMessage(chatId, notice, { parse_mode: 'HTML', reply_to_message_id: msg.message_id });
      console.log(`[Bot Edit Updated] Tiket ${existingForMsgKey.ticket} diperbarui ke Asset: ${fullAssetName}, User: ${username}`);
      return;
    }

    // 3. ATURAN 9: Validasi Asset untuk pesan baru
    const fullAssetName = resolveAssetName(rawAsset);
    if (!fullAssetName) {
      const reply = `❌ Asset <code>${escapeHtml(rawAsset)}</code> tidak dikenali.\n` +
        "Gunakan: KR8, BE8, F20, G20, E20, D20 (atau nama lengkap).";
      bot.sendMessage(chatId, reply, { parse_mode: 'HTML', reply_to_message_id: msg.message_id });
      return;
    }

    // 4. ATURAN 12: Cek apakah Asset & Username sama sudah pernah SUKSES diganti dalam 1 bulan (30 hari)
    const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000; // 30 Hari
    const nowTime = Date.now();
    const existingMonthTicket = db.tickets.find(t => {
      if (!t.asset || !t.username) return false;
      if (t.status !== 'USED') return false; // Hanya tiket yang SUDAH SUKSES DIPROSES (USED) yang dibatasi 1 bulan
      const isSameAsset = t.asset.toLowerCase() === fullAssetName.toLowerCase();
      const isSameUser = t.username.toLowerCase() === username.toLowerCase();
      const ticketTime = new Date(t.timestamp).getTime();
      return isSameAsset && isSameUser && (nowTime - ticketTime <= ONE_MONTH_MS);
    });

    if (existingMonthTicket) {
      const dateObj = new Date(existingMonthTicket.timestamp);
      const dateStr = dateObj.toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const rejectReply = "❌ <b>PERMINTAAN DITOLAK</b>\n\n" +
        `Username <code>${escapeHtml(username)}</code> untuk Asset <code>${escapeHtml(fullAssetName)}</code> sudah pernah mengajukan permintaan dalam kurun waktu 1 bulan terakhir.\n\n` +
        `• Tiket Sebelumnya: <code>${escapeHtml(existingMonthTicket.ticket)}</code>\n` +
        `• Tanggal Pengajuan: <code>${escapeHtml(dateStr)}</code>`;
      bot.sendMessage(chatId, rejectReply, { parse_mode: 'HTML', reply_to_message_id: msg.message_id });
      console.log(`[Bot Rejected] ${username} (${fullAssetName}) ditolak karena < 1 bulan`);
      return;
    }

    // 4.5. CEK APAKAH TIKET UNTUK ASSET & USERNAME INI SUDAH DITERBITKAN DAN MASIH AKTIF (BELUM DIGUNAKAN)
    const existingActiveTicket = db.tickets.find(t => {
      if (!t.asset || !t.username) return false;
      if (t.status !== 'ACTIVE') return false;
      const isSameAsset = t.asset.toLowerCase() === fullAssetName.toLowerCase();
      const isSameUser = t.username.toLowerCase() === username.toLowerCase();
      return isSameAsset && isSameUser;
    });

    if (existingActiveTicket) {
      const activeUrl = `${PORTAL_BASE_URL}?k=${existingActiveTicket.accessKey}`;
      const activeNotice = "⚠️ <b>TIKET UNTUK PESAN INI SUDAH DITERBITKAN</b>\n\n" +
        "Pesan yang dikirimkan ini sudah pernah diterbitkan tiketnya sebelumnya.\n\n" +
        `• Asset: <code>${escapeHtml(existingActiveTicket.asset)}</code>\n` +
        `• Username: <code>${escapeHtml(existingActiveTicket.username)}</code>\n` +
        `• Tiket: <code>${escapeHtml(existingActiveTicket.ticket)}</code>\n\n` +
        `🔗 Link Portal:\n<code>${escapeHtml(activeUrl)}</code>\n\n` +
        "Silakan buka link yang kami kirim untuk mengisi nomor WhatsApp lama & baru.\n\n" +
        "⚠️ Link hanya dapat diakses 1 kali. Pastikan seluruh data diisi hingga selesai. Setelah link dibuka, jangan melakukan refresh atau menutup halaman sebelum proses pengisian selesai ya, Kak.";

      bot.sendMessage(chatId, activeNotice, { parse_mode: 'HTML', reply_to_message_id: msg.message_id });
      console.log(`[Bot Existing Ticket Returned] Tiket ${existingActiveTicket.ticket} dikembalikan untuk ${username} (${fullAssetName})`);
      return;
    }

    // 5. Buat tiket baru (Aturan 5 & 9)
    const newTicket = generateRandomTicket();
    const newAccessKey = newTicket; // accessKey diubah dan persis mengikuti tiket
    const portalUrl = `${PORTAL_BASE_URL}?k=${newAccessKey}`;

    let albumMsgIds = [msgId];
    if (msg.media_group_id && mediaGroupStore[msg.media_group_id] && mediaGroupStore[msg.media_group_id].length > 0) {
      albumMsgIds = [...mediaGroupStore[msg.media_group_id]];
      if (!albumMsgIds.includes(msgId)) albumMsgIds.push(msgId);
    }

    const newEntry = {
      timestamp: new Date().toISOString(),
      chatId: chatId,
      msgKey: msgKey,
      mediaGroupId: msg.media_group_id || null,
      mediaGroupIds: albumMsgIds,
      asset: fullAssetName,
      username: username,
      ticket: newTicket,
      status: "ACTIVE",
      opened: false,
      accessKey: newAccessKey
    };

    db.tickets.push(newEntry);
    saveDatabase();

    // Sync ke Google Sheets (jika disiapkan)
    syncToGoogleSheets({
      action: 'add_ticket',
      chatId: chatId,
      msgKey: msgKey,
      asset: fullAssetName,
      username: username,
      ticket: newTicket,
      accessKey: newAccessKey
    });

    const successMsg = "✅ <b>TIKET BERHASIL DIBUAT</b>\n\n" +
      `• Asset: <code>${escapeHtml(fullAssetName)}</code>\n` +
      `• Username: <code>${escapeHtml(username)}</code>\n` +
      `• Tiket: <code>${escapeHtml(newTicket)}</code>\n\n` +
      `🔗 Link Portal:\n<code>${escapeHtml(portalUrl)}</code>\n\n` +
      "Silakan buka link yang kami kirim untuk mengisi nomor WhatsApp lama & baru.\n\n" +
      "⚠️ Link hanya dapat diakses 1 kali. Pastikan seluruh data diisi hingga selesai. Setelah link dibuka, jangan melakukan refresh atau menutup halaman sebelum proses pengisian selesai ya, Kak.";

    bot.sendMessage(chatId, successMsg, { parse_mode: 'HTML', reply_to_message_id: msg.message_id });
    console.log(`[Bot Tiket Baru${isEdit ? ' (Pesan Edit)' : ''}] ${newTicket} (${fullAssetName} - ${username})`);
  });
}

// Handling Pesan Baru (New Message)
bot.on('message', (msg) => {
  handleIncomingTelegramMessage(msg, false);
});

// ATURAN 8: Handling Pesan yang Diedit (Edited Message)
bot.on('edited_message', (msg) => {
  console.log(`[Bot Edit Detected] Message ID ${msg.message_id} diedit oleh user.`);
  handleIncomingTelegramMessage(msg, true);
});

// Error handling bot
bot.on('polling_error', (err) => {
  console.error("[Bot Polling Error]", err.code, err.message);
});

// =====================================================================
// HELPER: UPDATE MESSAGE ADMMIN (SUPPORT TEKS & MEDIA/FOTO)
// =====================================================================
function updateAdminMessage(query, statusText) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const isMedia = !!(query.message.photo || query.message.document || query.message.video);
  const currentText = (query.message.caption || query.message.text || "").trim();
  const newContent = currentText + `\n\n${statusText}`;

  // 1. Selalu hapus tombol aksi agar tombol hilang setelah diklik!
  bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => {});

  // 2. Perbarui Teks Caption/Pesan
  if (isMedia) {
    bot.editMessageCaption(newContent, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML'
    }).catch((err) => {
      console.log("[editMessageCaption Warning]", err.message);
    });
  } else {
    bot.editMessageText(newContent, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML'
    }).catch((err) => {
      console.log("[editMessageText Warning]", err.message);
    });
  }
}

// Helper untuk Mengirim Balasan ke Grup Customer (Garansi 100% Terkirim)
async function sendCustomerReply(targetChatId, customerMsg, originalMsgId) {
  if (originalMsgId) {
    try {
      await bot.sendMessage(targetChatId, customerMsg, { reply_to_message_id: originalMsgId });
      console.log(`[Customer Reply Success] Reply to msg ${originalMsgId} in chat ${targetChatId}`);
      return;
    } catch (errReply) {
      console.warn(`[Customer Reply Warning] Reply to msg ${originalMsgId} failed (${errReply.message}), fallback to direct send.`);
    }
  }
  try {
    await bot.sendMessage(targetChatId, customerMsg);
    console.log(`[Customer Reply Fallback Success] Direct message to chat ${targetChatId}`);
  } catch (errFallback) {
    console.error(`[Customer Reply Error] Failed to send message to chat ${targetChatId}:`, errFallback.message);
  }
}

// =====================================================================
// HANDLING TOMBOL AKSI ADMIN (CALLBACK QUERY)
// =====================================================================
bot.on('callback_query', async (query) => {
  if (!query || !query.data) return;

  const clickerUsername = query.from && query.from.username ? `@${query.from.username}` : (query.from ? query.from.first_name : "Admin");
  const clickerId = query.from ? query.from.id.toString() : "";
  console.log(`[Button Click Received] User: ${clickerUsername} (ID: ${clickerId}), ChatID: ${query.message ? query.message.chat.id : ''}, Action: ${query.data}`);

  const data = query.data;

  // Handling Tombol Menu /start
  if (data === 'start_guidance') {
    bot.answerCallbackQuery(query.id).catch(() => {});
    // 1. Hapus seluruh pesan menu /start ("📋 MENU UTAMA BOT 📋...") seketika saat tombol diklik
    bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => {});

    const guidanceMsg = "📌 <b>FORMAT PERMINTAAN TIKET:</b>\n\n" +
      "Halo! Silakan kirimkan permintaan tiket penggantian nomor WA dengan format berikut:\n\n" +
      "<code>Req Change Number\n\nAsset : KR8\nUsername : Sulaiman122</code>";

    // 2. Kirim pesan panduan & hapus otomatis setelah 2 menit (120.000 ms)
    bot.sendMessage(query.message.chat.id, guidanceMsg, { parse_mode: 'HTML' }).then((sent) => {
      setTimeout(() => {
        bot.deleteMessage(query.message.chat.id, sent.message_id).catch(() => {});
        console.log(`[Auto Delete] Pesan panduan (${sent.message_id}) dihapus otomatis setelah 2 menit.`);
      }, 120000);
    }).catch(() => {});
    return;
  }

  if (data === 'start_clear_info') {
    bot.answerCallbackQuery(query.id).catch(() => {});
    // 1. Hapus seluruh pesan menu /start ("📋 MENU UTAMA BOT 📋...") seketika saat tombol diklik
    bot.deleteMessage(query.message.chat.id, query.message.message_id).catch(() => {});

    const clearInfoMsg = "⚙️ <b>INFORMASI PERINTAH HAPUS DATABASE (/CLEAR):</b>\n\n" +
      "• <code>/clear</code>\n" +
      "  <i>(Menghapus SELURUH basis data tiket & respons)</i>\n\n" +
      "• <code>/clear &lt;kode_tiket&gt;</code>\n" +
      "  <i>(Menghapus nomor tiket spesifik agar customer dapat mengajukan kembali, contoh: <code>/clear FX-8HNTW0</code>)</i>";

    // 2. Kirim pesan informasi & hapus otomatis setelah 2 menit (120.000 ms)
    bot.sendMessage(query.message.chat.id, clearInfoMsg, { parse_mode: 'HTML' }).then((sent) => {
      setTimeout(() => {
        bot.deleteMessage(query.message.chat.id, sent.message_id).catch(() => {});
        console.log(`[Auto Delete] Pesan info /clear (${sent.message_id}) dihapus otomatis setelah 2 menit.`);
      }, 120000);
    }).catch(() => {});
    return;
  }

  // Handling Verifikasi Hapus Database (/clear)
  if (data === 'confirm_clear_all') {
    const senderUsername = query.from && query.from.username ? query.from.username.toLowerCase() : "";
    if (!AUTHORIZED_CLEAR_USERS.includes(senderUsername)) {
      bot.answerCallbackQuery(query.id, { text: "⛔ Anda tidak memiliki izin eksekusi!", show_alert: true }).catch(() => {});
      return;
    }

    db.tickets = [];
    db.responses = [];
    saveDatabase();

    bot.answerCallbackQuery(query.id, { text: "✅ Database berhasil dibersihkan!", show_alert: true }).catch(() => {});
    bot.editMessageText(`✅ <b>Seluruh basis data tiket & respons berhasil dibersihkan oleh ${escapeHtml(clickerUsername)}.</b>\n\nSeluruh member/customer sekarang dapat mengajukan permintaan tiket baru kembali.`, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML'
    }).catch(() => {});

    console.log(`[DB Clear Confirmed] Seluruh database dibersihkan oleh ${clickerUsername}.`);
    return;
  }

  if (data === 'cancel_clear_all') {
    bot.answerCallbackQuery(query.id, { text: "❌ Penghapusan dibatalkan.", show_alert: true }).catch(() => {});
    bot.editMessageText(`❌ <b>Penghapusan database dibatalkan oleh ${escapeHtml(clickerUsername)}.</b>`, {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      parse_mode: 'HTML'
    }).catch(() => {});

    console.log(`[DB Clear Canceled] Penghapusan database dibatalkan oleh ${clickerUsername}.`);
    return;
  }

  let actionType = "";
  let ticketCode = "";

  if (data.startsWith('btn_done_')) {
    actionType = 'done';
    ticketCode = data.replace('btn_done_', '');
  } else if (data.startsWith('btn_reject_')) {
    actionType = 'reject';
    ticketCode = data.replace('btn_reject_', '');
  } else if (data.startsWith('btn_already_')) {
    actionType = 'already';
    ticketCode = data.replace('btn_already_', '');
  } else {
    return;
  }

  const item = db.tickets.find(t => t.ticket === ticketCode);
  if (!item) {
    bot.answerCallbackQuery(query.id, { text: "❌ Tiket tidak ditemukan / sudah diproses.", show_alert: true }).catch(() => {});
    if (actionType === 'already') {
      updateAdminMessage(query, `⚠️<b>[ Tiket ${ticketCode}: Permintaan dibatalkan karena nomor WhatsApp baru tersebut sudah terdaftar pada ID lain. ]</b>`);
    } else {
      updateAdminMessage(query, `⚠️ <b>[ Tiket ${ticketCode} sudah diproses ]</b>`);
    }
    return;
  }

  const targetCustomerChatId = item.chatId;
  const originalMsgId = item.msgKey ? item.msgKey.split('_')[0] : null;

  if (actionType === 'done') {
    item.status = 'USED';
    saveDatabase();
    bot.answerCallbackQuery(query.id, { text: "✅ TAMPILAN RESMI:\nData berhasil di update✅", show_alert: true }).catch(() => {});
    await sendCustomerReply(targetCustomerChatId, "Data berhasil di update✅", originalMsgId);
    updateAdminMessage(query, `✅ <b>[ STATUS: Done Update oleh ${escapeHtml(clickerUsername)} ]</b>`);

  } else if (actionType === 'reject') {
    item.status = 'REJECTED'; // Ubah status ke REJECTED agar customer BISA request tiket baru kembali!
    saveDatabase();
    bot.answerCallbackQuery(query.id, { text: "❌ TAMPILAN RESMI:\nPermintaan Dibatalkan❌", show_alert: true }).catch(() => {});
    await sendCustomerReply(targetCustomerChatId, "Permintaan Dibatalkan❌", originalMsgId);
    updateAdminMessage(query, `❌ <b>[ STATUS: Permintaan Dibatalkan oleh ${escapeHtml(clickerUsername)} ]</b>`);

  } else if (actionType === 'already') {
    item.status = 'REJECTED'; // Ubah status ke REJECTED agar customer BISA request tiket baru kembali!
    saveDatabase();
    bot.answerCallbackQuery(query.id, { text: "⚠️ Permintaan dibatalkan karena nomor WhatsApp baru tersebut sudah terdaftar pada ID lain.", show_alert: true }).catch(() => {});
    await sendCustomerReply(targetCustomerChatId, `⚠️[ Tiket ${ticketCode}: Permintaan dibatalkan karena nomor WhatsApp baru tersebut sudah terdaftar pada ID lain. ]`, originalMsgId);
    updateAdminMessage(query, `⚠️<b>[ Tiket ${ticketCode}: Permintaan dibatalkan karena nomor WhatsApp baru tersebut sudah terdaftar pada ID lain. ]</b>`);
  }
});

// =====================================================================
// EXPRESS SERVER UNTUK LANDING PAGE WEBSITE
// =====================================================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// API Verification & Submission Endpoints
app.all('/api', (req, res) => {
  const params = req.method === 'POST' ? req.body : req.query;
  const action = params.action;

  // 1. Verifikasi Link Portal (One-Time Link)
  if (action === 'verify_link') {
    const key = (params.key || "").toUpperCase().trim();
    const item = db.tickets.find(t => (t.accessKey || t.ticket || "").toUpperCase().trim() === key);

    if (!item) {
      return res.json({ result: "error", valid: false, reason: "Tautan tidak valid." });
    }
    if (item.opened) {
      return res.json({ result: "error", valid: false, reason: "Tautan sudah kedaluwarsa." });
    }
    if (item.status === 'USED') {
      return res.json({ result: "error", valid: false, reason: "Tiket sudah digunakan." });
    }

    item.opened = true;
    saveDatabase();
    return res.json({
      result: "success",
      valid: true,
      ticket: item.ticket,
      username: item.username,
      website: item.asset
    });
  }

  // 2. Verifikasi Nomor Tiket
  if (action === 'verify_ticket') {
    const ticket = (params.ticket || "").toUpperCase().trim();
    const item = db.tickets.find(t => t.ticket === ticket);

    if (!item) {
      return res.json({ result: "error", valid: false, reason: "Tiket tidak terdaftar." });
    }
    if (item.status === 'USED') {
      return res.json({ result: "error", valid: false, reason: "Tiket sudah digunakan." });
    }

    return res.json({ result: "success", valid: true, username: (item.username || "").toUpperCase(), website: item.asset });
  }

  // 3. Submit Form Pergantian WA
  if (action === 'submit') {
    const ticket = (params.ticket || "").toUpperCase().trim();
    const website = (params.website || "").toUpperCase().trim();
    const username = (params.username || "").toUpperCase().trim();
    const namaLengkap = (params.nama_lengkap || "").toUpperCase().trim();
    const waLama = params.wa_lama || "";
    const waBaru = params.wa_baru || "";

    const item = db.tickets.find(t => t.ticket === ticket);
    if (!item || item.status !== 'ACTIVE') {
      return res.json({ result: "error", message: "Tiket tidak terdaftar atau sudah tidak aktif." });
    }

    item.status = 'USED';
    db.responses.push({
      timestamp: new Date().toISOString(),
      ticket, website, username, namaLengkap, waLama, waBaru
    });
    saveDatabase();

    // Forward SELURUH foto (album) ke Group Owner & Kirim Reply Notification + Tombol Aksi
    (async () => {
      try {
        if (item.chatId && (item.msgKey || item.mediaGroupIds || item.mediaGroupId)) {
          let msgIdsToForward = [];
          if (item.mediaGroupId && mediaGroupStore[item.mediaGroupId] && mediaGroupStore[item.mediaGroupId].length > 0) {
            msgIdsToForward = [...mediaGroupStore[item.mediaGroupId]];
          } else if (item.mediaGroupIds && item.mediaGroupIds.length > 0) {
            msgIdsToForward = [...item.mediaGroupIds];
          } else {
            msgIdsToForward = [item.msgKey ? item.msgKey.split('_')[0] : null];
          }

          // Filter unik & urutkan secara numerik ascending agar foto di-forward urut
          msgIdsToForward = Array.from(new Set(msgIdsToForward.filter(Boolean)));
          msgIdsToForward.sort((a, b) => parseInt(a) - parseInt(b));

          let lastFwdMsgId = null;

          if (msgIdsToForward.length > 1) {
            try {
              const fwdResults = await forwardTelegramMessagesBatch(TARGET_GROUP_ID, item.chatId, msgIdsToForward);
              if (Array.isArray(fwdResults) && fwdResults.length > 0) {
                const lastMsg = fwdResults[fwdResults.length - 1];
                lastFwdMsgId = lastMsg.message_id;
                console.log(`[Admin Forward Batch Success] Forwarded album (${msgIdsToForward.length} photos as 1 album) to ${TARGET_GROUP_ID}`);
              }
            } catch (errBatch) {
              console.error("[Admin Forward Batch Warning, falling back to single forward]:", errBatch.message);
              for (const mId of msgIdsToForward) {
                if (!mId) continue;
                try {
                  const fwd = await bot.forwardMessage(TARGET_GROUP_ID, item.chatId, mId);
                  if (fwd && fwd.message_id) lastFwdMsgId = fwd.message_id;
                } catch (e) {}
              }
            }
          } else if (msgIdsToForward.length === 1) {
            try {
              const fwd = await bot.forwardMessage(TARGET_GROUP_ID, item.chatId, msgIdsToForward[0]);
              if (fwd && fwd.message_id) lastFwdMsgId = fwd.message_id;
            } catch (e) {}
          }

          const adminNotice = "🚨 <b>PERMINTAAN PERGANTIAN NOMOR WA</b> 🚨\n\n" +
            `• Asset: <code>${escapeHtml(website)}</code>\n` +
            `• Username: <code>${escapeHtml(username)}</code>\n` +
            `• Full Name : <code>${escapeHtml(namaLengkap)}</code>\n` +
            `• Old Whatsapp : <code>${escapeHtml(waLama)}</code>\n` +
            `• New Whatsapp : <code>${escapeHtml(waBaru)}</code>\n\n` +
            "📌 <b>TINDAKAN UNTUK TIM ADMIN:</b>\n" +
            "<i>PENTING: Harap segera perbarui data nomor WhatsApp pelanggan ini pada menu <b>Detail Contact / Profil Akun</b> di database website terkait. Terima kasih!</i>\n\n" +
            "@khelfine @PaoPao11112022 @Hlmnopxyz88";

          const inlineKeyboard = {
            inline_keyboard: [
              [
                { text: "🟢 Done Update", callback_data: `btn_done_${ticket}` },
                { text: "🔴 Reject", callback_data: `btn_reject_${ticket}` }
              ],
              [
                { text: "🟪 Already Registered", callback_data: `btn_already_${ticket}` }
              ]
            ]
          };

          const sendOptions = {
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard
          };
          if (lastFwdMsgId) {
            sendOptions.reply_to_message_id = lastFwdMsgId;
          }

          await bot.sendMessage(TARGET_GROUP_ID, adminNotice, sendOptions).catch(async (errReply) => {
            console.error("[Admin Notice Reply Warning, retry without reply_to]:", errReply.message);
            delete sendOptions.reply_to_message_id;
            await bot.sendMessage(TARGET_GROUP_ID, adminNotice, sendOptions);
          });

          console.log(`[Admin Forward Success] Ticket ${ticket} (${msgIdsToForward.length} photos) forwarded & notified to ${TARGET_GROUP_ID}`);
        }
      } catch (errGroup) {
        console.error("[Admin Group Exception]", errGroup.message);
      }
    })();

    // Forward ke Google Sheets juga agar tercatat di Sheets
    syncToGoogleSheets({
      action: 'submit',
      ticket, website, username, nama_lengkap: namaLengkap, wa_lama: waLama, wa_baru: waBaru
    });

    console.log(`[Form Submit] Tiket ${ticket} berhasil digunakan oleh ${username}`);
    return res.json({ result: "success", message: "Data berhasil disimpan!" });
  }

  return res.json({ result: "error", message: "Aksi tidak dikenali." });
});

app.listen(PORT, () => {
  console.log("\n=======================================================");
  console.log(`🚀 STANDALONE TELEGRAM BOT & WEB SERVER AKTIF!`);
  console.log(`🌐 Server Landing Page: http://localhost:${PORT}`);
  console.log(`🤖 Bot Telegram: LONG POLLING ACTIVE (Instan Real-Time)`);
  console.log("=======================================================\n");
});
