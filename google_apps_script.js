/**
 * Google Apps Script - Telegram Admin Bot ("Req Change Number") + Landing Page Backend
 *
 * ARSITEKTUR ANTRIAN SPREADSHEET (QUEUE-BASED):
 * - doPost: Menerima webhook Telegram dan langsung menyimpan ke sheet "Queue" (instan).
 * - doPost langsung mengembalikan "OK" ke Telegram dalam milidetik untuk mencegah timeout.
 * - Perintah /start, /debug, dan /clear diproses INSTAN langsung dari doPost karena tidak membebani database.
 * - Trigger processQueuedUpdates berjalan tiap 1 menit untuk memproses baris "PENDING" di Queue secara FIFO.
 */

// =====================================================================
// KONFIGURASI
// =====================================================================
var TELEGRAM_TOKEN  = "8775838848:AAEsLxIpnvGpEfM2LtJIevaA_gh9kMs4uts";
var PORTAL_BASE_URL = "https://projec-changewa.netlify.app/";
var SPREADSHEET_ID  = "1cCHy-z_3-MAE5AkTOn_yQ_zbxtGUI6TzXw9Kc6zjf9c";

var SHEET_RESPONSES = "FormResponses";
var SHEET_TICKETS   = "Tickets";
var SHEET_QUEUE     = "Queue";

// =====================================================================
// HELPER: SPREADSHEET
// =====================================================================
function getSpreadsheet() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

// =====================================================================
// SETUP SHEET
// =====================================================================
function setupSheets() {
  var ss = getSpreadsheet();
  
  // 1. Form Responses
  if (!ss.getSheetByName(SHEET_RESPONSES)) {
    ss.insertSheet(SHEET_RESPONSES)
      .appendRow(["Timestamp", "Nomor Tiket", "Website", "Username", "Nama Lengkap", "No WA Lama", "No WA Baru"]);
  }
  
  // 2. Tickets
  var sheetTickets = ss.getSheetByName(SHEET_TICKETS);
  if (!sheetTickets) {
    sheetTickets = ss.insertSheet(SHEET_TICKETS);
    sheetTickets.appendRow(["Timestamp", "Telegram Chat ID", "Telegram Message ID", "Asset", "Username", "Ticket", "Status", "Opened", "AccessKey"]);
  } else {
    var range = sheetTickets.getRange(1, 1, 1, 9);
    var headers = range.getValues()[0];
    if (headers.length < 9 || headers[2] !== "Telegram Message ID") {
      range.setValues([["Timestamp", "Telegram Chat ID", "Telegram Message ID", "Asset", "Username", "Ticket", "Status", "Opened", "AccessKey"]]);
    }
  }

  // 3. Queue Sheet
  var sheetQueue = ss.getSheetByName(SHEET_QUEUE);
  if (!sheetQueue) {
    sheetQueue = ss.insertSheet(SHEET_QUEUE);
    sheetQueue.appendRow(["Timestamp", "Update ID", "Update Contents", "Status"]);
  }
  
  Logger.log("Setup sheets selesai.");
}

// =====================================================================
// HELPER: LOG ERROR TO SHEET & TELEGRAM
// =====================================================================
function logErrorToSheet(err, context) {
  try {
    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName("ErrorLogs");
    if (!sheet) {
      sheet = ss.insertSheet("ErrorLogs");
      sheet.appendRow(["Timestamp", "Context", "Error Message", "Stack Trace"]);
    }
    sheet.appendRow([new Date(), context, err.toString(), err.stack || ""]);
  } catch (e) {
    Logger.log("Failed to log error to sheet: " + e.toString());
  }
}

// =====================================================================
// GENERATOR TIKET & KUNCI AKSES
// =====================================================================
function generateRandomTicket() {
  var c = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", r = "FX-";
  for (var i = 0; i < 6; i++) r += c.charAt(Math.floor(Math.random() * c.length));
  return r;
}

function generateRandomAccessKey() {
  var c = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", r = "LK-";
  for (var i = 0; i < 6; i++) r += c.charAt(Math.floor(Math.random() * c.length));
  return r;
}

// =====================================================================
// KONVERSI ALIAS ASSET (CASE-INSENSITIVE)
// =====================================================================
function resolveAssetName(inputAsset) {
  if (!inputAsset) return null;
  var cleaned = inputAsset.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  var aliasMap = {
    "kr8": "KRING88",   "be8": "BETPEDIA88",
    "f20": "F200M",     "g20": "G200M",
    "e20": "E200M",     "d20": "D200M",
    "kring88": "KRING88",   "betpedia88": "BETPEDIA88",
    "f200m": "F200M",   "g200m": "G200M",
    "e200m": "E200M",   "d200m": "D200M"
  };
  return aliasMap[cleaned] || null;
}

function escapeHtml(text) {
  if (!text) return "";
  return text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// =====================================================================
// TELEGRAM API SENDER (WITH FALLBACK RETRIES)
// =====================================================================
function sendTelegramMessage(chatId, text, replyToMessageId) {
  var payload = { chat_id: chatId, text: text, parse_mode: "HTML" };
  if (replyToMessageId) payload.reply_to_message_id = replyToMessageId;

  var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage", {
    method: "post", contentType: "application/json",
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });

  var resJson = {};
  try { resJson = JSON.parse(res.getContentText()); } catch (e) {}

  if (!resJson.ok) {
    Logger.log("sendMessage warning: " + res.getContentText());
    if (replyToMessageId) {
      delete payload.reply_to_message_id;
      res = UrlFetchApp.fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage", {
        method: "post", contentType: "application/json",
        payload: JSON.stringify(payload), muteHttpExceptions: true
      });
      try { resJson = JSON.parse(res.getContentText()); } catch (e) {}
    }
    if (!resJson.ok) {
      var plainText = text.replace(/<[^>]+>/g, "");
      UrlFetchApp.fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/sendMessage", {
        method: "post", contentType: "application/json",
        payload: JSON.stringify({ chat_id: chatId, text: plainText }),
        muteHttpExceptions: true
      });
    }
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// =====================================================================
// doGet — Verifikasi Landing Page
// =====================================================================
function doGet(e) {
  try {
    var action = e.parameter.action;
    var ss = getSpreadsheet();
    var sheetTickets = ss.getSheetByName(SHEET_TICKETS);
    if (!sheetTickets) { setupSheets(); sheetTickets = ss.getSheetByName(SHEET_TICKETS); }
    var data = sheetTickets.getDataRange().getValues();

    if (action === "verify_link") {
      var key = (e.parameter.key || "").toUpperCase().trim();
      var rowIndex = -1;
      for (var i = 1; i < data.length; i++) {
        if ((data[i][8] || "").toString().toUpperCase().trim() === key) { rowIndex = i + 1; break; }
      }
      if (rowIndex === -1) return jsonResponse({ result: "error", valid: false, reason: "Tautan tidak valid." });
      var opened = data[rowIndex - 1][7];
      if (opened === true || opened === "true")
        return jsonResponse({ result: "error", valid: false, reason: "Tautan sudah kedaluwarsa." });
      sheetTickets.getRange(rowIndex, 8).setValue(true);
      return jsonResponse({ result: "success", valid: true });
    }

    if (action === "submit") {
      return handleFormSubmission(e);
    }

    if (action === "add_ticket") {
      var chatId    = e.parameter.chatId || "";
      var msgKey    = e.parameter.msgKey || "";
      var asset     = e.parameter.asset || "";
      var username  = e.parameter.username || "";
      var ticket    = e.parameter.ticket || "";
      var accessKey = e.parameter.accessKey || "";

      sheetTickets.appendRow([new Date(), chatId, msgKey, asset, username, ticket, "ACTIVE", false, accessKey]);
      return jsonResponse({ result: "success", message: "Tiket dicatat di Sheets" });
    }

    return jsonResponse({ result: "error", reason: "Parameter tidak dikenali." });
  } catch (err) {
    return jsonResponse({ result: "error", reason: err.toString() });
  }
}

// =====================================================================
// doPost — Menerima Webhook Telegram & Simpan ke Queue
// =====================================================================
function doPost(e) {
  try {
    // 1. Form submission dari Landing Page
    if (e && e.parameter && e.parameter.action === "submit") {
      return handleFormSubmission(e);
    }

    // 2. Telegram Webhook
    if (e && e.postData && e.postData.contents) {
      var update = JSON.parse(e.postData.contents);
      var updateId = update.update_id ? update.update_id.toString() : null;

      // Dedup instan: cegah double posting ke Queue
      if (updateId) {
        var cache = CacheService.getScriptCache();
        if (cache.get("upd_" + updateId)) {
          return ContentService.createTextOutput("OK");
        }
        cache.put("upd_" + updateId, "1", 3600); // Kunci 1 jam
      }

      var msgObj = update.message || update.edited_message;

      if (msgObj && (msgObj.text || msgObj.caption) && msgObj.chat) {
        var text = (msgObj.text || msgObj.caption || "").trim();
        var chatId = msgObj.chat.id.toString();
        var msgId  = msgObj.message_id.toString();

        // /start: Proses instan langsung (tidak membebani database)
        if (text.toLowerCase() === "/start") {
          sendTelegramMessage(chatId,
            "Halo! Silakan kirimkan permintaan tiket penggantian nomor WA dengan format berikut:\n\n" +
            "<code>Req Change Number\n\nAsset : KR8\nUsername : Sulaiman122</code>",
            msgId
          );
          return ContentService.createTextOutput("OK");
        }

        // /debug: Laporan status instan langsung
        if (text.toLowerCase() === "/debug") {
          var report = "=== DEBUG BOT STATUS ===\n";
          try {
            var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/getWebhookInfo", { method: "get", muteHttpExceptions: true });
            var info = JSON.parse(res.getContentText());
            report += "🔗 Webhook URL: <code>" + (info.result.url || "Tidak ada") + "</code>\n";
            report += "⏳ Pending Updates: <b>" + info.result.pending_update_count + "</b>\n";
            if (info.result.last_error_message) {
              report += "❌ Last Error: <code>" + info.result.last_error_message + "</code>\n";
            }
          } catch (errInfo) {
            report += "❌ Gagal getWebhookInfo: " + errInfo.toString() + "\n";
          }
          
          try {
            var ss = getSpreadsheet();
            var sheetQueue = ss.getSheetByName(SHEET_QUEUE);
            var qCount = sheetQueue ? Math.max(0, sheetQueue.getLastRow() - 1) : 0;
            report += "📦 Antrian di Sheet: <b>" + qCount + "</b>\n";
          } catch (errQ) {
            report += "❌ Gagal cek sheet Queue: " + errQ.toString() + "\n";
          }
          
          sendTelegramMessage(chatId, report, msgId);
          return ContentService.createTextOutput("OK");
        }

        // /clear: Bersihkan antrian instan langsung
        if (text.toLowerCase() === "/clear") {
          try {
            var ss = getSpreadsheet();
            var sheetQueue = ss.getSheetByName(SHEET_QUEUE);
            if (sheetQueue && sheetQueue.getLastRow() > 1) {
              sheetQueue.deleteRows(2, sheetQueue.getLastRow() - 1);
            }
            sendTelegramMessage(chatId, "✅ Seluruh antrian di sheet Queue berhasil dibersihkan.", msgId);
          } catch (errClear) {
            sendTelegramMessage(chatId, "❌ Gagal membersihkan Queue: " + errClear.toString(), msgId);
          }
          return ContentService.createTextOutput("OK");
        }

        // Req Change Number: SIMPAN KE ANTRIAN SPREADSHEET (Instant, < 0.5 detik)
        if (/Req\s+Change\s+Number/i.test(text)) {
          var ss = getSpreadsheet();
          var sheetQueue = ss.getSheetByName(SHEET_QUEUE);
          if (!sheetQueue) {
            setupSheets();
            sheetQueue = ss.getSheetByName(SHEET_QUEUE);
          }
          sheetQueue.appendRow([new Date(), updateId, JSON.stringify(update), "PENDING"]);
          return ContentService.createTextOutput("OK");
        }
      }

      return ContentService.createTextOutput("OK");
    }

    return jsonResponse({ result: "error", message: "Aksi tidak dikenali." });
  } catch (err) {
    logErrorToSheet(err, "doPost");
    return ContentService.createTextOutput("OK");
  }
}

// =====================================================================
// BACKGROUND PROCESSOR — Dipanggil oleh trigger 1 menit secara FIFO
// =====================================================================
function processQueuedUpdates() {
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) {
      Logger.log("processQueuedUpdates: Gagal mendapatkan lock, skip.");
      return;
    }

    var ss = getSpreadsheet();
    var sheetQueue = ss.getSheetByName(SHEET_QUEUE);
    if (!sheetQueue) return;

    var data = sheetQueue.getDataRange().getValues();
    if (data.length <= 1) return; // Hanya baris header

    var sheetTickets = ss.getSheetByName(SHEET_TICKETS);
    if (!sheetTickets) { setupSheets(); sheetTickets = ss.getSheetByName(SHEET_TICKETS); }
    var ticketData = sheetTickets.getDataRange().getValues();

    var processedRows = [];

    // Proses baris-baris PENDING secara berurutan (FIFO)
    for (var i = 1; i < data.length; i++) {
      var status = data[i][3];
      if (status === "PENDING") {
        var updateId = data[i][1];
        var updateContent = data[i][2];
        
        try {
          var update = JSON.parse(updateContent);
          processSingleTelegramUpdate(update, ticketData, sheetTickets);
          sheetQueue.getRange(i + 1, 4).setValue("PROCESSED");
        } catch (procErr) {
          logErrorToSheet(procErr, "processQueuedUpdates_single_" + updateId);
          sheetQueue.getRange(i + 1, 4).setValue("FAILED: " + procErr.toString());
        }
        processedRows.push(i + 1);
      }
    }

    // Hapus baris yang sudah terproses (mulai dari bawah agar indeks tidak bergeser)
    var freshData = sheetQueue.getDataRange().getValues();
    for (var j = freshData.length - 1; j >= 1; j--) {
      var s = freshData[j][3];
      if (s === "PROCESSED" || s.indexOf("FAILED") === 0) {
        sheetQueue.deleteRow(j + 1);
      }
    }

  } catch (errGlobal) {
    logErrorToSheet(errGlobal, "processQueuedUpdates_global");
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
// PEMROSESAN TUNGGAL UPDATE TELEGRAM
// =====================================================================
function processSingleTelegramUpdate(update, ticketData, sheetTickets) {
  var msgObj = update.message || update.edited_message;
  if (!msgObj || !msgObj.text || !msgObj.chat) return;

  var chatId = msgObj.chat.id.toString();
  var msgId  = msgObj.message_id.toString();
  var text   = msgObj.text.trim();

  // Multi-form parsing
  var parts = text.split(/Req\s+Change\s+Number/i);
  var forms = [];
  for (var p = 1; p < parts.length; p++) {
    var partText = parts[p];
    var assetMatch = partText.match(/Asset\s*:\s*([^\n\r]+)/i);
    var userMatch  = partText.match(/Username\s*:\s*([^\n\r]+)/i);
    forms.push({
      rawAsset: assetMatch ? assetMatch[1].trim() : "",
      username: userMatch  ? userMatch[1].trim() : ""
    });
  }

  if (forms.length === 0) return;

  // Proses setiap form (FIFO, isolasi error per form)
  for (var f = 0; f < forms.length; f++) {
    var msgKey = forms.length > 1 ? (msgId + "_" + f) : msgId;

    try {
      var rawAsset = forms[f].rawAsset;
      var username = forms[f].username;

      // Validasi kelengkapan form
      if (!rawAsset || !username) {
        sendTelegramMessage(chatId, "❌ Format form tidak lengkap. Pastikan Asset dan Username diisi.", msgId);
        continue;
      }

      // Cek apakah sudah pernah diproses (untuk edited_message atau duplikasi)
      var alreadyProcessed = false;
      for (var i = 1; i < ticketData.length; i++) {
        var sChat = (ticketData[i][1] || "").toString();
        var sMsg  = (ticketData[i][2] || "").toString();
        if (sChat === chatId && sMsg === msgKey) {
          alreadyProcessed = true;
          var existingUrl = PORTAL_BASE_URL + "?k=" + ticketData[i][8];
          sendTelegramMessage(chatId,
            "⚠️ <b>ANDA SUDAH MEMILIKI TIKET AKTIF</b>\n\n" +
            "• Asset: <code>" + escapeHtml(ticketData[i][3]) + "</code>\n" +
            "• Username: <code>" + escapeHtml(ticketData[i][4]) + "</code>\n" +
            "• Tiket: <code>" + escapeHtml(ticketData[i][5]) + "</code>\n\n" +
            "🔗 Link Portal:\n<code>" + escapeHtml(existingUrl) + "</code>\n\n" +
            "⚠️ Tautan hanya dapat diakses SATU KALI saja.",
            msgId
          );
          break;
        }
      }
      if (alreadyProcessed) continue;

      // Validasi asset
      var fullAssetName = resolveAssetName(rawAsset);
      if (!fullAssetName) {
        sendTelegramMessage(chatId,
          "❌ Asset <code>" + escapeHtml(rawAsset) + "</code> tidak dikenali.\n" +
          "Gunakan: KR8, BE8, F20, G20, E20, D20 (atau nama lengkap).",
          msgId
        );
        continue;
      }

      // Buat tiket baru
      var newTicket    = generateRandomTicket();
      var newAccessKey = generateRandomAccessKey();
      var portalUrl    = PORTAL_BASE_URL + "?k=" + newAccessKey;

      sheetTickets.appendRow([
        new Date(), chatId, msgKey, fullAssetName, username,
        newTicket, "ACTIVE", false, newAccessKey
      ]);

      // Update data memori lokal agar mendeteksi duplikat instan di loop yang sama
      ticketData.push([new Date(), chatId, msgKey, fullAssetName, username, newTicket, "ACTIVE", false, newAccessKey]);

      // Kirim balasan sukses
      sendTelegramMessage(chatId,
        "✅ <b>TIKET BERHASIL DIBUAT</b>\n\n" +
        "• Asset: <code>" + escapeHtml(fullAssetName) + "</code>\n" +
        "• Username: <code>" + escapeHtml(username) + "</code>\n" +
        "• Tiket: <code>" + escapeHtml(newTicket) + "</code>\n\n" +
        "🔗 Link Portal:\n<code>" + escapeHtml(portalUrl) + "</code>\n\n" +
        "⚠️ Tautan hanya dapat diakses SATU KALI saja.",
        msgId
      );

    } catch (formErr) {
      Logger.log("Error form " + f + ": " + formErr.toString());
      sendTelegramMessage(chatId, "❌ Terjadi kesalahan saat memproses form ini. Silakan coba kembali.", msgId);
    }
  }
}

// =====================================================================
// handleFormSubmission — Submit dari Landing Page
// =====================================================================
function handleFormSubmission(e) {
  var ticket      = (e.parameter.ticket      || "").toUpperCase().trim();
  var website     = (e.parameter.website     || "").toUpperCase().trim();
  var username    = (e.parameter.username    || "").toUpperCase().trim();
  var namaLengkap = (e.parameter.nama_lengkap || "").toUpperCase().trim();
  var waLama      = e.parameter.wa_lama || "";
  var waBaru      = e.parameter.wa_baru || "";

  var ss = getSpreadsheet();

  // 1. Mark as USED in sheetTickets if ticket exists
  var sheetTickets = ss.getSheetByName(SHEET_TICKETS);
  if (sheetTickets) {
    var data = sheetTickets.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][5] === ticket) {
        sheetTickets.getRange(i + 1, 7).setValue("USED");
        break;
      }
    }
  }

  // 2. Always append to sheetResponses
  var sheetResponses = ss.getSheetByName(SHEET_RESPONSES);
  if (!sheetResponses) { setupSheets(); sheetResponses = ss.getSheetByName(SHEET_RESPONSES); }

  var customTs = e.parameter.timestamp;
  var timestampStr = "";
  if (customTs) {
    var tsDate = new Date(customTs);
    timestampStr = (tsDate.getMonth()+1) + "/" + tsDate.getDate() + "/" + tsDate.getFullYear() + " " +
                   tsDate.getHours() + ":" + (tsDate.getMinutes()<10?'0':'') + tsDate.getMinutes() + ":" + (tsDate.getSeconds()<10?'0':'') + tsDate.getSeconds();
  } else {
    var now = new Date();
    timestampStr = (now.getMonth()+1) + "/" + now.getDate() + "/" + now.getFullYear() + " " +
                   now.getHours() + ":" + (now.getMinutes()<10?'0':'') + now.getMinutes() + ":" + (now.getSeconds()<10?'0':'') + now.getSeconds();
  }

  sheetResponses.appendRow([timestampStr, ticket, website, username, namaLengkap, "'" + waLama, "'" + waBaru]);

  return jsonResponse({ result: "success", message: "Data berhasil disimpan!" });
}

// =====================================================================
// SETUP QUEUE TRIGGER & HAPUS TRIGGER LAIN
// =====================================================================
function setupQueueTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("processQueuedUpdates")
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log("✅ Trigger processQueuedUpdates (1 Menit) berhasil dibuat.");
}

// =====================================================================
// PENDAFTARAN WEBHOOK TELEGRAM
// =====================================================================
function registerTelegramWebhook() {
  var webAppUrl = "https://script.google.com/macros/s/AKfycbzRIJVW9m13d2HaHady_WokAjBxBsCQNehc60T_qlvxM_kE_TVC0Il9mwy_00pWnejQXw/exec";

  var payload = {
    url: webAppUrl,
    allowed_updates: ["message", "edited_message"],
    drop_pending_updates: true
  };

  var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + TELEGRAM_TOKEN + "/setWebhook", {
    method: "post", contentType: "application/json",
    payload: JSON.stringify(payload), muteHttpExceptions: true
  });

  Logger.log("Webhook URL: " + webAppUrl);
  Logger.log("Response: " + res.getContentText());
}
