# CLAUDE.md

## Project Overview

**golab** is a sole proprietor management program (1인사업자 관리프로그램) designed for Korean independent business owners. The project is in its initial scaffolding phase with domain directories established but no implementation yet.

## Repository Structure

```
golab/
├── README.md          # 프로젝트 설명
├── CLAUDE.md          # AI 어시스턴트 가이드라인 (이 파일)
├── .gitignore         # Python 표준 gitignore
├── finance/           # 재무 관리 모듈 (회계, 수입/지출)
├── inventory/         # 재고 관리 모듈 (상품, 재고 추적)
├── memo/              # 메모 및 노트 모듈
├── research/          # 리서치 및 분석 모듈
└── sales/             # 매출 관리 모듈 (주문, 고객)
```

Each module directory currently contains a `.gitkeep` placeholder. The architecture follows a domain-driven layout organized by business function.

## Current State

- **Stage:** Project skeleton / early scaffolding
- **Source code:** None yet — directories are placeholders
- **Build system:** Not configured
- **Testing:** Not configured
- **CI/CD:** Not configured
- **Language:** Python
- **Dependencies:** 미설정 (requirements.txt 추가 예정)

## Development Guidelines

### Language

- **Python** 사용
- Python 코드 스타일은 PEP 8 준수

### 코드 규칙 (필수)

- **모든 코드에 한글 주석 필수** — 함수, 클래스, 주요 로직 블록에 반드시 한글로 주석을 작성한다
  - 함수/클래스: docstring을 한글로 작성
  - 복잡한 로직: 인라인 주석을 한글로 작성
  - 모듈 상단: 모듈 설명을 한글 주석으로 작성
- **테스트 코드 작성 권장** — 새로운 기능을 추가할 때 반드시 테스트를 함께 작성한다
  - 테스트 프레임워크: `pytest`
  - 각 모듈 디렉토리 내에 `tests/` 폴더를 만들어 테스트 파일 배치
  - 테스트 파일명: `test_<모듈명>.py`
  - 실행 명령어: `pytest`

### Module Organization

Code should be organized by business domain:
- `finance/` — 수입, 지출, 세금 계산, 재무 보고서
- `inventory/` — 상품 카탈로그, 재고 수준, 재주문 추적
- `memo/` — 메모, 리마인더, 텍스트 저장
- `research/` — 시장 조사, 경쟁사 분석, 참고 자료
- `sales/` — 주문, 송장, 고객 기록, 매출 보고서

### Commit Conventions

Based on existing history, commits use short English descriptions:
- `init business folder structure`
- `Initial commit`

Follow this pattern: concise, lowercase descriptions of what changed.

### Git Workflow

- Primary branch: `main`
- Feature branches: `claude/<description>-<id>` pattern for AI-assisted work
- Remote: GitHub (zombiecola1124/golab)

## Commands

```bash
pytest                    # 전체 테스트 실행
pytest finance/tests/     # 특정 모듈 테스트 실행
pytest --cov              # 커버리지 포함 테스트 실행
```

## 개발 로드맵

### Phase 1: 프로젝트 기반 구축
- [ ] `requirements.txt` 생성 (pytest, 기본 라이브러리)
- [ ] 각 모듈에 `__init__.py` 생성
- [ ] 각 모듈에 `tests/` 디렉토리 구성
- [ ] 공통 유틸리티 모듈 (`utils/`) 생성 — 날짜 처리, 한글 포맷팅, 공통 상수

### Phase 2: memo 모듈 (가장 단순, 첫 번째 구현)
- [ ] 메모 CRUD 기능 (생성/조회/수정/삭제)
- [ ] 메모 데이터 모델 (제목, 내용, 작성일, 태그)
- [ ] 로컬 파일 또는 SQLite 기반 저장
- [ ] 테스트 코드 작성

### Phase 3: inventory 모듈 (재고 관리)
- [ ] 상품 데이터 모델 (상품명, SKU, 수량, 단가)
- [ ] 입/출고 기록 관리
- [ ] 재고 현황 조회 및 저재고 알림
- [ ] 테스트 코드 작성

### Phase 4: sales 모듈 (매출 관리)
- [ ] 주문/거래 데이터 모델
- [ ] 고객 정보 관리
- [ ] 일별/월별 매출 집계
- [ ] inventory 모듈과 연동 (판매 시 재고 차감)
- [ ] 테스트 코드 작성

### Phase 5: finance 모듈 (재무 관리)
- [ ] 수입/지출 기록 모델
- [ ] 부가가치세(VAT) 계산 로직
- [ ] 간편장부 / 복식부기 지원
- [ ] sales 모듈과 연동 (매출 데이터 → 재무 기록)
- [ ] 월별/분기별 재무 보고서 생성
- [ ] 테스트 코드 작성

### Phase 6: research 모듈 (리서치)
- [ ] 시장 조사 데이터 저장/조회
- [ ] 경쟁사 정보 관리
- [ ] 메모/태그 기반 참고자료 정리
- [ ] 테스트 코드 작성

### Phase 7: 통합 및 고도화
- [ ] CLI 인터페이스 구축 (모든 모듈 통합 접근)
- [ ] 모듈 간 데이터 연동 강화
- [ ] 데이터 백업/복원 기능
- [ ] 사업자등록번호 기반 사업자 프로필 관리

## Notes for AI Assistants

- This is a greenfield project — expect to help set up tooling, dependencies, and initial implementations
- The target users are Korean sole proprietors; UI text and business logic should account for Korean business practices (e.g., VAT, 사업자등록번호)
- When adding new modules or files, place them in the appropriate domain directory
- Keep the README.md and this CLAUDE.md updated as the project evolves
