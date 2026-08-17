# UI/UX Redesign — Clinical Matrix Design System & Stage Prompts

This is the index document for the UI/UX redesign of the Divine Hands Hospital
desktop client. The **canonical staged prompts** live in:

- [`docs/1.md`](./1.md) — Stage 1: Design Tokens & Global Foundation
- [`docs/2.md`](./2.md) — Stage 2: Shared UI Component Kit (`@hims/ui`)
- [`docs/3.md`](./3.md) — Stage 3: App Shell, Sidebar & Navigation
- [`docs/4.md`](./4.md) — Stage 4: Authentication & Settings Pages
- [`docs/5.md`](./5.md) — Stage 5: Data Pages & Matrix Views Migration
- [`docs/6.md`](./6.md) — Stage 6: Feedback, Alerts & Micro-Interactions
- [`docs/7.md`](./7.md) — Stage 7: Final Polish, Accessibility & Release Builds

The visual reference (mockups: `code.html` + `screen.png` per screen, plus
`DESIGN.md` and `clinical_matrix_core_primitives.txt`) is extracted in
[`docs/ui-design-reference/`](./ui-design-reference/). The original zip is
`docs/ui_ux_design_benchmark.zip`.

---

## Design system summary — "Clinical Matrix"

Professional, systematic, authoritative. High data density, structural
integrity, low decoration. Fixed sidebar / fluid content.

### Colors
- **Sidebar:** deep navy `#0f172a` (alt `#0b132b`); categories `#64748b`;
  inactive nav text `#94a3b8`; active pill bg `#1e293b`, text `#38bdf8`/`#fff`;
  hover `rgba(255,255,255,0.04)`.
- **Canvas:** `#f8fafc` · **Cards:** `#ffffff` with 1px `#e2e8f0` border ·
  **Subtle surfaces (table headers):** `#f1f5f9`.
- **Text:** primary `#0f172a`, secondary `#475569`, muted `#64748b`.
- **Actions:** primary blue `#2563eb`, dark slate `#334155`, danger `#dc2626`,
  success `#16a34a`, focus ring `#2563eb`.
- **Shift badges (pastel pills):**
  - Day ☀️ `#fef3c7` / `#b45309` / border `#fde68a`
  - Aft 🌅 `#e0f2fe` / `#0369a1` / border `#bae6fd`
  - Night 🌙 `#e0e7ff` / `#4338ca` / border `#c7d2fe`
  - Off 🌴 `#f8fafc` / `#64748b` / border `#e2e8f0`
  - Draft `#f1f5f9` / `#475569` / border `#e2e8f0`

### Typography
Compact scale for density: `0.65 / 0.75 / 0.85 / 1 / 1.25 / 1.5rem`;
weights 400/500/600/700. Data tables 13–14px; sidebar labels medium; labels
bold 12px. Font stack (offline-safe): `system-ui, -apple-system,
BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`.

### Layout
- 240px fixed sidebar, grouped uppercase category headers.
- Main canvas: fluid, `2rem` outer padding, cards stack with `1rem` gutter.
- Wide matrices scroll horizontally; sticky identity columns (name/role).

### Components (all in `packages/ui`, inline styles from `theme.ts`, no deps)
`Button` (primary/secondary/outline/ghost/danger; sm/md; loading spinner; icon
slots) · `PageHeader` (title + subtitle + status badge + action cluster) ·
`TabNav` (underline, 2px `#2563eb` active) · `Card` (white, border, header
toolbar) · `ShiftBadge` / `StatusBadge` · `DataTable` / `MatrixGrid` (dense,
sticky headers/columns, horizontal scroll) · `Input`/`Select`/`Textarea`/
`Checkbox` · `FormField` · `Modal` · `Spinner` · `EmptyState` · `Toast` ·
`Icon` (24×24 inline SVG, `stroke=currentColor`, no library).

### Sidebar navigation (existing pages only — no new routes)
- **CLINICAL:** Patients Directory (`users`), Orders & Clinical (`clipboard`),
  Lab & Pathology (`flask`)
- **PHARMACY & INVENTORY:** Pharmacy Dispense (`pill`), Hospital Inventory &
  Assets (`box`)
- **FINANCE & BILLING:** Billing & Cashier (`cash`)
- **STAFF & OPERATIONS:** Roster (`calendar`), Shift Handover Log (`book`),
  Staff Communications (`chat`)
- **SYSTEM & ADMIN:** Settings (`gear`), Sign out (`logout`)

---

## Global rules (apply to every stage)

1. **Do not change any backend/API behavior** — Go API and response shapes are
   frozen; all work is in `apps/desktop/src` and `packages/ui`.
2. **Zero new runtime dependencies** — no MUI/Tailwind/icon libraries. Icons
   are hand-written inline SVGs; the app runs offline in hospitals.
3. **Preserve every feature, label, and accessible text.** Visual overhaul
   only — never a behavior change.
4. **No new routes/pages.** The redesign touches styling and structure of
   existing screens; the tab set and routing in `App.tsx` stay identical.
5. **Verification gate after every stage** (repo root):
   ```bash
   pnpm typecheck && pnpm lint && pnpm test && pnpm build
   ```
6. Work incrementally — one page at a time in Stage 5; never leave the app
   half-migrated.

## Status

- [x] Stage 1 — Design tokens & global foundation
- [x] Stage 2 — Shared UI component kit (`@hims/ui`)
- [x] Stage 3 — App shell, sidebar & navigation
- [ ] Stage 4 — Authentication & Settings pages
- [ ] Stage 5 — Data pages & matrix views (9 pages)
- [ ] Stage 6 — Feedback, alerts & micro-interactions
- [ ] Stage 7 — Final polish, accessibility & release builds
