---
id: typed-api-client
test: npx vitest run src/lib/products.test.ts
---
Create `src/lib/products.ts` exporting `getProducts(): Promise<Product[]>` and a `Product` type with `id: string`, `name: string` and `price: number`. Use the existing API helper for the HTTP call. Add a unit test at `src/lib/products.test.ts` that mocks the helper.
