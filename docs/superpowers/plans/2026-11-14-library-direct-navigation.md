# Study Library Direct Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal** — Serve the supplied study library at the existing production URL with the full automatically updated catalog and same-tab document navigation.

**Architecture** — The Vite entry renders the supplied library shell and reads the generated v1 catalog. Native links handle document navigation, and legacy read hashes resolve to those same URLs. The existing content collector, Worker, and verified publication process serve the assets.

**Tech Stack** — Node.js 24, TypeScript, Vite, Vitest, Playwright, GitHub Actions and Cloudflare Workers.

**Spec** — The chat's approved design and the uploaded `study-library.html`. The November 14 follow-up adds a single line of course tabs.

## Global Constraints

- List all published `listed: true` documents, including material outside the prototype sample.
- Copy the prototype's UI, light and dark palettes, filters, recent activity and keyboard behavior. Keep the course tabs on one scrollable line.
- Keep production document URLs, ids, content paths and study storage intact.
- Use the existing verified deployment to the current Worker.

## Review Focus

- Narrow screens keep every course reachable without page overflow (Task 1).
- Compound Korean searches and composition work with the full catalog (Task 1).
- Browser Back restores pagination, scroll and filters (Task 1).
- Saved read links preserve the opaque query and anchor (Task 1).
- Switching themes in the library and source documents leaves exercise data scoped (Task 2).

### Task 1 — Library and direct navigation

**Files** — `index.html`, `src/main.ts`, `src/app/{catalog-view,router,styles}.*`, catalog display data, `config/courses.ts`, and the catalog, reader and reading-entry browser tests.

**Interfaces** — `mountCatalog(root: HTMLElement, catalog: Catalog): void` renders the library. `parseRoute(hash: string): Route` and `formatRoute(route: Route): string` retain the primary hash paths. `documentUrl(doc: DocumentInfo, base: string): URL | null` validates the native target.

- [ ] Add browser coverage for the single-line tabs at 320px, listed and linked-only items, compound search, linked document opens, and Back restoration. Confirm the existing interface fails these checks.
- [ ] Adapt the prototype shell, embedded font, list interactions and curated headings to the Vite entry. Keep published IDs in links and recents, prefer the explicit URL for shared filters, and restore viewport state from the matching history entry. Use a compact fallback for groups that only have operational metadata.
- [ ] Replace legacy read hashes with validated content destinations, preserving opaque query and anchor. Present a recoverable error when the ID is unavailable.
- [ ] Update the existing browser tests to assert the direct route contract. Verify the new cases in Chromium, Firefox and WebKit.

### Task 2 — Source compatibility and release verification

**Files** — `src/compat/storage.ts`, content bootstrap, `tools/representatives.ts`, and source/storage browser tests.

**Interfaces** — Keep `installStorage(namespace: string, rules: StorageRule[]): void`. The source and the library use the unprefixed localStorage key `od-theme`. Representative documents run through the normal same-tab links.

- [ ] Add a theme regression test that checks shared values and isolation for other keys before and after navigation. Confirm it fails on the current adapter.
- [ ] Share the local theme key while preserving namespaced reads and writes for other settings. Update representatives to check native navigation and anchors, preserving coverage for workbooks, document interactions, assets, and reload.
- [ ] Run typecheck, the full unit and browser suites, and a production build. Review the integrated diff and commit it.

### Task 3 — Publish and check production

**Files** — Existing GitHub Actions workflow and Worker settings are the deployment entry points.

- [ ] Publish from main and wait for the matching Actions run to report a verified public deployment.
- [ ] Confirm the production catalog and core flows, including same-tab opening, a narrow-screen course tab row and representative attachments.
