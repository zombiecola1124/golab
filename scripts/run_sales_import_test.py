"""
GoLab v1.6.1 — Sales Import 자동 테스트 (Playwright headless)
test_sales_import.html 실행: DRY_RUN → COMMIT → Idempotency 검증
"""
import sys
import io
import os
import urllib.request
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

from playwright.sync_api import sync_playwright
import time

# ── 경로 계산 (크로스 플랫폼) ──
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
WEB_DIR = os.path.join(BASE_DIR, "web")


def check_server(url="http://localhost:8080", timeout=3):
    """HTTP 서버 200 OK 체크"""
    try:
        req = urllib.request.urlopen(url, timeout=timeout)
        return req.status == 200
    except Exception:
        return False


def main():
    print("=== GoLab v1.6.1 Sales Import Auto Test ===\n")

    # WEB_DIR 존재 확인
    if not os.path.isdir(WEB_DIR):
        print(f"[FATAL] web 디렉토리 없음: {WEB_DIR}")
        sys.exit(1)

    # 서버 200 OK 체크
    print("[Pre-check] http://localhost:8080 서버 상태 확인...")
    if not check_server():
        print("[FAIL] 서버 미응답 — 테스트 중단")
        print(f"  해결: cd \"{WEB_DIR}\" && python -m http.server 8080")
        sys.exit(1)
    print("[OK] 서버 응답 확인\n")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        print("Loading test_sales_import.html...")
        page.goto("http://localhost:8080/test_sales_import.html")
        page.wait_for_selector("#log", timeout=10000)

        # async fetch 완료 대기
        time.sleep(4)

        # 결과 텍스트 추출
        result = page.inner_text("#log")
        print(result)

        # 스크린샷
        page.screenshot(path="test_sales_import_result.png", full_page=True)
        print("\n[Screenshot: test_sales_import_result.png]")

        # PASS/FAIL 판정
        if "[FAIL]" in result:
            print("\n!!! FAIL 발견 — 즉시 중단 !!!")
            browser.close()
            sys.exit(1)

        if "ALL TESTS PASSED" in result:
            print("\n>>> Sales Import 테스트 전부 PASS — 완료 <<<")
        else:
            print("\n[WARN] 결과 파싱 불확실 — 수동 확인 필요")

        browser.close()
        print("\n=== Sales Import 테스트 완료 ===")


if __name__ == "__main__":
    main()
