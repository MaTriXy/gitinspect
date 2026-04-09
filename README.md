# gitinspect

![Screenshot 2026-03-28 at 01 36 31](https://github.com/user-attachments/assets/a39a420d-a538-4e8e-82a3-16794b3e0e6f)

Ask questions about any GitHub repo from your browser—without cloning.

You can replace `hub` with `inspect` in any GitHub URL to open the corresponding view here.

**Site:** [gitinspect.com](https://gitinspect.com/)

---

## Privacy

**We don’t run a backend that stores your chats or credentials.** Session history, model choice, app settings, optional GitHub token, provider keys / OAuth, and usage totals live **only in this browser** (IndexedDB via [Dexie](https://github.com/dexie/Dexie.js)).

**The app still uses the network:** Your browser calls **GitHub’s API** directly to load repository data. When you use **your own** provider keys, chat goes to those providers (you can route via **Settings → Proxy**). The **bundled free tier** is different: chat goes through **gitinspect’s server proxy** (`/api/proxy`) so we can rate-limit, rotate a shared host key, and reduce abuse—see the next section.

---

## Models & GitHub access (two different things)

| | What it’s for |
|---|----------------|
| **Settings → Providers** | LLM API keys / OAuth. Use this for the models you want and for providers you pay for. |
| **Settings → GitHub** | Optional **PAT** stored only in this browser: higher GitHub API rate limits (60/h → 5,000/h) and richer repo metadata where applicable. |

If you have **no provider configured**, the app still offers a **free tier** model in the picker (“Free (with limits)”). That path is **rate-limited** and **subject to the host’s terms**; traffic goes through **gitinspect’s proxy** (`/api/proxy`) so we can enforce limits and run the shared API key on the server—your prompts are not sent straight from the browser to the model host the way they are when you bring your own key.

---

## Analytics

We use **Vercel** (hosting) and **OneDollar Stats** for **aggregate** traffic and product analytics. These are **private** to the project—**not** used to read your chats, prompts, or repository contents. Chat routes are excluded from page analytics where configured.

---

## How it works

- **Research agent** — Pick a repository, chat in natural language; answers are grounded in the code.
- **Stack** — [pi-mono](https://github.com/badlogic/pi-mono), read-only shell via [just-bash](https://github.com/vercel-labs/just-bash), virtual FS from the GitHub API [just-github](https://github.com/ThallesP/just-github).
- **Local first** — Agent work runs in a per-tab `DedicatedWorker`; durable state stays on the main thread (IndexedDB).
- **Resilient** — Lease ownership, runtime recovery, and interrupted-turn repair on the main thread; the worker improves responsiveness, not hidden-tab guarantees.
- **Lazy loading** — Nothing prefetched at construction; everything on demand.
- **Tree cache** — Full repo tree once via Git Trees API; `stat`, `exists`, `readdir` from cache.
- **Content cache** — File contents by blob SHA (content-addressable).
- **Smart API selection** — Contents API for small files; raw endpoint for large files (>1 MB).

Inspired by [Sitegeist](https://sitegeist.ai), [btca](https://github.com/davis7dotsh/better-context) & [repogrep](https://repogrep.com).

---

## Rate limits (GitHub API)

Unauthenticated: **60 requests/hour**. With a token: **5,000/hour**. Add a token under **Settings → GitHub** in the app (stored only in your browser). The tree cache keeps real usage low after the first load.

---

## AI Disclosure

This codebase has been built with a lot of support from AI. Very little is hand-written; **GPT 5.4** was used to create this repository alongside that small amount of manual code. (Not proud of code quality rn but it works and will be cleaned up)

---

## License

[AGPL-3.0](LICENSE)
