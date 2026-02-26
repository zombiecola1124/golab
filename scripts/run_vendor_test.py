"""
GoLab v1.6.1 — Vendor Drawer SSoT 9-Test (Playwright headless)
test_vendor_drawer.html을 headless Chromium으로 실행하고 결과 캡처
"""
import sys
import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright
import time
import urllib.request


def check_server(url="http://localhost:8080", timeout=3):
    """HTTP 서버 200 OK 체크"""
    try:
        req = urllib.request.urlopen(url, timeout=timeout)
        return req.status == 200
    except Exception as e:
        return False


def main():
    print("=== GoLab v1.6.1 Vendor Drawer SSoT 9-Test ===\n")

    # Step 0: 서버 200 OK 체크
    print("[Pre-check] http://localhost:8080 서버 상태 확인...")
    if not check_server():
        print("[FAIL] 서버 미응답 — 테스트 중단")
        print("  해결: cd web && python -m http.server 8080")
        sys.exit(1)
    print("[OK] 서버 응답 확인\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Loading test_vendor_drawer.html...")
        page.goto("http://localhost:8080/test_vendor_drawer.html")
        page.wait_for_selector("#log", timeout=10000)

        # async 테스트(fetch) 완료 대기
        time.sleep(3)

        # 결과 텍스트 추출
        result = page.inner_text("#log")
        print(result)

        # 스크린샷
        page.screenshot(path="test_vendor_result.png", full_page=True)
        print("\n[Screenshot: test_vendor_result.png]")

        # PASS/FAIL 판정
        if "[FAIL]" in result:
            print("\n!!! FAIL 발견 — 즉시 중단 !!!")
            browser.close()
            sys.exit(1)

        if "ALL 9 TESTS PASSED" in result:
            print("\n>>> 9개 전부 PASS — 완료 <<<")
        else:
            print("\n[WARN] 결과 파싱 불확실 — 수동 확인 필요")

        browser.close()
        print("\n=== Vendor Drawer SSoT 테스트 완료 ===")


if __name__ == "__main__":
    main()
