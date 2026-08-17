# @hims/ui — Clinical Matrix component kit

Dependency-free React component kit for the Divine Hands Hospital desktop app.
All styling is inline `CSSProperties` built on the design tokens in
[`src/theme.ts`](./src/theme.ts) — no CSS files, no runtime dependencies.

## Tokens

```ts
import { theme } from "@hims/ui";

// theme.sidebar.*, theme.surface.*, theme.text.*, theme.action.*,
// theme.badge.* (draft/day/aft/night/off/submitted/approved/active/inactive),
// theme.fontSize.*, theme.fontWeight.*, theme.radius.*, theme.shadow.*,
// theme.spacing.*
```

## Components

| Component | Purpose |
| --- | --- |
| `Button` | `primary` / `secondary` / `outline` / `ghost` / `danger`, sizes `sm`/`md`, `loading` spinner, `icon` slot |
| `PageHeader` | Title + subtitle (left), status badge + actions (right) |
| `TabNav` | Underline sub-navigation tabs, 2px primary-blue active indicator |
| `Card` | White surface, `#e2e8f0` border, optional title/hint/toolbar header |
| `ShiftBadge` / `StatusBadge` | Pill badges — Day ☀️ / Night 🌙 / Aft 🌅 / Off 🌴; draft/submitted/approved/active/inactive |
| `DataTable` / `MatrixGrid` | Dense tables, sticky headers + identity columns, horizontal scroll |
| `Input` / `Select` / `Textarea` / `Checkbox` | Consistent controls with focus/error/disabled states |
| `FormField` | Label + helper + error + required indicator wrapper |
| `Modal` | Overlay dialog, Esc/overlay close, header + footer |
| `Spinner` | SMIL-animated SVG spinner (no CSS) |
| `EmptyState` | Icon + title + description + optional action |
| `Toast` / `ToastProvider` / `useToast` | `toast.success/error/info(message)` notifications |
| `Icon` | Hand-written 24×24 inline SVG icons, `stroke="currentColor"` |

## Usage

```tsx
import { Button, Card, PageHeader, ShiftBadge, DataTable } from "@hims/ui";

<PageHeader
  title="Roster"
  description="Monthly schedule"
  actions={<Button>Auto-Generate</Button>}
/>
<Card title="August" hint="Draft — not yet approved" toolbar={<select>…</select>}>
  <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} dense />
</Card>
```

Wrap the app root in `ToastProvider` before using `useToast()`.
