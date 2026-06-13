# React Flow (flow / diagram / node-canvas UI)

Read this before building flow, diagram, graph, or canvas UI.

- The package is `@xyflow/react` (React Flow v12). It was renamed twice —
  `react-flow-renderer` → `reactflow` → `@xyflow/react`. Imports from either
  old name are wrong here.
- Import the styles once: `import "@xyflow/react/dist/style.css"`.
- React Flow is interactive client-side UI — components using it need
  `"use client"`.
- It is declared in `package.json` but may not be installed yet: if
  `node_modules/@xyflow/` is missing, ask the user to run `bun install`
  before writing code against it.
- v12 APIs may differ from your training data — once installed, verify
  against the types in `node_modules/@xyflow/react/`.

## The live example: the tournament viewer

`src/components/tournament/` is the worked example, and the pattern to
follow: keep layout out of React. `def-graph.ts` is a **pure** function
(`buildGraph(concrete, expanded) → nodes/edges`) with no React import —
unit-tested without a DOM in `def-graph.test.ts`. `tournament-flow.tsx` is
the thin `"use client"` shell that renders what it returns and owns only
the expand/collapse state. The data it draws comes pre-shaped from
`concretify` (run server-side; see `design/tournament-model.md`), so the
component never touches the engine or registry.
