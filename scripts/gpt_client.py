import os
import socket
import urllib.request
import urllib.error
import json


def ping():
    """GPT API에 가장 가벼운 호출(모델 목록 조회)을 수행하여 키 유효성을 확인한다."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise EnvironmentError("OPENAI_API_KEY 환경변수가 설정되어 있지 않습니다.")

    req = urllib.request.Request(
        "https://api.openai.com/v1/models",
        headers={"Authorization": f"Bearer {api_key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            if "data" not in data:
                raise RuntimeError("예상하지 못한 응답 형식입니다.")
            return True
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"OpenAI API 호출 실패 (HTTP {e.code})") from e
    except (urllib.error.URLError, socket.timeout, OSError) as e:
        raise RuntimeError(f"OpenAI API 네트워크 오류 (CI 환경 확인 필요): {e}") from e
