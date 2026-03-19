/**
 * Realistic vault fixture with 50+ notes of varying sizes and structures.
 * Used by integration tests to simulate a real Obsidian vault.
 */
import { InMemoryVaultAdapter, type VaultNote } from "../../src/vault-adapter";

const DAY = 86_400_000;
const NOW = Date.now();

function daysAgo(n: number): number {
  return NOW - n * DAY;
}

// ── note templates ──────────────────────────────────────────────────

const PROJECT_NOTES: VaultNote[] = [
  {
    path: "Projects/webapp-redesign.md",
    mtime: daysAgo(0),
    content: `# Web App Redesign

## Overview
Complete redesign of the customer-facing web application. Moving from legacy jQuery to React with TypeScript.

## Goals
- Improve load time by 60%
- Modernize component architecture
- Add accessibility (WCAG 2.1 AA)
- Mobile-first responsive design

## Timeline
- Phase 1: Component library (Q1)
- Phase 2: Core pages migration (Q2)
- Phase 3: Advanced features (Q3)

## Tech Stack
- React 19, TypeScript 5.x
- Tailwind CSS, Radix UI
- Vite build system
- Vitest for testing

## Links
- [[Projects/component-library]] - shared component library
- [[Projects/api-v2]] - backend API changes
- [[Meeting Notes/2026-03-15-design-review]] - latest design review

## TODO
- [ ] Finalize color palette with design team
- [ ] Set up CI/CD pipeline for preview deploys
- [ ] Migrate authentication flow
`,
  },
  {
    path: "Projects/component-library.md",
    mtime: daysAgo(1),
    content: `# Component Library

Shared component library for the web app redesign project.

## Components
| Component | Status | Owner |
|-----------|--------|-------|
| Button | Done | Sarah |
| Modal | In Progress | James |
| DataTable | Planned | TBD |
| Sidebar | Done | Sarah |
| Toast | In Progress | Alex |

## Design Tokens
Using CSS custom properties for theming:
- \`--color-primary\`: #3B82F6
- \`--color-secondary\`: #10B981
- \`--spacing-unit\`: 4px

## Links
- [[Projects/webapp-redesign]]
- [[Reference/design-system-principles]]
`,
  },
  {
    path: "Projects/api-v2.md",
    mtime: daysAgo(2),
    content: `# API v2

RESTful API redesign with OpenAPI 3.1 spec.

## Breaking Changes
1. Authentication moved to Bearer tokens (was cookie-based)
2. Pagination uses cursor-based approach
3. Error responses follow RFC 7807

## Endpoints
- \`GET /api/v2/users\` - List users
- \`POST /api/v2/users\` - Create user
- \`GET /api/v2/notes/:id\` - Get note by ID
- \`PUT /api/v2/notes/:id\` - Update note

## Migration Guide
See [[Reference/api-migration-guide]] for client migration steps.

## TODO
- [ ] Rate limiting implementation
- [ ] WebSocket support for real-time sync
`,
  },
  {
    path: "Projects/mobile-app.md",
    mtime: daysAgo(5),
    content: `# Mobile App

Cross-platform mobile app built with React Native.

## Features
- Offline-first architecture with local SQLite
- Push notifications via Firebase
- Biometric authentication
- Sync engine using CRDT

## Architecture
The app uses a layered architecture:
1. **UI Layer**: React Native components
2. **State Layer**: Zustand stores
3. **Data Layer**: SQLite + sync engine
4. **Network Layer**: REST client with retry logic

## Related
- [[Projects/api-v2]] - backend API
- [[Research/offline-sync-strategies]]
`,
  },
  {
    path: "Projects/data-pipeline.md",
    mtime: daysAgo(3),
    content: `# Data Pipeline

ETL pipeline for analytics and reporting.

## Pipeline Stages
1. **Extract**: Pull from PostgreSQL, S3, and third-party APIs
2. **Transform**: dbt models for normalization
3. **Load**: Write to Snowflake warehouse

## Monitoring
- Airflow DAG for orchestration
- PagerDuty alerts on failure
- Grafana dashboards for throughput

## SLA
- Daily refresh by 6:00 AM UTC
- 99.5% uptime target
- Max 2 hours data latency

## TODO
- [ ] Add data quality checks between stages
- [ ] Implement incremental loading for large tables
`,
  },
];

const MEETING_NOTES: VaultNote[] = [
  {
    path: "Meeting Notes/2026-03-15-design-review.md",
    mtime: daysAgo(4),
    content: `# Design Review - March 15, 2026

## Attendees
- Sarah (Design Lead)
- James (Frontend)
- Alex (Product)

## Agenda
1. Review new color palette
2. Component library progress
3. Mobile responsive breakpoints

## Decisions
- **Color palette**: Approved the blue/green scheme. See [[Reference/design-system-principles]].
- **Typography**: Moving to Inter font family.
- **Breakpoints**: sm: 640px, md: 768px, lg: 1024px, xl: 1280px

## Action Items
- [ ] Sarah: Create Figma component specs by Friday
- [ ] James: Prototype the DataTable component
- [x] Alex: Write user story for dashboard page

## Notes
The team agreed that we should prioritize the dashboard and settings pages for the initial launch. Authentication pages will reuse the existing flow with minimal styling updates.

See also: [[Projects/webapp-redesign]]
`,
  },
  {
    path: "Meeting Notes/2026-03-10-sprint-planning.md",
    mtime: daysAgo(9),
    content: `# Sprint Planning - March 10, 2026

## Sprint Goals
1. Complete Button and Sidebar components
2. API v2 authentication endpoint
3. Set up staging environment

## Capacity
- Sarah: 8 points
- James: 10 points
- Alex: 6 points (PTO Friday)

## Stories
| Story | Points | Assignee |
|-------|--------|----------|
| Button component | 3 | Sarah |
| Sidebar component | 5 | Sarah |
| Auth endpoint | 5 | James |
| Token refresh | 3 | James |
| Staging infra | 5 | DevOps |

## Risks
- DevOps team is stretched thin; staging might slip.
- Need design sign-off before starting Modal component.
`,
  },
  {
    path: "Meeting Notes/2026-03-01-kickoff.md",
    mtime: daysAgo(18),
    content: `# Project Kickoff - March 1, 2026

## Vision
Build a modern, accessible web application that delights users.

## Team
- Product: Alex
- Design: Sarah
- Frontend: James, Miguel
- Backend: David, Lin
- DevOps: Jordan

## Milestones
1. **March 31**: Component library v1
2. **April 30**: Core pages live
3. **June 30**: Feature complete
4. **July 15**: Launch

## Agreements
- Two-week sprints
- Daily standups at 9:30 AM
- PR reviews within 24 hours
- All code must have tests
`,
  },
  {
    path: "Meeting Notes/2026-02-25-retro.md",
    mtime: daysAgo(22),
    content: `# Retrospective - February 25, 2026

## What went well
- Fast iteration on prototype
- Good collaboration between design and eng
- Automated tests caught 3 regressions

## What could improve
- Too many meetings fragmenting focus time
- Deployment process is manual and error-prone
- Documentation is lagging behind implementation

## Action Items
- [ ] Reduce meeting load by 20%
- [ ] Automate deployment pipeline
- [x] Schedule documentation sprints
`,
  },
  {
    path: "Meeting Notes/2026-02-15-architecture.md",
    mtime: daysAgo(32),
    content: `# Architecture Discussion - February 15

## Topic: State Management

### Options Considered
1. **Redux Toolkit** - Mature, well-known
2. **Zustand** - Lightweight, simple API
3. **Jotai** - Atomic model, minimal boilerplate

### Decision
Going with **Zustand** for the web app:
- Smaller bundle size (~2KB)
- Less boilerplate than Redux
- Good TypeScript support
- Easy to test

### Concerns
- Need to establish patterns for async state
- Must avoid prop drilling in nested components

See [[Reference/state-management-comparison]] for full analysis.
`,
  },
];

const DAILY_NOTES: VaultNote[] = Array.from({ length: 20 }, (_, i) => ({
  path: `Daily/${new Date(daysAgo(i)).toISOString().slice(0, 10)}.md`,
  mtime: daysAgo(i),
  content: `# Daily Note - ${new Date(daysAgo(i)).toISOString().slice(0, 10)}

## Tasks
- [${i < 3 ? " " : "x"}] Review PRs
- [${i < 5 ? " " : "x"}] Update documentation
- [x] Team standup

## Journal
Today I worked on ${["the component library", "API endpoints", "bug fixes", "documentation", "code review", "testing", "design review", "sprint planning", "deployment", "monitoring"][i]}.

${i < 3 ? "## Notes\n- Need to follow up on [[Projects/webapp-redesign]] timeline\n- Check [[Reference/coding-standards]] for linting rules" : ""}
`,
}));

const REFERENCE_NOTES: VaultNote[] = [
  {
    path: "Reference/design-system-principles.md",
    mtime: daysAgo(15),
    content: `# Design System Principles

## Core Principles
1. **Consistency** - Same patterns across all surfaces
2. **Accessibility** - WCAG 2.1 AA minimum
3. **Performance** - No layout shifts, fast paint
4. **Composability** - Components compose naturally

## Color System
### Primary
- Blue 500: #3B82F6 (interactive elements)
- Blue 600: #2563EB (hover states)
- Blue 700: #1D4ED8 (active states)

### Semantic
- Success: #10B981
- Warning: #F59E0B
- Error: #EF4444
- Info: #3B82F6

## Typography Scale
| Name | Size | Weight | Line Height |
|------|------|--------|-------------|
| h1 | 2.25rem | 700 | 1.2 |
| h2 | 1.875rem | 600 | 1.25 |
| h3 | 1.5rem | 600 | 1.3 |
| body | 1rem | 400 | 1.5 |
| small | 0.875rem | 400 | 1.5 |
`,
  },
  {
    path: "Reference/coding-standards.md",
    mtime: daysAgo(20),
    content: `# Coding Standards

## TypeScript
- Strict mode enabled
- No \`any\` types (use \`unknown\` + type guards)
- Prefer interfaces over types for object shapes
- Use const assertions where possible

## React
- Functional components only
- Custom hooks for shared logic
- Memoize expensive computations with useMemo
- Avoid inline object/array props

## Testing
- Unit tests for all utility functions
- Integration tests for component interactions
- E2E tests for critical user paths
- Minimum 80% code coverage

## Git
- Conventional commits (feat, fix, refactor, test, docs)
- Squash merge to main
- Branch naming: type/description (e.g., feat/add-modal)
`,
  },
  {
    path: "Reference/api-migration-guide.md",
    mtime: daysAgo(10),
    content: `# API v1 → v2 Migration Guide

## Authentication
\`\`\`diff
- Cookie: session=abc123
+ Authorization: Bearer eyJ...
\`\`\`

## Pagination
\`\`\`diff
- GET /api/v1/notes?page=2&per_page=20
+ GET /api/v2/notes?cursor=abc&limit=20
\`\`\`

## Error Handling
v2 errors follow RFC 7807:
\`\`\`json
{
  "type": "https://api.example.com/errors/not-found",
  "title": "Note not found",
  "status": 404,
  "detail": "No note with ID 'xyz' exists"
}
\`\`\`

## Timeline
- v1 deprecated: April 1, 2026
- v1 sunset: July 1, 2026
`,
  },
  {
    path: "Reference/state-management-comparison.md",
    mtime: daysAgo(35),
    content: `# State Management Comparison

## Evaluation Criteria
| Criteria | Redux Toolkit | Zustand | Jotai |
|----------|--------------|---------|-------|
| Bundle Size | 11KB | 2KB | 3KB |
| TypeScript | Excellent | Good | Good |
| Learning Curve | Medium | Low | Low |
| DevTools | Excellent | Good | Fair |
| Server State | RTK Query | Manual | Manual |
| Community | Large | Growing | Growing |

## Recommendation
Zustand for client state, with React Query for server state.
See [[Meeting Notes/2026-02-15-architecture]] for the decision record.
`,
  },
  {
    path: "Reference/security-checklist.md",
    mtime: daysAgo(12),
    content: `# Security Checklist

## Authentication
- [x] JWT token rotation
- [x] Refresh token with secure cookie
- [ ] MFA support
- [x] Password hashing with Argon2

## Authorization
- [x] Role-based access control (RBAC)
- [ ] Attribute-based access control (ABAC)
- [x] API key scoping

## Data Protection
- [x] TLS 1.3 for all connections
- [x] Encryption at rest (AES-256)
- [ ] Field-level encryption for PII
- [x] Secure headers (CSP, HSTS)

## Secrets Management
- api_key should never appear in notes
- Use environment variables for credentials
- Rotate secrets quarterly
`,
  },
];

const RESEARCH_NOTES: VaultNote[] = [
  {
    path: "Research/offline-sync-strategies.md",
    mtime: daysAgo(7),
    content: `# Offline Sync Strategies

## Approaches
### 1. CRDT (Conflict-free Replicated Data Types)
- Automatic conflict resolution
- Eventually consistent
- Higher memory overhead
- Good for collaborative editing

### 2. Operational Transform (OT)
- Requires central server
- Real-time collaboration
- Complex implementation
- Used by Google Docs

### 3. Last-Write-Wins (LWW)
- Simplest approach
- Data loss risk
- Suitable for non-collaborative scenarios

## Recommendation
Use CRDTs for document sync (Automerge or Yjs).
LWW for settings and metadata.

## References
- Automerge: https://automerge.org
- Yjs: https://yjs.dev
- [[Projects/mobile-app]] - primary consumer
`,
  },
  {
    path: "Research/embedding-models-2026.md",
    mtime: daysAgo(8),
    content: `# Embedding Models Comparison (2026)

## Models Evaluated
| Model | Dims | Performance | Cost |
|-------|------|-------------|------|
| text-embedding-3-large | 3072 | Excellent | $0.13/1M |
| text-embedding-3-small | 1536 | Good | $0.02/1M |
| Titan V2 | 1024 | Good | $0.02/1M |
| Local hash | varies | Fair | Free |

## Findings
- text-embedding-3-large best for accuracy
- Local hash adequate for personal vaults (<1000 notes)
- Titan V2 good middle ground for AWS-native deployments

## Recommendations
- Default: local hash (no API dependency)
- Power users: text-embedding-3-large via OpenAI
- Enterprise: Titan V2 via Bedrock
`,
  },
  {
    path: "Research/plugin-testing-approaches.md",
    mtime: daysAgo(6),
    content: `# Plugin Testing Approaches

## Challenge
Obsidian plugins run inside Electron with access to the full Obsidian API.
Testing without Obsidian requires mocking or abstraction.

## Approaches Evaluated

### 1. Headless Obsidian
- Run Obsidian in headless mode
- Pros: Full API fidelity
- Cons: Heavy, slow, fragile in CI

### 2. VaultAdapter Abstraction
- Abstract vault operations behind an interface
- Swap InMemoryVaultAdapter for tests
- Pros: Fast, deterministic, CI-friendly
- Cons: Must maintain interface parity

### 3. Obsidian API Mocks
- Mock individual Obsidian classes
- Pros: Test Obsidian-specific code
- Cons: Fragile, high maintenance

## Decision
Use VaultAdapter abstraction (approach 2) for integration tests.
Keep Obsidian-specific code thin and tested manually.

See [[Projects/webapp-redesign]] for similar testing strategy.
`,
  },
  {
    path: "Research/llm-structured-output.md",
    mtime: daysAgo(14),
    content: `# LLM Structured Output Patterns

## Problem
LLMs return free-form text. We need structured JSON for patch plans.

## Approaches
1. **JSON in code fences** - Ask model to wrap JSON in \`\`\`json blocks
2. **Function calling** - Use tool_use API for structured responses
3. **Grammar-constrained decoding** - Force valid JSON schema

## Our Approach
We use JSON in code fences for patch plans:
- Simple to implement
- Works across providers
- Parser handles edge cases (multiple blocks, trailing text)

## Edge Cases
- Model sometimes wraps in \`\`\`markdown instead of \`\`\`json
- Trailing commas in JSON
- Unicode in find/replace strings
- Very long patch plans may be truncated

## Related
- [[Reference/coding-standards]] - our JSON handling guidelines
`,
  },
];

const AREA_NOTES: VaultNote[] = [
  {
    path: "Areas/team-processes.md",
    mtime: daysAgo(11),
    content: `# Team Processes

## Code Review
- All PRs require at least 1 approval
- Use conventional comments (nitpick, suggestion, issue, question)
- Respond to reviews within 24 hours
- Author merges after approval

## On-Call
- Weekly rotation
- Primary + secondary on-call
- Escalation: PagerDuty → Slack #incidents → manager

## Release Process
1. Feature freeze on Wednesday
2. QA validation Thursday
3. Release Friday morning
4. Monitor dashboards for 2 hours post-deploy
`,
  },
  {
    path: "Areas/personal-development.md",
    mtime: daysAgo(25),
    content: `# Personal Development Goals

## 2026 Goals
1. **Technical**: Deep dive into WASM and edge computing
2. **Leadership**: Mentor 2 junior developers
3. **Community**: Give 1 conference talk
4. **Health**: Exercise 4x/week

## Reading List
- [ ] "Designing Data-Intensive Applications" by Martin Kleppmann
- [x] "The Staff Engineer's Path" by Tanya Reilly
- [ ] "Rust in Action" by Tim McNamara

## Certifications
- [ ] AWS Solutions Architect
- [x] Kubernetes Application Developer (CKA)
`,
  },
  {
    path: "Areas/infrastructure.md",
    mtime: daysAgo(16),
    content: `# Infrastructure

## Production Stack
- **Compute**: Kubernetes on AWS EKS
- **Database**: PostgreSQL 16 on RDS
- **Cache**: Redis 7 on ElastiCache
- **CDN**: CloudFront
- **Monitoring**: Datadog + PagerDuty

## Cost Breakdown (Monthly)
| Service | Cost |
|---------|------|
| EKS | $2,400 |
| RDS | $1,200 |
| ElastiCache | $600 |
| CloudFront | $300 |
| Total | ~$4,500 |

## Upcoming Changes
- Migrate to ARM instances (20% cost reduction)
- Add read replica for reporting queries
- Implement blue-green deployment
`,
  },
];

const ARCHIVE_NOTES: VaultNote[] = [
  {
    path: "Archive/old-auth-system.md",
    mtime: daysAgo(60),
    content: `# Old Authentication System (Deprecated)

> **Note**: This system is deprecated. See [[Projects/api-v2]] for the new auth.

## Overview
Session-based authentication using express-session with Redis store.

## Issues
- Session tokens stored in cookies (compliance concern)
- No token rotation
- Single point of failure (Redis)

## Migration Status
- [x] Design new JWT-based system
- [x] Implement token generation
- [ ] Migrate existing sessions
- [ ] Sunset old endpoints
`,
  },
  {
    path: "Archive/q4-2025-planning.md",
    mtime: daysAgo(90),
    content: `# Q4 2025 Planning

## Completed Objectives
1. ✅ Launch beta of mobile app
2. ✅ Migrate 80% of API to v2
3. ❌ Implement real-time sync (pushed to Q1 2026)
4. ✅ Achieve 95% test coverage

## Lessons Learned
- Real-time sync was underscoped; needs dedicated team
- Mobile beta received positive feedback
- API migration went smoother than expected
`,
  },
];

const TEMPLATE_NOTES: VaultNote[] = [
  {
    path: "Templates/meeting-note.md",
    mtime: daysAgo(45),
    content: `# {{title}} - {{date}}

## Attendees
-

## Agenda
1.

## Decisions
-

## Action Items
- [ ]

## Notes

`,
  },
  {
    path: "Templates/project-brief.md",
    mtime: daysAgo(45),
    content: `# {{project-name}}

## Overview
Brief description of the project.

## Goals
-

## Timeline
- Phase 1:
- Phase 2:

## Team
- Lead:
- Members:

## Links
-
`,
  },
];

const MISC_NOTES: VaultNote[] = [
  {
    path: "Inbox/quick-capture.md",
    mtime: daysAgo(0),
    content: `# Quick Capture

## Unsorted Ideas
- Look into edge functions for API caching
- Team building event idea: escape room
- Check if Bun runtime is stable enough for production
- Read about WebGPU for data visualization

## Links to Process
- https://example.com/article-about-wasm
- https://example.com/talk-on-crdt
`,
  },
  {
    path: "Inbox/book-notes-data-intensive.md",
    mtime: daysAgo(3),
    content: `# Book Notes: Designing Data-Intensive Applications

## Chapter 1: Reliable, Scalable, Maintainable
- Reliability: system works correctly even under faults
- Scalability: ability to handle growing load
- Maintainability: ease of adapting the system

## Key Takeaways
- Think about data flow, not just data storage
- Every architecture decision is a trade-off
- Document assumptions about load patterns

## Quotes
> "A system is reliable if it continues to work correctly even when things go wrong."
`,
  },
  {
    path: "People/sarah.md",
    mtime: daysAgo(30),
    content: `# Sarah - Design Lead

## Role
Design lead for the web app redesign project.

## Skills
- Figma, Sketch
- Design systems
- Accessibility expert
- User research

## Working Style
- Prefers async communication
- Very detail-oriented
- Reviews designs in batches on Tuesdays

## Notes
- Started in January 2026
- Previously at Company X
- Mentor for the design intern
`,
  },
  {
    path: "People/james.md",
    mtime: daysAgo(30),
    content: `# James - Senior Frontend Engineer

## Role
Frontend tech lead, component library owner.

## Skills
- React, TypeScript expert
- Performance optimization
- Testing advocate
- Accessibility champion

## Key Projects
- [[Projects/component-library]]
- [[Projects/webapp-redesign]]
`,
  },
  {
    path: "Reference/docker-cheatsheet.md",
    mtime: daysAgo(40),
    content: `# Docker Cheatsheet

## Common Commands
\`\`\`bash
docker build -t myapp .
docker run -p 3000:3000 myapp
docker compose up -d
docker logs -f container_name
\`\`\`

## Dockerfile Best Practices
\`\`\`dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/index.js"]
\`\`\`
`,
  },
  {
    path: "Reference/git-workflow.md",
    mtime: daysAgo(28),
    content: `# Git Workflow

## Branch Naming
\`\`\`
feat/add-modal-component
fix/auth-token-refresh
refactor/extract-util-module
\`\`\`

## Commit Message Format
\`\`\`
<type>(<scope>): <subject>

feat(modal): add close-on-escape behavior
fix(auth): handle expired refresh tokens
\`\`\`

## Links
- [[Reference/coding-standards]]
- [[Areas/team-processes]]
`,
  },
  {
    path: "Inbox/tool-evaluations.md",
    mtime: daysAgo(2),
    content: `# Tool Evaluations

## Build Tools
- **Vite**: Fast, good DX, chosen for web app
- **Turbopack**: Promising but still unstable
- **Webpack**: Legacy, slow but stable

## Testing
- **Vitest**: Fast, Vite-native, chosen
- **Jest**: Mature but slower
- **Playwright**: E2E, considering for later

## CI/CD
- GitHub Actions: current choice
- Buildkite: considered for scale
`,
  },
  {
    path: "Inbox/conference-notes.md",
    mtime: daysAgo(5),
    content: `# Conference Notes - ReactConf 2026

## Key Talks
1. "React Server Components in Production" - very relevant to our redesign
2. "Accessibility at Scale" - Sarah should watch the recording
3. "Testing Strategies for Modern React" - validates our Vitest choice

## Ideas to Bring Back
- Consider RSC for dashboard pages
- Look into new concurrent features for data loading
- Check out the new React DevTools profiling mode
`,
  },
];

/**
 * All fixture notes combined (50+ notes).
 */
export const ALL_FIXTURE_NOTES: VaultNote[] = [
  ...PROJECT_NOTES,
  ...MEETING_NOTES,
  ...DAILY_NOTES,
  ...REFERENCE_NOTES,
  ...RESEARCH_NOTES,
  ...AREA_NOTES,
  ...ARCHIVE_NOTES,
  ...TEMPLATE_NOTES,
  ...MISC_NOTES,
];

/**
 * Create a fully populated InMemoryVaultAdapter with the fixture vault.
 */
export function createFixtureVault(): InMemoryVaultAdapter {
  return new InMemoryVaultAdapter(ALL_FIXTURE_NOTES);
}

/**
 * Create a smaller vault for focused tests (just projects + reference).
 */
export function createSmallFixtureVault(): InMemoryVaultAdapter {
  return new InMemoryVaultAdapter([...PROJECT_NOTES, ...REFERENCE_NOTES]);
}
