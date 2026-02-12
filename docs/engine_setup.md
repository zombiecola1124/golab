# 엔진 설정 가이드

> API 키 관리 및 환경 설정 원칙

---

## 1. API 키 관리 원칙

**절대 규칙: API 키를 소스 코드에 직접 작성하지 않는다.**

| 환경 | 키 저장 방식 |
|------|-------------|
| 로컬 개발 | `.env` 파일 |
| GitHub Actions (CI/CD) | GitHub Secrets |
| 배포 서버 | 환경변수 또는 시크릿 매니저 |

---

## 2. 로컬 환경: .env 파일

### 설정 방법

프로젝트 루트에 `.env` 파일을 생성한다:

```bash
# .env (이 파일은 절대 커밋하지 않는다)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
GEMINI_API_KEY=AIzaXXXXXXXXXXXXXXXXXXXXXXX
GENSPARK_API_KEY=gsk-xxxxxxxxxxxxxxxxxxxxxxxx
```

### 코드에서 사용

```python
import os
from dotenv import load_dotenv

load_dotenv()  # .env 파일 로드

api_key = os.getenv("OPENAI_API_KEY")
```

### 보안 체크리스트
- [x] `.env`가 `.gitignore`에 등록되어 있는가?
- [x] `.env.example`로 필요한 변수 목록만 공유하는가?
- [x] 코드에 API 키가 하드코딩되어 있지 않은가?

---

## 3. GitHub Actions: Secrets

### 설정 방법

1. GitHub 저장소 → Settings → Secrets and variables → Actions
2. "New repository secret" 클릭
3. 아래 키를 등록:

| Secret Name | 설명 |
|-------------|------|
| `OPENAI_API_KEY` | OpenAI GPT API 키 |
| `GEMINI_API_KEY` | Google Gemini API 키 |
| `GENSPARK_API_KEY` | Genspark API 키 |

### 워크플로우에서 사용 (`.github/workflows/smoke.yml`)

```yaml
env:
  OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
  GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
  GENSPARK_API_KEY: ${{ secrets.GENSPARK_API_KEY }}
```

---

## 4. 엔진별 설정 상세

### 4.1 OpenAI GPT

| 항목 | 값 |
|------|---|
| 역할 | 전략 기획, 코드 리뷰 |
| 환경변수 | `OPENAI_API_KEY` |
| 클라이언트 | `gpt_client.py` |
| API 문서 | https://platform.openai.com/docs |

### 4.2 Google Gemini

| 항목 | 값 |
|------|---|
| 역할 | 대규모 데이터 분석 |
| 환경변수 | `GEMINI_API_KEY` |
| 클라이언트 | `gemini_client.py` |
| API 문서 | https://ai.google.dev/docs |

### 4.3 Genspark

| 항목 | 값 |
|------|---|
| 역할 | 시장 트렌드 조사, 경쟁사 분석 |
| 환경변수 | `GENSPARK_API_KEY` |
| 클라이언트 | `genspark_client.py` |

---

## 5. .env.example

다른 세션/협업자가 어떤 환경변수가 필요한지 파악할 수 있도록 `.env.example` 파일을 유지한다:

```bash
# .env.example — 필요한 환경변수 목록 (값은 비워둠)
OPENAI_API_KEY=
GEMINI_API_KEY=
GENSPARK_API_KEY=
```

---

## 6. 비용 관리

- 각 엔진 API 호출 전 사장 승인 필요 (Kill Switch 연동)
- 월 예산 한도를 초과하면 자동으로 API 호출 차단
- `engine_config.py`의 `ENGINES` 딕셔너리에서 엔진을 비활성화할 수 있음
