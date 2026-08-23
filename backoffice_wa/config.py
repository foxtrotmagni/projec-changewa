import os
import json
from pathlib import Path
from dotenv import load_dotenv

ENV_PATH = Path(__file__).parent.parent / ".env"
if ENV_PATH.exists():
    load_dotenv(dotenv_path=ENV_PATH)

AUDIT_COOKIES = os.getenv("AUDIT_COOKIES", "")
DEFAULT_BASE_URL = os.getenv("DEFAULT_BASE_URL", "https://groupbo-gd3.zoomwlb.com")
ADMIN_CC_TAGS = "@khelfine @PaoPao11112022 @Hlmnopxyz88 @Dickyder_1"

USER_COOKIES_FILE = Path(__file__).parent / "user_cookies.json"

KNOWN_DOMAINS = [
    "groupbo-gd3.zoomwlb.com",
    "groupbo-ggolf7.nexwlb.com"
]

REF_URL_MAP = {
    'KR8': 'https://groupbo-ggolf7.nexwlb.com',
    'BE8': 'https://groupbo-ggolf7.nexwlb.com',
    'F20': 'https://groupbo-gd3.zoomwlb.com',
    'G20': 'https://groupbo-gd3.zoomwlb.com',
    'D20': 'https://groupbo-gd3.zoomwlb.com',
    'E20': 'https://groupbo-gd3.zoomwlb.com'
}

raw_map = os.getenv("REF_URL_MAP")
if raw_map:
    try:
        REF_URL_MAP.update(json.loads(raw_map))
    except Exception:
        pass

def normalize_domain(domain_or_url: str) -> str:
    if not domain_or_url:
        return "groupbo-gd3.zoomwlb.com"
    norm = domain_or_url.lower().replace("https://", "").replace("http://", "").strip()
    norm = norm.split("/")[0].split(":")[0]
    return norm if norm else "groupbo-gd3.zoomwlb.com"

def get_cookies(domain: str = None) -> str:
    target_domain = normalize_domain(domain)
    if USER_COOKIES_FILE.exists():
        try:
            with open(USER_COOKIES_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                global_cookies = data.get("global", {})
                if target_domain in global_cookies and global_cookies[target_domain].strip():
                    return global_cookies[target_domain].strip()
        except Exception:
            pass
    return AUDIT_COOKIES.strip()

def resolve_merchant_and_url(username: str, merchant_code_override: str = None) -> tuple[str, str]:
    raw_code = (merchant_code_override or "").strip().upper()
    
    # Map alias full names to 3-char codes
    alias_map = {
        "KRING88": "KR8", "BETPEDIA88": "BE8",
        "F200M": "F20", "G200M": "G20",
        "E200M": "E20", "D200M": "D20"
    }
    merchant_code = alias_map.get(raw_code, raw_code)
    
    if not merchant_code or len(merchant_code) > 4:
        prefix = raw_code[:3]
        merchant_code = alias_map.get(prefix, prefix) if prefix in alias_map else "F20"
            
    base_url = REF_URL_MAP.get(merchant_code, DEFAULT_BASE_URL)
    return merchant_code, base_url
