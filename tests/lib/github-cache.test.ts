//just-github test - DO NOT Delete.
import { beforeEach, describe, expect, it } from "vitest";
import { ContentCache, TreeCache } from "@/lib/github/cache";

describe("TreeCache", () => {
  let cache: TreeCache;

  beforeEach(() => {
    cache = new TreeCache({ ttlMs: 60_000 });
  });

  it("starts unloaded", () => {
    expect(cache.loaded).toBe(false);
    expect(cache.allPaths()).toEqual([]);
  });

  it("loads tree entries", () => {
    cache.load("abc123", [
      { mode: "040000", path: "src", sha: "aaa", type: "tree" },
      { mode: "100644", path: "src/index.ts", sha: "bbb", size: 100, type: "blob" },
      { mode: "100644", path: "README.md", sha: "ccc", size: 50, type: "blob" },
    ]);

    expect(cache.loaded).toBe(true);
    expect(cache.allPaths()).toEqual(["src", "src/index.ts", "README.md"]);
  });

  it("gets individual entries", () => {
    cache.load("abc123", [
      { mode: "100644", path: "src/index.ts", sha: "bbb", size: 100, type: "blob" },
    ]);

    const entry = cache.get("src/index.ts");
    expect(entry).toBeDefined();
    expect(entry?.sha).toBe("bbb");
    expect(entry?.size).toBe(100);
  });

  it("returns undefined for missing entries", () => {
    cache.load("abc123", []);
    expect(cache.get("nope")).toBeUndefined();
  });

  it("lists root directory entries", () => {
    cache.load("abc123", [
      { mode: "040000", path: "src", sha: "aaa", type: "tree" },
      { mode: "100644", path: "src/index.ts", sha: "bbb", size: 100, type: "blob" },
      { mode: "100644", path: "README.md", sha: "ccc", size: 50, type: "blob" },
    ]);

    const rootEntries = cache.listDir("");
    expect(rootEntries.map((entry) => entry.path)).toEqual(["src", "README.md"]);
  });

  it("lists subdirectory entries", () => {
    cache.load("abc123", [
      { mode: "040000", path: "src", sha: "aaa", type: "tree" },
      { mode: "100644", path: "src/index.ts", sha: "bbb", size: 100, type: "blob" },
      { mode: "040000", path: "src/utils", sha: "ddd", type: "tree" },
      {
        mode: "100644",
        path: "src/utils/helper.ts",
        sha: "eee",
        size: 30,
        type: "blob",
      },
    ]);

    const srcEntries = cache.listDir("src");
    expect(srcEntries.map((entry) => entry.path)).toEqual(["src/index.ts", "src/utils"]);
  });

  it("expires after TTL", () => {
    const shortCache = new TreeCache({ ttlMs: 1 });
    shortCache.load("abc123", [
      { mode: "100644", path: "file.txt", sha: "aaa", size: 10, type: "blob" },
    ]);

    const start = Date.now();
    while (Date.now() - start < 5) {}

    expect(shortCache.loaded).toBe(false);
    expect(shortCache.get("file.txt")).toBeUndefined();
  });

  it("clears all entries", () => {
    cache.load("abc123", [
      { mode: "100644", path: "file.txt", sha: "aaa", size: 10, type: "blob" },
    ]);
    cache.clear();
    expect(cache.loaded).toBe(false);
    expect(cache.allPaths()).toEqual([]);
  });
});

describe("ContentCache", () => {
  let cache: ContentCache;

  beforeEach(() => {
    cache = new ContentCache({ maxBytes: 1024, maxEntries: 10 });
  });

  it("stores and retrieves string content", () => {
    cache.set("sha1", "hello world");
    expect(cache.get("sha1")).toBe("hello world");
  });

  it("stores and retrieves buffer content", () => {
    const data = new Uint8Array([1, 2, 3]);
    cache.set("sha2", data);
    expect(cache.get("sha2")).toEqual(data);
  });

  it("returns undefined for missing entries", () => {
    expect(cache.get("nope")).toBeUndefined();
  });

  it("reports has correctly", () => {
    cache.set("sha1", "data");
    expect(cache.has("sha1")).toBe(true);
    expect(cache.has("sha2")).toBe(false);
  });

  it("evicts oldest entries when maxEntries exceeded", () => {
    const small = new ContentCache({ maxBytes: 1_000_000, maxEntries: 3 });
    small.set("a", "1");
    small.set("b", "2");
    small.set("c", "3");
    small.set("d", "4");

    expect(small.has("a")).toBe(false);
    expect(small.has("b")).toBe(true);
    expect(small.has("d")).toBe(true);
  });

  it("evicts oldest entries when maxBytes exceeded", () => {
    const tiny = new ContentCache({ maxBytes: 10, maxEntries: 100 });
    tiny.set("a", "12345");
    tiny.set("b", "12345");
    tiny.set("c", "12345");

    expect(tiny.has("a")).toBe(false);
    expect(tiny.has("b")).toBe(true);
    expect(tiny.has("c")).toBe(true);
  });

  it("clears all entries", () => {
    cache.set("a", "data");
    cache.set("b", "data");
    cache.clear();
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(false);
  });

  it("updates existing entries in place", () => {
    cache.set("sha1", "old");
    cache.set("sha1", "new");
    expect(cache.get("sha1")).toBe("new");
  });
});
