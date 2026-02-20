"""
고랩 납품실적.xlsx -> trade.html v1 JSON 변환 스크립트

데이터 모델: 구매 원장 (Purchase Ledger) v1
- 판매가/소비자가 제거, 구매 원가 중심
- 정규화: trim, partNo uppercase, 숫자 콤마 제거, 날짜 통일
- 빈 문자열 허용 (null 대신)

사용법:
  python convert_trade_excel.py

출력:
  golab/web/trade_import.json
"""
import openpyxl
import json
import uuid
import hashlib
from datetime import datetime

import sys

INPUT = r"D:\GOLAB\golab\SALES\고랩 납품실적.xlsx"
OUTPUT = r"D:\GOLAB\golab\web\trade_import.json"
OUTPUT_TEST = r"D:\GOLAB\golab\web\trade_import_test.json"
TEST_MODE = "--test" in sys.argv
TEST_COUNT = 15


def norm_str(v):
    """문자열 정규화: None -> '', strip"""
    if v is None:
        return ""
    return str(v).strip()


def norm_upper(v):
    """품번 정규화: uppercase + trim"""
    return norm_str(v).upper()


def norm_num(v):
    """숫자 정규화: 콤마/원화 기호 제거, 실패 시 0"""
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return v if v == v else 0  # NaN check
    cleaned = str(v).replace(",", "").replace("\u20a9", "").replace(" ", "").strip()
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return 0


def norm_date(v):
    """날짜 정규화: datetime/Excel serial/문자열 -> YYYY-MM-DD
    Handles: datetime objects, Excel serial numbers, YYYY.MM.DD, YYYY/MM/DD, YYYY-MM-DD
    """
    import re
    from datetime import timedelta

    if v is None:
        return ""
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, (int, float)):
        # Excel serial date (days since 1899-12-30, Excel's epoch with leap year bug)
        try:
            d = datetime(1899, 12, 30) + timedelta(days=int(v))
            return d.strftime("%Y-%m-%d")
        except Exception:
            return ""
    s = str(v).strip()
    # Handle YYYY.MM.DD and YYYY/MM/DD
    m = re.match(r'^(\d{4})[./](\d{1,2})[./](\d{1,2})', s)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    if len(s) >= 10:
        return s[:10]
    return s


def deterministic_item_id(vendor, part_no, item_name):
    """결정적 itemId: vendor+partNo+itemName 해시 -> 같은 품목 = 같은 ID"""
    src = "|".join([norm_str(vendor).lower(), norm_upper(part_no).lower(), norm_str(item_name).lower()])
    # djb2 hash (JS 구현과 동일)
    h = 5381
    for ch in src:
        h = ((h << 5) + h) + ord(ch)
        h &= 0xFFFFFFFF  # 32-bit unsigned
    return f"item-{h:08x}"


wb = openpyxl.load_workbook(INPUT, read_only=True, data_only=True)
ws = wb["구매"]

# Col layout (row 1 = header):
#   0: 날짜       -> purchaseDate
#   1: 업체명     -> vendor (이건 판매 대상. 구매처는 col13)
#   2: 품번       -> partNo
#   3: 상품명     -> itemName
#   4: 수량       -> qty
#   5: UP 판매가  -> (v1에서 제외)
#   6: 판매가     -> (v1에서 제외)
#   7: 10%소비자가-> (v1에서 제외)
#   8: 소비자가   -> (v1에서 제외)
#   9: 구매가     -> buyUnitPrice
#  10: 총매입     -> (자동계산이므로 검증용만)
#  11: 합계       -> (v1에서 제외)
#  12: 판매처     -> memo에 병합 (향후 sales 모듈용)
#  13: 내구매처   -> vendor (구매 원장에서의 실제 구매처)
#  14: 비고       -> memo
#  15: 출처       -> memo에 병합

records = []
skipped = 0

for row in ws.iter_rows(min_row=2, values_only=True):
    # Skip empty rows
    if all(c is None for c in row[:6]):
        skipped += 1
        continue

    item_name = norm_str(row[3])
    buy_vendor = norm_str(row[13])  # 내구매처 = 실제 구매처
    sell_target = norm_str(row[1])  # 업체명 = 판매 대상

    # Skip if both item and vendor are empty
    if not item_name and not buy_vendor and not sell_target:
        skipped += 1
        continue

    # Build memo: 기존 비고 + 판매처 + 출처 (있으면)
    memo_parts = []
    note = norm_str(row[14])
    if note:
        memo_parts.append(note)
    sell_channel = norm_str(row[12])
    if sell_channel:
        memo_parts.append("판매처:" + sell_channel)
    if sell_target:
        memo_parts.append("납품:" + sell_target)
    source = norm_str(row[15]) if len(row) > 15 else ""
    if source:
        memo_parts.append("출처:" + source)

    rec = {
        "id": str(uuid.uuid4()),
        "purchaseDate": norm_date(row[0]),
        "vendor": buy_vendor,           # 구매처 (내가 산 곳)
        "docNo": "",                     # 엑셀에 없음
        "itemId": deterministic_item_id(buy_vendor, row[2], item_name),
        "partNo": norm_upper(row[2]),    # 품번 (uppercase)
        "itemName": item_name,
        "qty": norm_num(row[4]),
        "unit": "ea",                    # 엑셀에 단위 없음, 기본값
        "buyUnitPrice": norm_num(row[9]),
        "memo": " / ".join(memo_parts) if memo_parts else "",
        "createdAt": datetime.now().isoformat(),
        "updatedAt": datetime.now().isoformat()
    }
    records.append(rec)

wb.close()

# Select output mode
if TEST_MODE:
    # Test mode: first TEST_COUNT records + evenly spaced samples
    test_records = records[:TEST_COUNT]
    out_path = OUTPUT_TEST
    out_data = test_records
    print(f"=== TEST MODE: {TEST_COUNT} records ===")
else:
    out_path = OUTPUT
    out_data = records

# Save JSON
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(out_data, f, ensure_ascii=False, indent=2)

# Verification (ASCII-safe output for Windows terminal)
vendors = set(r["vendor"] for r in out_data if r["vendor"])
total_buy = sum(r["buyUnitPrice"] * r["qty"] for r in out_data)

# Check for duplicate itemIds (same product should share itemId)
item_id_map = {}
for r in out_data:
    key = r["itemId"]
    if key not in item_id_map:
        item_id_map[key] = []
    item_id_map[key].append(r["itemName"])
shared_items = sum(1 for v in item_id_map.values() if len(v) > 1)

print(f"Records: {len(out_data)}")
print(f"Skipped: {skipped}")
print(f"Vendors: {len(vendors)}")
print(f"Unique itemIds: {len(item_id_map)}")
print(f"Shared itemIds (same product, multiple purchases): {shared_items}")
print(f"Total buy amount: {total_buy:,.0f}")
print(f"Output: {out_path}")

# Sample check
if out_data:
    print(f"\nFirst record keys: {list(out_data[0].keys())}")
    print(f"Date range: {out_data[0].get('purchaseDate','')} ~ {out_data[-1].get('purchaseDate','')}")
    print(f"Sample itemId: {out_data[0].get('itemId','')}")
