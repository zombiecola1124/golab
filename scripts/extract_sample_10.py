"""
GoLab v1.6.1 — 샘플 10건 추출 스크립트
trade_import.json에서 "기존 7건 + 신규 3건" 구성의 테스트 샘플 생성

사용법:
  python scripts/extract_sample_10.py

출력:
  web/data/trade_import_sample_10.json
"""

import json
import os

# ── 경로 설정 ──
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(BASE, "web", "trade_import.json")
OUT_DIR = os.path.join(BASE, "web", "data")
OUT  = os.path.join(OUT_DIR, "trade_import_sample_10.json")

# ── 수동 선택: 기존 7건 + 신규 3건 ──
# trade_import_test.json(15건)에서 검증 가치가 높은 10건 선별
# 선택 기준:
#   - 이동평균 검증: 같은 itemId(item-a52fed58) 2건, 단가 다름
#   - 다양한 vendor: 코아테크, 네이버, 지마켓
#   - 단가 0원 엣지케이스 포함
#   - 신규 3건은 inventory에 seed하지 않을 itemId

# 기존 품목 7건의 itemId (seed 대상)
EXISTING_ITEM_IDS = [
    "item-a52fed58",  # 벽면실험대 1200 (2건 → 이동평균 테스트)
    "item-9bc4278f",  # SUS 카트
    "item-0e9b1024",  # 벽면실험대 1800
    "item-59e57ebe",  # 벽면실험대 1500
    "item-ef67ec2f",  # 3M 절연테이프 (qty=20, 대량)
    "item-badb9340",  # 3M 프리미엄 +35 (단가 0원 엣지)
    "item-c61ce647",  # 3M 스카치 35+ 레드 (단가 0원 엣지)
]

# 신규 품목 3건의 itemId (seed 안 함 → confirm 테스트)
NEW_ITEM_IDS = [
    "item-ca8df25f",  # Working Table SUS304 (단가 354,000)
    "item-0726b655",  # 하구병 60L (단가 50,000)
    "item-7a924dfd",  # SAFEPLUS 라텍스장갑 (단가 0원 → 신규+0원 엣지)
]

ALL_TARGET_IDS = set(EXISTING_ITEM_IDS + NEW_ITEM_IDS)


def main():
    # ── 원본 로드 ──
    with open(SRC, "r", encoding="utf-8") as f:
        full = json.load(f)
    print(f"원본 로드: {len(full)}건")

    # ── 대상 레코드 추출 ──
    selected = []
    seen_ids = set()  # 같은 itemId 중복 허용 (이동평균 테스트)

    for idx, rec in enumerate(full):
        item_id = rec.get("itemId", "")
        if item_id in ALL_TARGET_IDS:
            # _meta 필드 추가 (import 로직에서 해시용으로만 사용)
            rec["_lineNo"] = idx + 2  # Excel 행번호 (헤더=1행)
            rec["_currency"] = "KRW"
            if item_id in NEW_ITEM_IDS:
                rec["_group"] = "new"
            else:
                rec["_group"] = "existing"
            selected.append(rec)

    print(f"추출: {len(selected)}건")

    # ── 정확히 10건 맞추기: 기존 7건 + 신규 3건 ──
    existing = [r for r in selected if r["_group"] == "existing"][:7]
    new = [r for r in selected if r["_group"] == "new"][:3]
    selected = existing + new
    assert len(selected) == 10, f"샘플 건수 불일치: {len(selected)}건 (기대: 10건)"

    # ── 날짜순 정렬 ──
    selected.sort(key=lambda r: r.get("purchaseDate", ""))

    # ── 출력 ──
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(selected, f, ensure_ascii=False, indent=2)

    # ── 검증 테이블 출력 ──
    print(f"\n{'='*70}")
    print(f"  샘플 {len(selected)}건 추출 결과")
    print(f"{'='*70}")
    print(f"{'#':>2} | {'itemId':<18} | {'itemName (앞30자)':<32} | {'qty':>3} | {'unitPrice':>10} | 구분")
    print(f"{'-'*2}-+-{'-'*18}-+-{'-'*32}-+-{'-'*3}-+-{'-'*10}-+-{'-'*14}")

    ma_items = {}  # 이동평균 추적
    for i, r in enumerate(selected, 1):
        iid = r["itemId"]
        name = r["itemName"][:30]
        qty = r["qty"]
        price = r["buyUnitPrice"]
        group = r["_group"]
        label = "기존" if group == "existing" else "신규"

        # 이동평균 추적
        if iid not in ma_items:
            ma_items[iid] = {"qty": 0, "value": 0}
        if qty > 0 and price > 0:
            old = ma_items[iid]
            new_qty = old["qty"] + qty
            new_val = old["value"] + qty * price
            ma_items[iid] = {"qty": new_qty, "value": new_val}

        # item-a52fed58 이동평균 마커
        marker = ""
        if iid == "item-a52fed58":
            count = sum(1 for x in selected[:i] if x["itemId"] == iid)
            marker = f" (이동평균#{count})"

        print(f"{i:>2} | {iid:<18} | {name:<32} | {qty:>3} | {price:>10,} | {label}{marker}")

    # ── 이동평균 검산 ──
    print(f"\n{'='*70}")
    print(f"  이동평균 수기검산 (Math.round 반올림)")
    print(f"{'='*70}")
    target_id = "item-a52fed58"
    recs = [r for r in selected if r["itemId"] == target_id]
    cum_qty, cum_value = 0, 0
    for r in recs:
        q, p = r["qty"], r["buyUnitPrice"]
        if q > 0:
            cum_value += q * p
            cum_qty += q
            avg = round(cum_value / cum_qty) if cum_qty > 0 else 0
            print(f"  +입고: qty={q}, price={p:,} → 누적 qty={cum_qty}, avg={avg:,}")
    print(f"  [OK] 최종 기대값: qty={cum_qty}, avgPrice={round(cum_value/cum_qty) if cum_qty>0 else 0:,}")

    print(f"\n출력 파일: {OUT}")
    print(f"기존 품목 seed 대상 itemId: {len(EXISTING_ITEM_IDS)}건")
    print(f"신규 품목 (confirm 테스트): {len(NEW_ITEM_IDS)}건")


if __name__ == "__main__":
    main()
