import os
import re
import sys
import json
import asyncio
import logging
import httpx
from pathlib import Path

# Add backoffice_wa to sys.path
sys.path.append(str(Path(__file__).parent / "backoffice_wa"))

from config import resolve_merchant_and_url, get_cookies, set_cookies, ADMIN_CC_TAGS
from listing_service import (
    search_player_by_username,
    search_player_by_wa,
    search_player_by_contact_no,
    get_player_wa_verification_status,
    get_player_balance,
    get_player_current_contact,
    scrape_and_update_contact
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("LocalWorker")

TELEGRAM_TOKEN = "8775838848:AAEsLxIpnvGpEfM2LtJIevaA_gh9kMs4uts"
TARGET_GROUP_ID = -1004481056112
API_URL = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"

processed_msg_ids = set()

async def tg_post(method: str, json_data: dict) -> dict:
    async with httpx.AsyncClient(timeout=15.0) as client:
        try:
            resp = await client.post(f"{API_URL}/{method}", json=json_data)
            return resp.json()
        except Exception as e:
            logger.error(f"[Telegram API Error {method}]: {e}")
            return {}

def parse_request_notice(text: str) -> dict:
    if "PERMINTAAN PERGANTIAN NOMOR WA" not in text:
        return None
        
    asset_m = re.search(r"Asset\s*:\s*([^\n]+)", text, re.IGNORECASE)
    user_m = re.search(r"Username\s*:\s*([^\n]+)", text, re.IGNORECASE)
    name_m = re.search(r"Full Name\s*:\s*([^\n]+)", text, re.IGNORECASE)
    old_wa_m = re.search(r"Old Whatsapp\s*:\s*([^\n]+)", text, re.IGNORECASE)
    new_wa_m = re.search(r"New Whatsapp\s*:\s*([^\n]+)", text, re.IGNORECASE)
    
    if not (user_m and new_wa_m):
        return None
        
    return {
        "asset": asset_m.group(1).strip() if asset_m else "F20",
        "username": user_m.group(1).strip(),
        "fullname": name_m.group(1).strip() if name_m else "",
        "old_wa": old_wa_m.group(1).strip() if old_wa_m else "",
        "new_wa": new_wa_m.group(1).strip()
    }

async def process_check_and_report(msg_id: int, req_data: dict):
    username = req_data["username"]
    raw_asset = req_data["asset"]
    old_wa = req_data["old_wa"]
    new_wa = req_data["new_wa"]
    telegram_name = req_data["fullname"]
    
    merchant_code, base_url = resolve_merchant_and_url(username, raw_asset)
    cookies_str = get_cookies(domain=base_url)
    
    if not cookies_str:
        logger.warning(f"Cookie backoffice belum terpasang untuk {username}")
        return
        
    logger.info(f"Checking backoffice player {username} on {merchant_code}...")
    players = await search_player_by_username(username, merchant_code, base_url, cookies_str)
    if not players:
        logger.warning(f"Player {username} tidak ditemukan di {merchant_code}")
        return
        
    player_data = players[0]
    player_guid = player_data.get("recid", "")
    backoffice_username = player_data.get("username") or username
    backoffice_fullname = player_data.get("full_Name") or username
    
    old_wa_res, old_contact_res = [], []
    if old_wa:
        old_wa_task = search_player_by_wa(old_wa, merchant_code, base_url, cookies_str)
        old_contact_task = search_player_by_contact_no(old_wa, merchant_code, base_url, cookies_str)
        old_wa_res, old_contact_res = await asyncio.gather(old_wa_task, old_contact_task)
        
    new_wa_task = search_player_by_wa(new_wa, merchant_code, base_url, cookies_str)
    new_contact_task = search_player_by_contact_no(new_wa, merchant_code, base_url, cookies_str)
    new_wa_res, new_contact_res = await asyncio.gather(new_wa_task, new_contact_task)
    
    valid_new_wa = [p for p in new_wa_res if p.get("username")]
    valid_new_contact = [p for p in new_contact_res if p.get("username")]
    valid_old_wa = [p for p in old_wa_res if p.get("username")]
    valid_old_contact = [p for p in old_contact_res if p.get("username")]

    dupe_guids = []
    all_dupes = {p.get("username", "").lower(): p for p in (valid_new_wa + valid_new_contact) if p.get("username")}
    for u_lower, p in all_dupes.items():
        u_name = p.get("username", "")
        r_id = p.get("recid", "")
        if u_name and r_id and u_name.lower() != backoffice_username.lower():
            is_wa = any(x.get("username", "").lower() == u_lower for x in valid_new_wa)
            is_contact = any(x.get("username", "").lower() == u_lower for x in valid_new_contact)
            dupe_guids.append({
                "username": u_name,
                "recid": r_id,
                "has_wa_dupe": is_wa,
                "has_contact_dupe": is_contact
            })

    new_verif = await asyncio.gather(*[
        get_player_wa_verification_status(p.get("recid", ""), merchant_code, base_url, cookies_str)
        for p in valid_new_wa[:3]
    ])
    old_verif = await asyncio.gather(*[
        get_player_wa_verification_status(p.get("recid", ""), merchant_code, base_url, cookies_str)
        for p in valid_old_wa[:3]
    ])

    new_wa_formatted = [
        f"<code>{p.get('username')}</code> ({'Terverifikasi' if v else 'Belum Terverifikasi'})"
        for p, v in zip(valid_new_wa[:3], new_verif)
    ]
    old_wa_formatted = [
        f"<code>{p.get('username')}</code> ({'Terverifikasi' if v else 'Belum Terverifikasi'})"
        for p, v in zip(valid_old_wa[:3], old_verif)
    ]

    bal_str, _, _ = await get_player_balance(backoffice_username, merchant_code, base_url, cookies_str)
    
    name_status_str = ""
    if telegram_name:
        if telegram_name.strip().upper() == backoffice_fullname.strip().upper():
            name_status_str = " (VALID)"
        else:
            name_status_str = " (TIDAK VALID)"

    lines = [
        "🔍 <b>PENGECEKAN NOMOR WHATSAPP BARU (LOCAL WORKER)</b>\n",
        f"Player  : <code>{backoffice_username}</code>",
        f"Asset   : <code>{merchant_code}</code>",
        f"Nama    : <b>{backoffice_fullname}</b>{name_status_str}",
        f"Balance : <code>{bal_str}</code> 💰",
    ]
    
    if old_wa:
        old_parts = []
        if old_wa_formatted: old_parts.append(f"💬 WA → {', '.join(old_wa_formatted)}")
        if valid_old_contact:
            dupe_old = ", ".join([f"<code>{p.get('username')}</code>" for p in valid_old_contact[:3]])
            old_parts.append(f"📞 Kontak → {dupe_old}")
        lines.append(f"Old WA  : <code>{old_wa}</code> <i>({' | '.join(old_parts) if old_parts else 'Belum terdaftar'})</i>")
            
    lines.append(f"New WA  : <code>{new_wa}</code>\n")
    
    if new_wa_formatted or valid_new_contact:
        lines.append("<b>Status :</b>")
        lines.append("⚠️ <b>Terdeteksi duplikat pada nomor baru:</b>")
        if new_wa_formatted: lines.append(f"   💬 <b>WhatsApp No</b> → {', '.join(new_wa_formatted)}")
        if valid_new_contact:
            dupe_new = ", ".join([f"<code>{p.get('username')}</code>" for p in valid_new_contact[:3]])
            lines.append(f"   📞 <b>Nomor Kontak</b> → {dupe_new}")
    else:
        lines.append("<b>Status :</b>")
        lines.append("✅ <b>Nomor WhatsApp baru bersih & belum pernah terdaftar.</b>")

    lines.append("\n━━━━━━━━━━━━━━━")
    lines.append("Lanjutkan pergantian nomor WhatsApp?")
    lines.append(f"\n🔔 <b>CC:</b> {ADMIN_CC_TAGS}")

    report_text = "\n".join(lines)
    
    # Send report reply to msg_id
    ticket_payload = {
        "username": backoffice_username,
        "asset": merchant_code,
        "player_guid": player_guid,
        "new_wa": new_wa,
        "dupe_guids": dupe_guids
    }
    encoded_data = json.dumps(ticket_payload)
    
    reply_markup = {
        "inline_keyboard": [
            [
                {"text": "🟢 Done Update", "callback_data": f"loc_done:{encoded_data}"},
                {"text": "🔴 Reject", "callback_data": f"loc_reject"}
            ],
            [
                {"text": "🟪 Already Registered", "callback_data": f"loc_already"}
            ]
        ]
    }
    
    await tg_post("sendMessage", {
        "chat_id": TARGET_GROUP_ID,
        "text": report_text,
        "parse_mode": "HTML",
        "reply_to_message_id": msg_id,
        "reply_markup": reply_markup
    })
    logger.info(f"Report sent for {username}")

async def handle_callback(cb: dict):
    cb_id = cb.get("id")
    data = cb.get("data", "")
    msg = cb.get("message", {})
    from_user = cb.get("from", {})
    clicker_name = from_user.get("username") or from_user.get("first_name", "Admin")

    if not data.startswith("loc_"):
        return

    if data.startswith("loc_done:"):
        await tg_post("answerCallbackQuery", {"callback_query_id": cb_id, "text": "✅ Data berhasil di update"})

        current_caption = msg.get("text", "")
        new_text = current_caption + f"\n\n✅ <b>[ STATUS: Done Update oleh @{clicker_name} ]</b>"

        await tg_post("editMessageText", {
            "chat_id": msg["chat"]["id"],
            "message_id": msg["message_id"],
            "text": new_text,
            "parse_mode": "HTML",
            "reply_markup": {"inline_keyboard": []}
        })

    elif data == "loc_reject":
        await tg_post("answerCallbackQuery", {"callback_query_id": cb_id, "text": "❌ Permintaan Dibatalkan"})
        current_caption = msg.get("text", "")
        new_text = current_caption + f"\n\n❌ <b>[ STATUS: Permintaan Dibatalkan oleh @{clicker_name} ]</b>"
        await tg_post("editMessageText", {
            "chat_id": msg["chat"]["id"],
            "message_id": msg["message_id"],
            "text": new_text,
            "parse_mode": "HTML",
            "reply_markup": {"inline_keyboard": []}
        })

    elif data == "loc_already":
        await tg_post("answerCallbackQuery", {"callback_query_id": cb_id, "text": "⚠️ Dibatalkan karena nomor sudah terdaftar"})
        current_caption = msg.get("text", "")
        new_text = current_caption + f"\n\n⚠️ <b>[ STATUS: Dibatalkan karena nomor sudah terdaftar oleh @{clicker_name} ]</b>"
        await tg_post("editMessageText", {
            "chat_id": msg["chat"]["id"],
            "message_id": msg["message_id"],
            "text": new_text,
            "parse_mode": "HTML",
            "reply_markup": {"inline_keyboard": []}
        })

async def main():
    logger.info("==================================================")
    logger.info("   FOX.x.BOT - LOCAL BACKOFFICE WORKER ACTIVE    ")
    logger.info("==================================================")
    logger.info("Worker ini bertugas melakukan Pengecekan & Eksekusi Backoffice dari Komputer Lokal Anda.")
    
    offset = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        while True:
            try:
                params = {"timeout": 20, "allowed_updates": ["message", "callback_query"]}
                if offset: params["offset"] = offset
                
                resp = await client.get(f"{API_URL}/getUpdates", params=params)
                data = resp.json()
                
                if data.get("ok"):
                    results = data.get("result", [])
                    for u in results:
                        offset = u["update_id"] + 1
                        
                        if "message" in u:
                            msg = u["message"]
                            msg_id = msg.get("message_id")
                            text = msg.get("text", "")
                            
                            # Handle /setcookie command on local worker
                            if text.startswith("/setcookie"):
                                cookie_arg = text.replace("/setcookie", "").replace("@FOX_x_BOT", "").strip()
                                sender_id = msg.get("from", {}).get("id")
                                if cookie_arg:
                                    set_cookies(cookie_arg, user_key=sender_id)
                                    await tg_post("sendMessage", {
                                        "chat_id": msg["chat"]["id"],
                                        "text": "✅ <b>COOKIE BACKOFFICE WORKER LOKAL BERHASIL DISIMPAN!</b>\n\nBot sekarang terhubung ke Backoffice dari Komputer Lokal Anda.",
                                        "parse_mode": "HTML",
                                        "reply_to_message_id": msg_id
                                    })
                                else:
                                    await tg_post("sendMessage", {
                                        "chat_id": msg["chat"]["id"],
                                        "text": "🔑 <b>PERBARUI COOKIE SESSION BACKOFFICE (WORKER LOKAL)</b>\n\nSilakan kirimkan perintah beserta Cookie Backoffice Anda dengan format di bawah ini:\n\n<code>/setcookie ASP.NET_SessionId=...; __RequestVerificationToken=...</code>",
                                        "parse_mode": "HTML",
                                        "reply_to_message_id": msg_id
                                    })


                            
                            # Detect Request Notice from Render Bot
                            elif msg.get("chat", {}).get("id") == TARGET_GROUP_ID and msg_id not in processed_msg_ids:
                                req_data = parse_request_notice(text)
                                if req_data:
                                    processed_msg_ids.add(msg_id)
                                    asyncio.create_task(process_check_and_report(msg_id, req_data))
                                    
                        elif "callback_query" in u:
                            asyncio.create_task(handle_callback(u["callback_query"]))
                            
            except Exception as e:
                logger.error(f"[Worker Exception]: {e}")
                await asyncio.sleep(3)

if __name__ == "__main__":
    asyncio.run(main())
