from functools import wraps
from telegram import Update
from telegram.ext import ContextTypes

from config import MASTER_CHAT_ID


def master_only(func):
    @wraps(func)
    async def wrapper(update: Update, context: ContextTypes.DEFAULT_TYPE):
        if update.effective_chat.id != MASTER_CHAT_ID:
            await update.message.reply_text("접근 권한이 없습니다.")
            return
        return await func(update, context)
    return wrapper
