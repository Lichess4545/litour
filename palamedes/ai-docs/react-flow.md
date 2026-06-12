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
