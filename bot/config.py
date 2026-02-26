import os
import json
from pathlib import Path

from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
MASTER_CHAT_ID = int(os.getenv("MASTER_CHAT_ID", "0"))

# Firebase
_cred = credentials.Certificate(str(BASE_DIR / "service-account.json"))
firebase_admin.initialize_app(_cred)
db = firestore.client()

# commands.json 로드
with open(BASE_DIR / "commands.json", encoding="utf-8") as f:
    COMMANDS = json.load(f)["commands"]
