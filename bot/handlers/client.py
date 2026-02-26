from telegram import Update
from telegram.ext import ContextTypes
from google.cloud.firestore_v1 import Query

from config import db
from utils.auth import master_only
from utils.logger import log_command, CommandTimer


@master_only
async def handle_client(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("사용법: /c [업체명]")
        return

    keyword = " ".join(context.args)

    with CommandTimer() as timer:
        # 최근 견적 1~3건
        q_docs = (db.collection("quotes")
                  .where("client_name", "==", keyword)
                  .order_by("created_at", direction=Query.DESCENDING)
                  .limit(3)
                  .stream())
        quotes = []
        for doc in q_docs:
            d = doc.to_dict()
            d["_id"] = doc.id
            quotes.append(d)

        # 입금 기록 합산
        p_docs = (db.collection("payments")
                  .where("client_name", "==", keyword)
                  .stream())
        total_paid = sum(d.to_dict().get("amount", 0) for d in p_docs)

        # 견적 발행 총액
        total_quoted = sum(q.get("total_amount", 0) for q in quotes)

        # 전체 견적으로 총액 재계산 (미수 추정용)
        all_q = (db.collection("quotes")
                 .where("client_name", "==", keyword)
                 .stream())
        total_quoted_all = sum(d.to_dict().get("total_amount", 0) for d in all_q)

    if not quotes:
        log_command("c", keyword, False, timer.elapsed_ms, "no_quotes")
        await update.message.reply_text(f"'{keyword}' 거래처의 견적 기록이 없습니다.")
        return

    ar_estimate = total_quoted_all - total_paid

    lines = [f"[거래처 브리핑] {keyword}", ""]

    for i, q in enumerate(quotes, 1):
        date = q.get("created_at", "?")
        if hasattr(date, "strftime"):
            date = date.strftime("%Y-%m-%d")
        amount = q.get("total_amount", 0)
        items_summary = q.get("items_summary", "")
        lines.append(f"견적{i}. {date} | {amount:,}원 {items_summary}")

    lines.append("")
    lines.append(f"미수 추정치: {ar_estimate:,}원")
    lines.append(f"  (견적발행액 {total_quoted_all:,} - 입금기록 {total_paid:,})")

    last_date = quotes[0].get("created_at", "?")
    if hasattr(last_date, "strftime"):
        last_date = last_date.strftime("%Y-%m-%d")
    lines.append(f"마지막 거래일: {last_date}")

    doc_refs = [q["_id"] for q in quotes]
    log_command("c", keyword, True, timer.elapsed_ms,
                f"quotes:{len(quotes)} ar:{ar_estimate}", doc_refs)
    await update.message.reply_text("\n".join(lines))
