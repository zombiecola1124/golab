import os
import pytest


# GitHub Secrets에 키가 등록 안 된 CI 환경에서는 자동 SKIP
_has_key = bool(os.environ.get("OPENAI_API_KEY", "").strip())
skipif_no_key = pytest.mark.skipif(
    not _has_key,
    reason="OPENAI_API_KEY 미설정 — GitHub Secrets 등록 후 재실행",
)


@skipif_no_key
def test_openai_api_key_is_set():
    """OPENAI_API_KEY 환경변수가 설정되어 있는지 확인"""
    api_key = os.environ.get("OPENAI_API_KEY")
    assert api_key is not None, "OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다."


@skipif_no_key
def test_openai_api_key_is_not_empty():
    """OPENAI_API_KEY 환경변수가 빈 문자열이 아닌지 확인"""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    assert api_key.strip() != "", "OPENAI_API_KEY 환경변수가 비어 있습니다."


@skipif_no_key
def test_openai_api_key_format():
    """OPENAI_API_KEY가 'sk-'로 시작하는 올바른 형식인지 확인"""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    assert api_key.startswith("sk-"), (
        f"OPENAI_API_KEY가 'sk-'로 시작하지 않습니다. (현재 prefix: '{api_key[:3]}...')"
    )
