"""
orchestrator.py – 멀티 엔진 오케스트레이터

워크플로우:
  1. 모든 엔진 상태 확인 (smoke)
  2. Genspark로 시장 트렌드 / 경쟁사 데이터 수집
  3. 수집 결과를 research/genspark_report.json 에 저장
  4. GPT · Gemini 가 해당 리포트를 참조하여 후속 작업 수행 (placeholder)

사용법:
  python orchestrator.py                     # 전체 파이프라인
  python orchestrator.py --smoke-only        # 연결 확인만
"""

import importlib
import json
import os
import sys

from engine_config import ENGINES

REPORT_DIR = os.path.join(os.path.dirname(__file__), "research")
REPORT_PATH = os.path.join(REPORT_DIR, "genspark_report.json")


# ── 1. 엔진 상태 확인 ──────────────────────────────────────────
def check_engines() -> dict:
    """등록된 모든 엔진의 ping 결과를 반환한다."""
    results = {}
    for name, cfg in ENGINES.items():
        mod = importlib.import_module(cfg["module"])
        try:
            mod.ping()
            results[name] = {"ok": True, "role": cfg["role"]}
        except Exception as e:
            results[name] = {"ok": False, "role": cfg["role"], "error": str(e)}
    return results


# ── 2. Genspark 트렌드 수집 → 리포트 저장 ──────────────────────
def collect_trends(queries: list[str]) -> dict:
    """Genspark 를 통해 시장 트렌드를 수집하고 리포트 파일에 저장한다."""
    import genspark_client

    report = {"queries": {}}
    for q in queries:
        report["queries"][q] = genspark_client.search(q)

    os.makedirs(REPORT_DIR, exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    return report


# ── 3. 리포트 읽기 (GPT/Gemini 후속 작업용) ────────────────────
def load_report() -> dict:
    """저장된 Genspark 리포트를 읽어 반환한다."""
    if not os.path.exists(REPORT_PATH):
        return {}
    with open(REPORT_PATH, encoding="utf-8") as f:
        return json.load(f)


# ── CLI ─────────────────────────────────────────────────────────
def main():
    smoke_only = "--smoke-only" in sys.argv

    # 1) 상태 확인
    print("=" * 50)
    print(" 멀티 엔진 상태 확인")
    print("=" * 50)
    results = check_engines()
    all_ok = True
    for name, r in results.items():
        tag = "[PASS]" if r["ok"] else "[FAIL]"
        line = f"  {tag} {name:10s} | {r['role']}"
        if not r["ok"]:
            line += f"  ← {r['error']}"
            all_ok = False
        print(line)

    if smoke_only:
        sys.exit(0 if all_ok else 1)

    if not all_ok:
        print("\n일부 엔진 연결 실패 — 파이프라인을 중단합니다.")
        sys.exit(1)

    # 2) Genspark 트렌드 수집
    print("\n" + "=" * 50)
    print(" Genspark 시장 트렌드 수집")
    print("=" * 50)
    default_queries = [
        "1인사업자 관리 SaaS 시장 트렌드",
        "경쟁사 분석: 자영업 관리 소프트웨어",
    ]
    report = collect_trends(default_queries)
    print(f"  리포트 저장: {REPORT_PATH}")
    print(f"  수집 쿼리 수: {len(report['queries'])}")

    # 3) 후속 작업 안내
    print("\n" + "=" * 50)
    print(" 후속 파이프라인 (TODO)")
    print("=" * 50)
    print("  → GPT : 리포트 기반 핵심 로직 설계")
    print("  → Gemini : 리포트 데이터 심층 분석")
    print("\n파이프라인 완료.")


if __name__ == "__main__":
    main()
