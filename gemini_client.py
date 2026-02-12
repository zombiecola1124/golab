import os
import urllib.request
import urllib.error
import json


def ping():
    """Gemini API에 가장 가벼운 호출(모델 목록 조회)을 수행하여 키 유효성을 확인한다."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise EnvironmentError("GEMINI_API_KEY 환경변수가 설정되어 있지 않습니다.")

    url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            if "models" not in data:
                raise RuntimeError("예상하지 못한 응답 형식입니다.")
            return True
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Gemini API 호출 실패 (HTTP {e.code})") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Gemini API 연결 실패: {e.reason}") from e
