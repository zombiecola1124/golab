from telegram import Update
from telegram.ext import ContextTypes

from config import db
from utils.auth import master_only
from utils.logger import log_command, CommandTimer


@master_only
async def handle_price(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("사용법: /p [품목명]")
        return

    keyword = " ".join(context.args)

    with CommandTimer() as timer:
        docs = db.collection("items").where("name", "==", keyword).limit(1).stream()
        item = None
        for doc in docs:
            item = doc.to_dict()
            item["_id"] = doc.id
            break

        if not item:
            docs = db.collection("items").stream()
            matches = []
            for doc in docs:
                d = doc.to_dict()
                if keyword in d.get("name", ""):
                    d["_id"] = doc.id
                    matches.append(d)
            if len(matches) == 1:
                item = matches[0]
            elif len(matches) > 1:
                names = "\n".join(f"  - {m['name']}" for m in matches[:10])
                await update.message.reply_text(f"여러 품목이 검색됨:\n{names}\n\n정확한 품목명을 입력하세요.")
                log_command("p", keyword, True, timer.elapsed_ms,
                            f"multiple_matches:{len(matches)}")
                return

    if not item:
        log_command("p", keyword, False, timer.elapsed_ms, "not_found")
        await update.message.reply_text(f"'{keyword}' 품목을 찾을 수 없습니다.")
        return

    name = item.get("name", "?")
    base_price = item.get("base_price", "-")
    last_purchase = item.get("last_purchase_price", None)
    currency = item.get("currency", "KRW")
    unit = item.get("unit", "EA")

    lines = [
        f"[단가 조회] {name}",
        f"기준단가: {base_price:,} {currency}/{unit}" if isinstance(base_price, (int, float)) else f"기준단가: {base_price}",
    ]
    if last_purchase is not None:
        lines.append(f"최근 매입가: {last_purchase:,} {currency}" if isinstance(last_purchase, (int, float)) else f"최근 매입가: {last_purchase}")

    log_command("p", keyword, True, timer.elapsed_ms,
                f"found:{name}", [item["_id"]])
    await update.message.reply_text("\n".join(lines))
