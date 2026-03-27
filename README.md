# gitinspect

*Ask questions about any GitHub repo — from your browser, without cloning.*

---

**gitinspect** is a research agent for source code. Pick a repository, chat in natural language, and get answers grounded on the code. The agent is built on [pi-mono](https://github.com/badlogic/pi-mono) and explores the codebase through a **read-only virtual shell** ([just-bash](https://github.com/vercel-labs/just-bash)) mounted on a **virtual filesystem** backed by the **GitHub API** ([just-github](https://github.com/jeremyosih/gitoverflow/tree/main/just-github) in this repo) — not your laptop, not a real checkout.

**Private by design.** Sessions, settings, provider keys, and usage stay on your device ([Dexie](https://github.com/dexie/Dexie.js) / IndexedDB). Chat runs client-side; we don’t run a backend for your data.

Shaped by the same product instincts as [Sitegeist](https://sitegeist.ai) (browser-first, you stay in control).

### Develop

```bash
bun install
bun run dev
```

→ [localhost:3000](http://localhost:3000)

```bash
bun test
bun run build
```

### License

[AGPL-3.0](LICENSE)
