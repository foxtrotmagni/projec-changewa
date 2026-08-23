import sys
import json
import asyncio
import logging
from config import resolve_merchant_and_url, get_cookies, ADMIN_CC_TAGS

logging.basicConfig(level=logging.ERROR)

async def run_check(data: dict) -> dict:
    from listing_service import (
        search_player_by_username,
        search_player_by_wa,
        search_player_by_contact_no,
        get_player_wa_verification_status,
        get_player_balance,
        get_player_current_contact,
        scrape_and_update_contact
    )
    username = data.get("username", "").strip()
    raw_asset = data.get("asset", "").strip()
    old_wa = data.get("old_wa", "").strip()
    new_wa = data.get("new_wa", "").strip()
    telegram_name = data.get("telegram_name", "").strip()
    
    merchant_code, base_url = resolve_merchant_and_url(username, raw_asset)

    cookies_str = get_cookies(domain=base_url, user_key=data.get("user_key"))
    
    if not cookies_str:
        return {"status": "error", "message": "Cookie backoffice belum terpasang."}
        
    players = await search_player_by_username(username, merchant_code, base_url, cookies_str)
    if players and len(players) == 1 and players[0].get("_error") == "COOKIE_EXPIRED":
        return {"status": "error", "message": "🔑 Cookie Backoffice telah kadaluarsa / di-logout. Silakan kirim /setcookie terbaru dari browser Backoffice yang sedang login."}
    if not players:
        return {"status": "error", "message": f"Player {username} tidak ditemukan di {merchant_code} (atau Cookie kadaluarsa)."}

        
    player_data = players[0]
    player_guid = player_data.get("recid", "")
    backoffice_username = player_data.get("username") or username
    backoffice_fullname = player_data.get("full_Name") or username
    
    old_wa_res = []
    old_contact_res = []
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

    new_wa_verif_tasks = [
        get_player_wa_verification_status(p.get("recid", ""), merchant_code, base_url, cookies_str)
        for p in valid_new_wa[:3]
    ]
    old_wa_verif_tasks = [
        get_player_wa_verification_status(p.get("recid", ""), merchant_code, base_url, cookies_str)
        for p in valid_old_wa[:3]
    ]

    all_verif = await asyncio.gather(*(new_wa_verif_tasks + old_wa_verif_tasks))
    new_verif_list = all_verif[:len(new_wa_verif_tasks)]
    old_verif_list = all_verif[len(new_wa_verif_tasks):]

    new_wa_formatted = []
    for p, is_v in zip(valid_new_wa[:3], new_verif_list):
        u = p.get("username", "")
        verif_str = "Terverifikasi" if is_v else "Belum Terverifikasi"
        new_wa_formatted.append(f"<code>{u}</code> ({verif_str})")

    old_wa_formatted = []
    for p, is_v in zip(valid_old_wa[:3], old_verif_list):
        u = p.get("username", "")
        verif_str = "Terverifikasi" if is_v else "Belum Terverifikasi"
        old_wa_formatted.append(f"<code>{u}</code> ({verif_str})")

    bal_str, _, _ = await get_player_balance(backoffice_username, merchant_code, base_url, cookies_str)
    
    name_status_str = ""
    if telegram_name:
        if telegram_name.strip().upper() == backoffice_fullname.strip().upper():
            name_status_str = " (VALID)"
        else:
            name_status_str = " (TIDAK VALID)"

    lines = [
        "🔍 <b>PENGECEKAN NOMOR WHATSAPP BARU</b>\n",
        f"Player  : <code>{backoffice_username}</code>",
        f"Asset   : <code>{merchant_code}</code>",
        f"Nama    : <b>{backoffice_fullname}</b>{name_status_str}",
        f"Balance : <code>{bal_str}</code> 💰",
    ]
    
    if old_wa:
        old_parts = []
        if old_wa_formatted:
            old_parts.append(f"💬 WA → {', '.join(old_wa_formatted)}")
        if valid_old_contact:
            dupe_old_contact = ", ".join([f"<code>{p.get('username')}</code>" for p in valid_old_contact[:3]])
            old_parts.append(f"📞 Kontak → {dupe_old_contact}")
        
        if old_parts:
            lines.append(f"Old WA  : <code>{old_wa}</code> <i>(⚠️ Terdaftar: {' | '.join(old_parts)})</i>")
        else:
            lines.append(f"Old WA  : <code>{old_wa}</code> <i>(Belum terdaftar)</i>")
            
    lines.append(f"New WA  : <code>{new_wa}</code>\n")
    
    if new_wa_formatted or valid_new_contact:
        lines.append("<b>Status :</b>")
        lines.append("⚠️ <b>Terdeteksi duplikat pada nomor baru:</b>")
        if new_wa_formatted:
            lines.append(f"   💬 <b>WhatsApp No</b> → {', '.join(new_wa_formatted)}")
        if valid_new_contact:
            dupe_new_contact = ", ".join([f"<code>{p.get('username')}</code>" for p in valid_new_contact[:3]])
            lines.append(f"   📞 <b>Nomor Kontak</b> → {dupe_new_contact}")
    else:
        lines.append("<b>Status :</b>")
        lines.append("✅ <b>Nomor WhatsApp baru bersih & belum pernah terdaftar.</b>")

    lines.append("\n━━━━━━━━━━━━━━━")
    lines.append("Lanjutkan pergantian nomor WhatsApp?")
    lines.append(f"\n🔔 <b>CC:</b> {ADMIN_CC_TAGS}")

    report_text = "\n".join([l for l in lines if l is not None])
    
    return {
        "status": "success",
        "report_text": report_text,
        "player_guid": player_guid,
        "merchant_code": merchant_code,
        "dupe_guids": dupe_guids
    }

async def run_update(data: dict) -> dict:
    from listing_service import (
        get_player_current_contact,
        scrape_and_update_contact,
        search_player_by_username
    )
    username = data.get("username", "").strip()
    raw_asset = data.get("asset", "").strip()
    player_guid = data.get("player_guid", "").strip()
    new_wa = data.get("new_wa", "").strip()
    dupe_guids = data.get("dupe_guids", [])
    
    merchant_code, base_url = resolve_merchant_and_url(username, raw_asset)
    cookies_str = get_cookies(domain=base_url, user_key=data.get("user_key"))

    
    if not cookies_str:
        return {"status": "error", "message": "Cookie backoffice belum terpasang."}

    results_log = []
    
    # 1. Hapus duplicate terlebih dahulu
    if dupe_guids:
        for dp in dupe_guids:
            dp_uname = dp.get("username", "")
            dp_recid = dp.get("recid", "")
            if dp_recid and dp_uname.lower() != username.lower():
                cur_info = await get_player_current_contact(
                    player_guid=dp_recid,
                    merchant_code=merchant_code,
                    base_url=base_url,
                    cookies_str=cookies_str
                )
                cur_wa = cur_info.get("wa", "").strip()
                cur_contact = cur_info.get("contact", "").strip()
                
                target_wa = cur_wa
                target_contact = cur_contact
                cleared_fields = []
                
                has_wa = dp.get("has_wa_dupe", False) or (cur_wa and cur_wa == new_wa.strip())
                has_contact = dp.get("has_contact_dupe", False) or (cur_contact and cur_contact == new_wa.strip())
                
                if has_wa:
                    target_wa = ""
                    cleared_fields.append("WhatsApp")
                    
                if has_contact:
                    target_contact = ""
                    cleared_fields.append("Nomor Kontak")
                    
                if cleared_fields:
                    clear_ok, clear_msg = await scrape_and_update_contact(
                        player_guid=dp_recid,
                        merchant_code=merchant_code,
                        base_url=base_url,
                        cookies_str=cookies_str,
                        new_wa=target_wa,
                        new_contact_no=target_contact
                    )
                    if clear_ok:
                        results_log.append(f"✔️ {' & '.join(cleared_fields)} pada user duplicate <b>{dp_uname}</b> berhasil dihapus")
                    else:
                        results_log.append(f"⚠️ Gagal menghapus {' & '.join(cleared_fields)} pada user duplicate {dp_uname}: {clear_msg}")

    # 2. If player_guid empty, search
    if not player_guid:
        players = await search_player_by_username(username, merchant_code, base_url, cookies_str)
        if players:
            player_guid = players[0].get("recid", "")

    if not player_guid:
        return {"status": "error", "message": f"Player {username} tidak ditemukan."}

    ok, detail_msg = await scrape_and_update_contact(
        player_guid=player_guid,
        merchant_code=merchant_code,
        base_url=base_url,
        cookies_str=cookies_str,
        new_wa=new_wa,
        new_contact_no=new_wa
    )
    
    if ok:
        results_log.append(f"✔️ Nomor WhatsApp <b>{new_wa}</b> berhasil di-update ke user <b>{username}</b>")
        return {"status": "success", "detail_logs": results_log}
    else:
        return {"status": "error", "message": detail_msg, "detail_logs": results_log}

async def run_setcookie(data: dict) -> dict:
    from config import set_cookies
    new_cookies = data.get("cookies", "").strip()
    user_key = data.get("user_key")
    if not new_cookies:
        return {"status": "error", "message": "String cookie kosong."}
    set_cookies(new_cookies, user_key=user_key)
    return {"status": "success", "message": "Cookie Backoffice berhasil diperbarui & disimpan!"}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "Argumen tidak lengkap"}))
        return
        
    cmd = sys.argv[1]
    if len(sys.argv) >= 3:
        raw_json = sys.argv[2]
    else:
        raw_json = sys.stdin.read().strip()
        
    try:
        data = json.loads(raw_json)
    except Exception:
        try:
            data = json.loads(raw_json.replace("'", '"'))
        except Exception as e:
            print(json.dumps({"status": "error", "message": f"Invalid JSON: {e}"}))
            return

    if cmd == "check":
        res = asyncio.run(run_check(data))
    elif cmd == "update":
        res = asyncio.run(run_update(data))
    elif cmd == "setcookie":
        res = asyncio.run(run_setcookie(data))
    else:
        res = {"status": "error", "message": "Command tidak dikenal"}

        
    print(json.dumps(res))

if __name__ == "__main__":
    main()

