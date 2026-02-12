"""
genspark_client.py – Genspark (최신 시장 트렌드 조사 · 경쟁사 분석) 클라이언트

현재 Genspark 공식 개발자 API가 공개되지 않은 상태이므로,
GENSPARK_API_KEY 환경변수 존재 여부만 확인하는 placeholder 구현이다.
실제 API 엔드포인트가 확정되면 ping() / search() 를 교체한다.
"""

import os

# TODO: 공식 API 엔드포인트가 공개되면 아래 값을 교체
API_BASE = os.environ.get("GENSPARK_API_BASE", "https://api.genspark.ai")


def ping():
    """GENSPARK_API_KEY 환경변수가 설정되어 있는지만 확인한다."""
    api_key = os.environ.get("GENSPARK_API_KEY")
    if not api_key:
        raise EnvironmentError("GENSPARK_API_KEY 환경변수가 설정되어 있지 않습니다.")
    return True


def search(query: str) -> dict:
    """시장 트렌드 / 경쟁사 분석 검색 (placeholder).

    향후 Genspark Autopilot API가 공개되면 실제 호출로 교체한다.
    현재는 키 유효성만 확인하고 빈 결과를 반환한다.
    """
    ping()  # 키 확인
    return {
        "query": query,
        "results": [],
        "status": "placeholder – API 엔드포인트 미확정",
    }
