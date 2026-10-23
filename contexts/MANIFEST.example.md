# Codebase map (example)

Stack: Next.js (App Router), React, TypeScript strict. Import alias `@/` maps to `src/`.

## Exports

### `src/lib/`
- `format.ts` — function: `formatCurrency(amount: number, currency?: string): string` · function: `formatDate(date: Date | string): string`
- `api.ts` — function: `apiGet<T>(path: string): Promise<T>` · function: `apiPost<T>(path: string, body: unknown): Promise<T>`

### `src/hooks/`
- `useDebounce.ts` — hook: `useDebounce<T>(value: T, delayMs: number): T`

### `src/components/`
- `DataTable.tsx` — component: `DataTable({ rows, columns, onRowClick })`

## Conventions
- Reuse helpers in `src/lib/` instead of writing new ones.
- Components are function components with a named `Props` interface.
