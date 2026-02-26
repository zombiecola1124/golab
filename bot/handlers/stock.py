from telegram import Update
from telegram.ext import ContextTypes

from config import db
from utils.auth import master_only
from utils.logger import log_command, CommandTimer


@master_only
async def handle_stock(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not context.args:
        await update.message.reply_text("사용법: /s [품목명]")
        return

    keyword = " ".join(context.args)

    with CommandTimer() as timer:
        docs = db.collection("inventory").where("name", "==", keyword).limit(1).stream()
        inv = None
        for doc in docs:
            inv = doc.to_dict()
            inv["_id"] = doc.id
            break

        if not inv:
            docs = db.collection("inventory").stream()
            matches = []
            for doc in docs:
                d = doc.to_dict()
                if keyword in d.get("name", ""):
                    d["_id"] = doc.id
                    matches.append(d)
            if len(matches) == 1:
                inv = matches[0]
            elif len(matches) > 1:
                names = "\n".join(f"  - {m['name']}" for m in matches[:10])
                await update.message.reply_text(f"여러 품목이 검색됨:\n{names}\n\n정확한 품목명을 입력하세요.")
                log_command("s", keyword, True, timer.elapsed_ms,
                            f"multiple_matches:{len(matches)}")
                return

    if not inv:
        log_command("s", keyword, False, timer.elapsed_ms, "not_found")
        await update.message.reply_text(f"'{keyword}' 재고 정보를 찾을 수 없습니다.")
        return

    name = inv.get("name", "?")
    current = inv.get("current_qty", 0)
    minimum = inv.get("min_qty", 0)
    tag = inv.get("status_tag", "")

    if not tag:
        if current <= 0:
            tag = "재고없음"
        elif current <= minimum:
            tag = "부족"
        else:
            tag = "정상"

    lines = [
        f"[재고 조회] {name}",
        f"현재고: {current}",
        f"최소재고: {minimum}",
        f"상태: {tag}",
    ]

    log_command("s", keyword, True, timer.elapsed_ms,
                f"found:{name} qty:{current}", [inv["_id"]])
    await update.message.reply_text("\n".join(lines))
