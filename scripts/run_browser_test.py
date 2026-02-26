"""
GoLab v1.6.1 — 브라우저 자동 테스트 (Playwright headless)
test_sample_import.html을 headless Chromium으로 실행하고 결과 캡처
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright
import time

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("=== GoLab v1.6.1 브라우저 자동 테스트 ===\n")
        print("Loading test page...")
        page.goto("http://localhost:8080/test_sample_import.html")

        # 테스트 완료 대기 (최대 10초)
        page.wait_for_selector("#log", timeout=10000)
        time.sleep(2)  # JS 비동기 완료 대기

        # 결과 텍스트 추출
        result = page.inner_text("#log")
        print(result)

        # 스크린샷
        page.screenshot(path="test_result.png", full_page=True)
        print("\n[Screenshot saved: test_result.png]")

        # localStorage 데이터 검증
        print("\n=== localStorage 검증 ===")

        trade_count = page.evaluate("JSON.parse(localStorage.getItem('golab_trade_v1')||'[]').length")
        print(f"golab_trade_v1: {trade_count}건")

        inv_data = page.evaluate("JSON.parse(localStorage.getItem('golab_inventory_v01')||'[]')")
        print(f"golab_inventory_v01: {len(inv_data)}건")

        # item-a52fed58 검증
        target = next((x for x in inv_data if x.get("id") == "item-a52fed58"), None)
        if target:
            print(f"\nitem-a52fed58:")
            print(f"  qty = {target['qty']}")
            print(f"  buyPrice = {target['buyPrice']}")
            print(f"  PASS = {target['buyPrice'] == 412000 and target['qty'] == 2}")

        # 재실행 중복 테스트
        imported_ids = page.evaluate("JSON.parse(localStorage.getItem('golab_trade_imported_ids')||'[]').length")
        print(f"\nimported_ids 해시: {imported_ids}개")

        # audit 확인
        audit = page.evaluate("JSON.parse(localStorage.getItem('golab_trade_audit')||'[]')")
        print(f"\naudit 이벤트: {len(audit)}개")
        for a in audit:
            print(f"  {a['event']} @ {a['ts'][:19]}")
            if a.get('detail'):
                print(f"    detail: {a['detail']}")

        # raw log 확인
        raw = page.evaluate("JSON.parse(localStorage.getItem('golab_trade_import_raw_log')||'[]').length")
        print(f"\nIMPORT_RAW_KEY: {raw}건")

        # 음수 재고 체크
        neg = [x for x in inv_data if x.get("qty", 0) < 0]
        print(f"음수 재고: {len(neg)}건")

        browser.close()
        print("\n=== 테스트 완료 ===")


if __name__ == "__main__":
    main()
