import os
import pytest


def test_openai_api_key_is_set():
    """OPENAI_API_KEY 환경변수가 설정되어 있는지 확인"""
    api_key = os.environ.get("OPENAI_API_KEY")
    assert api_key is not None, "OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다."


def test_openai_api_key_is_not_empty():
    """OPENAI_API_KEY 환경변수가 빈 문자열이 아닌지 확인"""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    assert api_key.strip() != "", "OPENAI_API_KEY 환경변수가 비어 있습니다."


def test_openai_api_key_format():
    """OPENAI_API_KEY가 'sk-'로 시작하는 올바른 형식인지 확인"""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    assert api_key.startswith("sk-"), (
        f"OPENAI_API_KEY가 'sk-'로 시작하지 않습니다. (현재 prefix: '{api_key[:3]}...')"
    )
