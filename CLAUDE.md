# CLAUDE.md

## Project Overview

**golab** is a sole proprietor management program (1인사업자 관리프로그램) designed for Korean independent business owners. The project is in its initial scaffolding phase with domain directories established but no implementation yet.

## Repository Structure

```
golab/
├── README.md          # Project description
├── CLAUDE.md          # This file - AI assistant guidelines
├── finance/           # Financial management module (accounting, expenses, income)
├── inventory/         # Inventory and product tracking module
├── memo/              # Notes and memo storage module
├── research/          # Research and analysis materials module
└── sales/             # Sales management and tracking module
```

Each module directory currently contains a `.gitkeep` placeholder. The architecture follows a domain-driven layout organized by business function.

## Current State

- **Stage:** Project skeleton / early scaffolding
- **Source code:** None yet — directories are placeholders
- **Build system:** Not configured
- **Testing:** Not configured
- **CI/CD:** Not configured
- **Dependencies:** None declared (no go.mod, package.json, etc.)

## Development Guidelines

### Language

The project name suggests Go ("golab"), but no language has been committed to yet. When implementation begins, follow the conventions of whichever language is chosen.

### Module Organization

Code should be organized by business domain:
- `finance/` — Income, expenses, tax calculations, financial reports
- `inventory/` — Product catalog, stock levels, reorder tracking
- `memo/` — Notes, reminders, general-purpose text storage
- `research/` — Market research, competitor analysis, reference data
- `sales/` — Orders, invoices, customer records, sales reports

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

No build, test, or lint commands are available yet. This section should be updated as tooling is added.

## Notes for AI Assistants

- This is a greenfield project — expect to help set up tooling, dependencies, and initial implementations
- The target users are Korean sole proprietors; UI text and business logic should account for Korean business practices (e.g., VAT, 사업자등록번호)
- When adding new modules or files, place them in the appropriate domain directory
- Keep the README.md and this CLAUDE.md updated as the project evolves
