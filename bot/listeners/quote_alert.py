import asyncio
from config import db, MASTER_CHAT_ID


def start_quote_listener(bot):
    def on_snapshot(doc_snapshots, changes, read_time):
        for change in changes:
            if change.type.name == "ADDED":
                doc = change.document.to_dict()
                client = doc.get("client_name", "?")
                amount = doc.get("total_amount", 0)
                date = doc.get("created_at", "?")
                if hasattr(date, "strftime"):
                    date = date.strftime("%Y-%m-%d")
                items = doc.get("items_summary", "")
                pdf = doc.get("pdf_url", "")

                text = (
                    f"[견적서 생성 알림]\n"
                    f"거래처: {client}\n"
                    f"금액: {amount:,}원\n"
                    f"일자: {date}\n"
                    f"품목: {items}"
                )

                loop = asyncio.get_event_loop()
                coro = bot.send_message(chat_id=MASTER_CHAT_ID, text=text)

                if pdf:
                    async def send_with_pdf():
                        await bot.send_message(chat_id=MASTER_CHAT_ID, text=text)
                        await bot.send_document(chat_id=MASTER_CHAT_ID, document=pdf)
                    coro = send_with_pdf()

                asyncio.run_coroutine_threadsafe(coro, loop)

    query = db.collection("quotes")
    return query.on_snapshot(on_snapshot)
