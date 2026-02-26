import asyncio
import json
import logging
from pathlib import Path

from telegram.ext import ApplicationBuilder, CommandHandler

from config import TELEGRAM_TOKEN, COMMANDS
from handlers.price import handle_price
from handlers.stock import handle_stock
from handlers.client import handle_client
from listeners.quote_alert import start_quote_listener
from listeners.stock_alert import start_stock_listener

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

HANDLER_MAP = {
    "price": handle_price,
    "stock": handle_stock,
    "client": handle_client,
}


def main():
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()

    for cmd_name, cmd_cfg in COMMANDS.items():
        handler_key = cmd_cfg["handler"]
        if handler_key in HANDLER_MAP:
            app.add_handler(CommandHandler(cmd_name, HANDLER_MAP[handler_key]))
            logger.info(f"명령어 등록: /{cmd_name} → {handler_key}")

    bot = app.bot
    quote_unsub = start_quote_listener(bot)
    stock_unsub = start_stock_listener(bot)
    logger.info("Firestore 리스너 시작 (quotes, inventory)")

    logger.info("GOLAB Bot v1.1 가동")
    app.run_polling()


if __name__ == "__main__":
    asyncio.set_event_loop(asyncio.new_event_loop())
    main()
