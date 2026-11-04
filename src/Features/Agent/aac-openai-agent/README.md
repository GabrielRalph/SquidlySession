```
npm install
npm run dev
```

```
open http://localhost:3000
```

## Run context

`src/schema/context.ts` defines the application data once in Zod:

- `BoardRequirements` and `BoardContext` are inferred from their schemas.
- `RequestMessageState` combines `BoardContext` with the SDK's `AgentInputItem[]` history type.
- `BoardContextSchema` includes requirements and a nullable board draft; older requirements-only objects default to `board: null`.

Modify the schemas to evolve application context; dependent TypeScript types follow automatically. SDK history remains an SDK-owned type, not a duplicated application schema.

Each turn loads history and a copy of saved context, clears only the working board, then calls `run(agent, messages, { context })`. Dynamic instructions expose saved requirements, since local context is not automatically model-visible.

The agent calls `update_board_context` from `src/agents/tools.ts` with a complete `{ requirements, board }` snapshot. The tool validates before updating `runContext.context` and returns the requirements as confirmation. It accepts `board: null` while clarifying or as an intermediate update; a submitted board must match complete requirements. Tool schemas remain even though the agent no longer has a structured final-output schema.

The agent's final reply is ordinary text. The service requires a successful update tool execution in that run, validates `result.runContext.context`, and constructs the existing clarification/success response itself. It rejects complete requirements without a submitted board and saves context/history together only after all checks. Failed turns do not replace saved state; prior boards cannot silently become a new turn's result.

The HTTP contract is unchanged: POST `/agent` with `{ "query": "..." }` and receive `{ "message": ... }`. Internal requirements are not added to the response. The route still uses `"user_abc"`, so all HTTP callers share one conversation. Storage is unbounded, process-local, and lost on restart; there are no ownership checks or concurrent-turn serialization. Replace this prototype key/storage before multi-user production use.

## Checks

```sh
npm test
npm run build
```

Tests use a scripted SDK model with tracing disabled; they need no API key or network access.
