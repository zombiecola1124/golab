"""
GoLab v1.6.1 — Phase 3 전체 581건 Import 자동 테스트
4단계 순차 실행: DRY_RUN → COMMIT 1차(50건) → COMMIT 2차(나머지) → 재실행 체크
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright
import time
import json


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("=== Phase 3: 전체 581건 Import 자동 테스트 ===\n")
        page.goto("http://localhost:8080/test_full_import.html")
        page.wait_for_selector("#log", timeout=10000)
        time.sleep(1)

        # Step 1: DRY_RUN
        print("[Step 1] FULL DRY_RUN 실행...")
        page.click("#btnDry")
        time.sleep(5)  # 581건 처리 대기

        log_text = page.inner_text("#log")
        print(log_text)

        # DRY_RUN 결과 확인
        if "[FAIL]" in log_text and "No-Go" in log_text:
            print("\n!!! DRY_RUN FAILED — COMMIT 중단 !!!")
            browser.close()
            return

        # Step 2: COMMIT 1차 (50건)
        print("\n" + "="*56)
        print("[Step 2] COMMIT 1차 (50건) 실행...")
        print("="*56)
        page.click("#btnC1")
        time.sleep(3)

        log_text = page.inner_text("#log")
        # 마지막 섹션만 출력
        parts = log_text.split("COMMIT 1차")
        if len(parts) > 1:
            print("COMMIT 1차" + parts[-1].split("COMMIT 2차")[0] if "COMMIT 2차" in parts[-1] else "COMMIT 1차" + parts[-1])

        # Step 3: COMMIT 2차 (나머지)
        print("\n" + "="*56)
        print("[Step 3] COMMIT 2차 (나머지 531건) 실행...")
        print("="*56)
        page.click("#btnC2")
        time.sleep(8)  # 531건 처리 대기

        log_text = page.inner_text("#log")
        parts = log_text.split("COMMIT 2차")
        if len(parts) > 1:
            remaining = parts[-1].split("재실행")[0] if "재실행" in parts[-1] else parts[-1]
            print("COMMIT 2차" + remaining)

        # Step 4: 재실행 중복 체크
        print("\n" + "="*56)
        print("[Step 4] 재실행 Idempotency 체크...")
        print("="*56)
        page.click("#btnRe")
        time.sleep(2)

        log_text = page.inner_text("#log")
        parts = log_text.split("재실행")
        if len(parts) > 1:
            print("재실행" + parts[-1])

        # === 최종 데이터 검증 ===
        print("\n" + "="*56)
        print("=== localStorage 최종 검증 ===")
        print("="*56)

        trade_count = page.evaluate("JSON.parse(localStorage.getItem('golab_trade_v1')||'[]').length")
        inv_data = page.evaluate("JSON.parse(localStorage.getItem('golab_inventory_v01')||'[]')")
        hist_count = page.evaluate("JSON.parse(localStorage.getItem('golab_inventory_inbound_history_v01')||'[]').length")
        raw_count = page.evaluate("JSON.parse(localStorage.getItem('golab_trade_import_raw_log')||'[]').length")
        ids_count = page.evaluate("JSON.parse(localStorage.getItem('golab_trade_imported_ids')||'[]').length")

        print(f"golab_trade_v1: {trade_count}건")
        print(f"golab_inventory_v01: {len(inv_data)}건")
        print(f"inbound history: {hist_count}건")
        print(f"IMPORT_RAW_KEY: {raw_count}건")
        print(f"IMPORTED_IDS_KEY: {ids_count}개 해시")

        # 음수 재고
        neg = [x for x in inv_data if x.get("qty", 0) < 0]
        print(f"음수 재고: {len(neg)}건")

        # NaN 체크
        nan_items = [x for x in inv_data if not isinstance(x.get("buyPrice"), (int, float)) or x.get("buyPrice") != x.get("buyPrice")]
        print(f"NaN 단가: {len(nan_items)}건")

        # item-a52fed58
        target = next((x for x in inv_data if x.get("id") == "item-a52fed58"), None)
        if target:
            print(f"\nitem-a52fed58:")
            print(f"  qty = {target['qty']}")
            print(f"  buyPrice = {target['buyPrice']}")

        # audit
        audit = page.evaluate("JSON.parse(localStorage.getItem('golab_trade_audit')||'[]')")
        print(f"\naudit 이벤트: {len(audit)}개")
        for a in audit:
            print(f"  {a['event']} @ {a['ts'][:19]}")
            if a.get('detail'):
                d = a['detail']
                summary = {k: v for k, v in d.items() if k in ['total','valid','tradeAdded','dupSkip','invExisting','invNewCreated','invSkipQty0','nanDetected','batch','totalTradeAfter']}
                print(f"    {summary}")

        # 스크린샷
        page.screenshot(path="test_full_import_result.png", full_page=True)
        print("\n[Screenshot: test_full_import_result.png]")

        browser.close()
        print("\n=== Phase 3 테스트 완료 ===")


if __name__ == "__main__":
    main()
