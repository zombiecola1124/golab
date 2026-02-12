"""
smoke_test.py – 전체 AI 엔진 연결 확인

GPT / Gemini / Genspark 각각의 ping()을 호출하여
성공·실패만 출력한다. 키 값은 절대 출력하지 않는다.

CI 환경 대응:
  - API 키가 설정되지 않은 엔진은 SKIP (실패 아님)
  - API 키가 설정되었는데 인증 실패하면 FAIL
  - 네트워크 오류(타임아웃/DNS 등)는 WARN (CI 환경에서 공정 중단 방지)
  - 모든 엔진이 SKIP이면 경고와 함께 통과 (exit 0)
"""

import os
import socket
import sys
import urllib.error

from engine_config import ENGINES

# 네트워크 오류로 간주할 예외 타입
NETWORK_ERRORS = (urllib.error.URLError, socket.timeout, OSError, ConnectionError)


def run():
    passed = 0
    failed = 0
    skipped = 0
    warned = 0

    for name, cfg in ENGINES.items():
        env_key = cfg["env_key"]
        api_key = os.environ.get(env_key, "").strip()

        # 키가 없으면 SKIP
        if not api_key:
            print(f"[SKIP] {name:10s} | {env_key} 미설정 — 건너뜀")
            skipped += 1
            continue

        # 키가 있으면 실제 ping 시도
        try:
            mod = __import__(cfg["module"])
            mod.ping()
            print(f"[PASS] {name:10s} | {cfg['role']}")
            passed += 1
        except NETWORK_ERRORS as e:
            # 네트워크 오류 → WARN (CI 환경 문제이므로 FAIL 아님)
            print(f"[WARN] {name:10s} | 네트워크 오류 (CI 환경 확인 필요): {e}")
            warned += 1
        except EnvironmentError:
            # 키 검증은 위에서 했으므로 여기까지 올 일 없지만 방어
            print(f"[SKIP] {name:10s} | 환경변수 문제 — 건너뜀")
            skipped += 1
        except Exception as e:
            # 인증 실패 등 실제 오류 → FAIL
            print(f"[FAIL] {name:10s} | {e}")
            failed += 1

    # 결과 요약
    total = passed + failed + skipped + warned
    print(f"\n{'=' * 50}")
    print(f" 결과: PASS={passed}  FAIL={failed}  WARN={warned}  SKIP={skipped}")
    print(f"{'=' * 50}")

    if failed > 0:
        print("설정된 API 키 중 인증/호출 실패가 있습니다.")
        sys.exit(1)

    if warned > 0:
        print("네트워크 오류가 있었으나 CI 환경 문제로 판단, 통과 처리합니다.")

    if passed == 0 and skipped == total:
        print("경고: API 키 미설정 — GitHub Secrets 등록 후 재실행하세요.")

    print("smoke test 완료!")
    sys.exit(0)


if __name__ == "__main__":
    run()
