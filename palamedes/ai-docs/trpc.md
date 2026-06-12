# tRPC v11, data fetching, forms, auth wiring, client state, shadcn

Read this when adding or changing API procedures, fetching data in pages or
components, building forms, touching auth, adding client state, or adding
shadcn components.

## Server side

- Routers live in `src/server/api/routers/<name>.ts`; register each in
  `appRouter` (`src/server/api/root.ts`).
- Every procedure input is validated with zod.
- `publicProcedure` vs `protectedProcedure` (`src/server/api/trpc.ts`):
  protected throws `UNAUTHORIZED` without a session and narrows `ctx.session`
  to non-null. Context is `{ db, session }`.
- superjson is the transformer on both ends; zod errors come back treeified in
  `shape.data.zodError`.

## Client components — v11 TanStack style, not classic hooks

This codebase uses `@trpc/tanstack-react-query`. The classic
`api.post.list.useQuery()` style from older tRPC does not exist here.

```tsx
const trpc = useTRPC(); // from @/trpc/react
const posts = useQuery(trpc.post.list.queryOptions());
const create = useMutation(trpc.post.create.mutationOptions({ onSuccess }));
await queryClient.invalidateQueries(trpc.post.list.queryFilter());
```

## Server components (RSC)

- Import `trpc`, `getQueryClient`, `HydrateClient` from `@/trpc/server` —
  that module is RSC-only and executes procedures in-process (no HTTP).
- Prefetch pattern (`src/app/posts/page.tsx`):
  `void getQueryClient().prefetchQuery(trpc.post.list.queryOptions())`, then
  wrap children in `<HydrateClient>`. `@/trpc/server` also exports a
  `prefetch()` wrapper for the first line.
- Pages whose data depends on the request session need
  `export const dynamic = "force-dynamic"`.
- `RouterInputs` / `RouterOutputs` types come from `@/trpc/types`.

## Forms

TanStack Form + zod: `useForm({ validators: { onSubmit: schema }, ... })` with
`<form.Field>` render props. Copy
`src/components/posts/create-post-form.tsx`, including its
mutate-then-invalidate-then-reset flow.

## Client state

Zustand stores use the provider pattern of `src/stores/ui-store.tsx`: the
store is created inside a provider so each request and each test gets its own
instance. Module-level stores leak state across SSR requests — don't create
them.

## Auth touchpoints

- Server: `auth` from `@/server/auth` (server-only); the session is read via
  `auth.api.getSession({ headers })` and is already wired into tRPC context.
- Client: `authClient` from `@/lib/auth-client`.
- HTTP mounts: `src/app/api/auth/[...all]/route.ts` (Better Auth) and
  `src/app/api/trpc/[trpc]/route.ts` (tRPC).

## shadcn components

Config lives in `components.json` (style `radix-nova`, lucide icons). To add
a component, ask the user to run the shadcn CLI (it is a project dependency);
don't hand-write files into `src/components/ui/`.
