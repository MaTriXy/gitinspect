import "fake-indexeddb/auto";
import { afterAll } from "vitest";
import { db } from "@/db/schema";

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: (query: string) => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  }),
});

afterAll(() => {
  db.close();
});
