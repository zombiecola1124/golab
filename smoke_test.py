import sys

import gpt_client
import gemini_client


def run():
    failed = False

    # --- GPT smoke test ---
    try:
        gpt_client.ping()
        print("[PASS] GPT: 연결 성공")
    except Exception as e:
        print(f"[FAIL] GPT: {e}")
        failed = True

    # --- Gemini smoke test ---
    try:
        gemini_client.ping()
        print("[PASS] Gemini: 연결 성공")
    except Exception as e:
        print(f"[FAIL] Gemini: {e}")
        failed = True

    if failed:
        sys.exit(1)

    print("\n모든 smoke test 통과!")


if __name__ == "__main__":
    run()
