"""
engine_config.py – 멀티 AI 엔진 역할 정의

각 엔진의 담당 역할과 사용할 클라이언트 모듈을 선언한다.
orchestrator.py 에서 이 설정을 읽어 워크플로우를 실행한다.
"""

ENGINES = {
    "gpt": {
        "module": "gpt_client",
        "role": "전략 기획 · 코드 리뷰",
        "description": (
            "GPT는 프로젝트의 핵심 로직 설계, 아키텍처 리뷰, "
            "코드 품질 검증을 담당한다."
        ),
        "env_key": "OPENAI_API_KEY",
    },
    "gemini": {
        "module": "gemini_client",
        "role": "대규모 데이터 분석",
        "description": (
            "Gemini는 대량 데이터 처리, 패턴 분석, "
            "인사이트 도출을 담당한다."
        ),
        "env_key": "GEMINI_API_KEY",
    },
    "genspark": {
        "module": "genspark_client",
        "role": "최신 시장 트렌드 조사 · 경쟁사 분석",
        "description": (
            "Genspark(Autopilot)는 실시간 웹 검색을 기반으로 "
            "시장 동향과 경쟁사 정보를 수집·분석한다."
        ),
        "env_key": "GENSPARK_API_KEY",
    },
}
