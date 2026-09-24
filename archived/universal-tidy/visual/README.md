# Universal Tidy visual preview

Generates deterministic previews from the real Pi `ToolExecutionComponent`, the installed universal-tidy extension, and the active `glass` theme.

```bash
cd ~/.pi/agent/extensions/universal-tidy
NODE_PATH=/home/krita/.bun/install/global/node_modules \
PI_GLOBAL_NODE_MODULES=/home/krita/.bun/install/global/node_modules \
FORCE_COLOR=3 \
bun run visual/preview.ts
```

Artifacts:

```text
visual/artifacts/preview.txt
visual/artifacts/preview.html
```

The harness covers read, bash, errors, pending calls, structured external results, expanded built-in output, and third-party renderer delegation at 80, 120, and 160 columns.