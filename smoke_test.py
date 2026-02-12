"""
smoke_test.py – 전체 AI 엔진 연결 확인

GPT / Gemini / Genspark 각각의 ping()을 호출하여
성공·실패만 출력한다. 키 값은 절대 출력하지 않는다.
"""

import sys

import gpt_client
import gemini_client
import genspark_client


ENGINES = [
    ("GPT",      gpt_client),
    ("Gemini",   gemini_client),
    ("Genspark", genspark_client),
]


def run():
    failed = False

    for name, client in ENGINES:
        try:
            client.ping()
            print(f"[PASS] {name}: 연결 성공")
        except Exception as e:
            print(f"[FAIL] {name}: {e}")
            failed = True

    if failed:
        sys.exit(1)

    print("\n모든 smoke test 통과!")


if __name__ == "__main__":
    run()
