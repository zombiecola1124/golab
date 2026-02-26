import asyncio
from config import db, MASTER_CHAT_ID


def start_stock_listener(bot):
    def on_snapshot(doc_snapshots, changes, read_time):
        for change in changes:
            if change.type.name == "MODIFIED":
                doc = change.document.to_dict()
                name = doc.get("name", "?")
                current = doc.get("current_qty", 0)
                minimum = doc.get("min_qty", 0)

                if current < minimum:
                    text = (
                        f"[재고 경고]\n"
                        f"품목: {name}\n"
                        f"현재고: {current}\n"
                        f"최소재고: {minimum}\n"
                        f"부족수량: {minimum - current}"
                    )

                    loop = asyncio.get_event_loop()
                    coro = bot.send_message(chat_id=MASTER_CHAT_ID, text=text)
                    asyncio.run_coroutine_threadsafe(coro, loop)

    query = db.collection("inventory")
    return query.on_snapshot(on_snapshot)
