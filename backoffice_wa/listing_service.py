import logging
import httpx
from bs4 import BeautifulSoup
from config import get_cookies

logger = logging.getLogger(__name__)

def _build_client(base_url: str, cookies_str: str, timeout: float = 15.0) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=base_url,
        headers={"Cookie": cookies_str},
        timeout=timeout,
        follow_redirects=True,
        verify=False
    )

def _build_headers(base_url: str, cookies_str: str, referer: str = None, is_ajax: bool = True) -> dict:
    headers = {
        "accept": "application/json, text/javascript, */*; q=0.01" if is_ajax else "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8" if is_ajax else "application/x-www-form-urlencoded",
        "cookie": cookies_str,
        "origin": base_url,
        "referer": referer or f"{base_url}/Player/PlayerListing",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    if is_ajax:
        headers["x-requested-with"] = "XMLHttpRequest"
    return headers

def _extract_all_inputs(html: str, form_id: str = None) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    target = soup.find("form", id=form_id) if form_id else (soup.find("form") or soup)
    form_data = {}
    
    for inp in target.find_all("input"):
        name = inp.get("name")
        if not name: continue
        itype = inp.get("type", "text").lower()
        if itype in ("submit", "button", "reset", "image"): continue
        if itype in ("checkbox", "radio"):
            if inp.has_attr("checked") or inp.get("checked"):
                form_data[name] = inp.get("value", "true")
        else:
            form_data[name] = inp.get("value", "")
            
    for sel in target.find_all("select"):
        name = sel.get("name")
        if not name: continue
        selected = sel.find("option", selected=True)
        form_data[name] = selected.get("value", "") if selected else ""
        
    for ta in target.find_all("textarea"):
        name = ta.get("name")
        if name: form_data[name] = ta.get_text()
        
    return form_data

def _extract_token(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    inp = soup.find("input", attrs={"name": "__RequestVerificationToken"})
    return inp.get("value", "") if inp else ""

async def get_player_balance(username: str, merchant_code: str, base_url: str, cookies_str: str) -> tuple[str, str, str]:
    url = f"{base_url}/Player/GetPlayerBalance"
    headers = {
        "accept": "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "cookie": cookies_str,
        "origin": base_url,
        "referer": f"{base_url}/Player/PlayerDetails",
        "user-agent": "Mozilla/5.0",
        "x-requested-with": "XMLHttpRequest",
    }
    data = {"username": username, "merchantcode": merchant_code}
    try:
        async with httpx.AsyncClient(timeout=10.0, verify=False) as client:
            resp = await client.post(url, data=data, headers=headers)
            if resp.status_code == 200:
                res_data = resp.json()
                bal = str(res_data.get("balance") if res_data.get("balance") is not None else "0.00").strip()
                lock = str(res_data.get("balancelock") if res_data.get("balancelock") is not None else "0.00").strip()
                return f"{bal} [{lock}]", bal, lock
    except Exception as e:
        logger.warning(f"[get_player_balance] Exception: {e}")
    return "0.00 [0.00]", "0.00", "0.00"

async def search_player_by_username(username: str, merchant_code: str, base_url: str, cookies_str: str) -> list[dict]:
    url = f"{base_url}/Player/_PlayerListing"
    headers = _build_headers(base_url, cookies_str)
    payload = {
        "MerchantCode": merchant_code,
        "Username": username.strip(),
        "PageSize": 10,
        "PageIndex": 1
    }
    try:
        async with _build_client(base_url, cookies_str) as client:
            resp = await client.post(url, data=payload, headers=headers)
            raw_text = resp.text.strip()
            if "<html" in raw_text.lower() or "login" in str(resp.url).lower() or "account/login" in raw_text.lower():
                logger.warning("[search_player_by_username] Redirected to login page. Cookie is expired.")
                return [{"_error": "COOKIE_EXPIRED", "_msg": "Cookie Backoffice telah kadaluarsa / di-logout."}]
            if resp.status_code == 200:
                data = resp.json()
                items = data.get("items", []) or []
                clean_target = username.strip().lower()
                exact = [p for p in items if p.get("username", "").strip().lower() == clean_target]
                return exact if exact else items
    except Exception as e:
        logger.error(f"[search_player_by_username] Error: {e}")
    return []


async def search_player_by_wa(wa_number: str, merchant_code: str, base_url: str, cookies_str: str) -> list[dict]:
    url = f"{base_url}/Player/_PlayerListing"
    headers = _build_headers(base_url, cookies_str)
    payload = {
        "MerchantCode": merchant_code,
        "ContactWhatsApp": wa_number.strip(),
        "PageSize": 10,
        "PageIndex": 1
    }
    try:
        async with _build_client(base_url, cookies_str) as client:
            resp = await client.post(url, data=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("items", []) or []
    except Exception as e:
        logger.error(f"[search_player_by_wa] Error: {e}")
    return []

async def search_player_by_contact_no(contact_number: str, merchant_code: str, base_url: str, cookies_str: str) -> list[dict]:
    url = f"{base_url}/Player/_PlayerListing"
    headers = _build_headers(base_url, cookies_str)
    payload = {
        "MerchantCode": merchant_code,
        "ContactNo": contact_number.strip(),
        "PageSize": 10,
        "PageIndex": 1
    }
    try:
        async with _build_client(base_url, cookies_str) as client:
            resp = await client.post(url, data=payload, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return data.get("items", []) or []
    except Exception as e:
        logger.error(f"[search_player_by_contact_no] Error: {e}")
    return []

async def get_player_wa_verification_status(player_guid: str, merchant_code: str, base_url: str, cookies_str: str) -> bool:
    page_url = f"/Player/PlayerContactDetails/{player_guid}?merchantcode={merchant_code}&IsView=0"
    page_headers = _build_headers(base_url, cookies_str, referer=f"{base_url}/Player/PlayerListing", is_ajax=False)
    page_headers.pop("content-type", None)
    page_headers.pop("x-requested-with", None)
    try:
        async with _build_client(base_url, cookies_str) as client:
            resp_get = await client.get(page_url, headers=page_headers)
            if resp_get.status_code == 200:
                soup = BeautifulSoup(resp_get.text, "html.parser")
                icon_success = soup.find("i", class_="contact-info-icon-success")
                icon_failed = soup.find("i", class_="contact-info-icon-failed")
                if icon_success: return True
                if icon_failed: return False
                return "circle-check" in resp_get.text.lower()
    except Exception as e:
        logger.warning(f"[get_player_wa_verification_status] Error: {e}")
    return False

async def get_player_current_contact(player_guid: str, merchant_code: str, base_url: str, cookies_str: str) -> dict:
    page_url = f"/Player/PlayerContactDetails/{player_guid}?merchantcode={merchant_code}&IsView=0"
    page_headers = _build_headers(base_url, cookies_str, referer=f"{base_url}/Player/PlayerListing", is_ajax=False)
    page_headers.pop("content-type", None)
    page_headers.pop("x-requested-with", None)
    async with _build_client(base_url, cookies_str) as client:
        try:
            resp_get = await client.get(page_url, headers=page_headers)
            resp_get.raise_for_status()
            form_data = _extract_all_inputs(resp_get.text)
            wa = (
                form_data.get("PlayerContactForm.ContactWhatsApp") or
                form_data.get("ContactDetailsForm.ContactWhatsApp") or
                form_data.get("ContactWhatsApp") or ""
            ).strip()
            contact = (
                form_data.get("PlayerContactForm.ContactNo") or
                form_data.get("ContactDetailsForm.ContactNo") or
                form_data.get("ContactNo") or ""
            ).strip()
            return {"wa": wa, "contact": contact}
        except Exception as e:
            logger.warning(f"[get_player_current_contact] Error: {e}")
            return {"wa": "", "contact": ""}

async def scrape_and_update_contact(
    player_guid: str,
    merchant_code: str,
    base_url: str,
    cookies_str: str,
    new_wa: str,
    new_contact_no: str = None
) -> tuple[bool, str]:
    page_url = f"/Player/PlayerContactDetails/{player_guid}?merchantcode={merchant_code}&IsView=0"
    page_headers = _build_headers(base_url, cookies_str, referer=f"{base_url}/Player/PlayerListing", is_ajax=False)
    page_headers.pop("content-type", None)
    page_headers.pop("x-requested-with", None)
    
    async with _build_client(base_url, cookies_str) as client:
        try:
            resp_get = await client.get(page_url, headers=page_headers)
            resp_get.raise_for_status()
            html = resp_get.text
            
            form_data = _extract_all_inputs(html)
            token = form_data.get("__RequestVerificationToken") or _extract_token(html)
            if not token:
                return False, "Gagal mendapatkan verification token untuk update kontak"
            form_data["__RequestVerificationToken"] = token
            
            clean_wa = new_wa.strip() if new_wa is not None else ""
            clean_contact = new_contact_no.strip() if new_contact_no is not None else clean_wa
            
            form_data["PlayerContactForm.ContactWhatsApp"] = clean_wa
            form_data["PlayerContactForm.ContactNo"] = clean_contact
            form_data["merchantcode"] = merchant_code
            form_data["IsView"] = "0"
            
            post_url = "/Player/UpdateContactDetails"
            post_headers = _build_headers(base_url, cookies_str, referer=page_url)
            resp_post = await client.post(post_url, data=form_data, headers=post_headers)
            
            if resp_post.status_code in (200, 302):
                return True, f"WhatsApp berhasil diperbarui menjadi: {clean_wa}"
            else:
                return False, f"HTTP {resp_post.status_code}: {resp_post.text[:200]}"
        except Exception as e:
            logger.error(f"[scrape_and_update_contact] Error: {e}")
            return False, str(e)
