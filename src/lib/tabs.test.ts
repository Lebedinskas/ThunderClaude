import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createTab,
  loadTabsState,
  saveTabsState,
  findTabBySessionId,
  MAX_TABS,
  type Tab,
  type TabsState,
} from "./tabs";

// ── Mock localStorage ──────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// ── Mock crypto.randomUUID ─────────────────────────────────────────────────

let uuidCounter = 0;
vi.stubGlobal("crypto", {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

beforeEach(() => {
  localStorageMock.clear();
  uuidCounter = 0;
});

// ── createTab ──────────────────────────────────────────────────────────────

describe("createTab", () => {
  it("creates a tab with sensible defaults", () => {
    const tab = createTab();
    expect(tab.id).toBe("uuid-1");
    expect(tab.title).toBe("New Chat");
    expect(tab.model).toBe("claude-sonnet-4-6");
    expect(tab.orchestrationMode).toBe("direct");
    expect(tab.researchDepth).toBe("deep");
    expect(tab.hasMessages).toBe(false);
    expect(tab.lastActivity).toBeGreaterThan(0);
  });

  it("applies overrides", () => {
    const tab = createTab({
      id: "custom-id",
      title: "My Chat",
      model: "gemini-2.5-flash" as Tab["model"],
      hasMessages: true,
    });
    expect(tab.id).toBe("custom-id");
    expect(tab.title).toBe("My Chat");
    expect(tab.model).toBe("gemini-2.5-flash");
    expect(tab.hasMessages).toBe(true);
    // Defaults still applied for non-overridden fields
    expect(tab.orchestrationMode).toBe("direct");
  });

  it("generates unique IDs for each call", () => {
    const tab1 = createTab();
    const tab2 = createTab();
    expect(tab1.id).not.toBe(tab2.id);
  });
});

// ── loadTabsState / saveTabsState ──────────────────────────────────────────

describe("loadTabsState", () => {
  it("returns null when localStorage is empty", () => {
    expect(loadTabsState()).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    localStorageMock.setItem("thunderclaude-tabs", "not json");
    expect(loadTabsState()).toBeNull();
  });

  it("returns null for empty tabs array", () => {
    saveTabsState({ tabs: [], activeTabId: "x" });
    expect(loadTabsState()).toBeNull();
  });

  it("loads valid state", () => {
    const tab = createTab({ id: "tab-1", title: "Test" });
    const state: TabsState = { tabs: [tab], activeTabId: "tab-1" };
    saveTabsState(state);

    const loaded = loadTabsState();
    expect(loaded).not.toBeNull();
    expect(loaded!.tabs).toHaveLength(1);
    expect(loaded!.tabs[0].id).toBe("tab-1");
    expect(loaded!.activeTabId).toBe("tab-1");
  });

  it("fixes activeTabId if it references a non-existent tab", () => {
    const tab = createTab({ id: "tab-1" });
    saveTabsState({ tabs: [tab], activeTabId: "nonexistent" });

    const loaded = loadTabsState();
    expect(loaded!.activeTabId).toBe("tab-1"); // Corrected to first tab
  });
});

describe("saveTabsState", () => {
  it("writes to localStorage", () => {
    const tab = createTab({ id: "t1" });
    saveTabsState({ tabs: [tab], activeTabId: "t1" });
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      "thunderclaude-tabs",
      expect.any(String),
    );
  });

  it("roundtrips through load", () => {
    const tab1 = createTab({ id: "a", title: "First" });
    const tab2 = createTab({ id: "b", title: "Second", hasMessages: true });
    const state: TabsState = { tabs: [tab1, tab2], activeTabId: "b" };
    saveTabsState(state);

    const loaded = loadTabsState();
    expect(loaded!.tabs).toHaveLength(2);
    expect(loaded!.tabs[0].title).toBe("First");
    expect(loaded!.tabs[1].title).toBe("Second");
    expect(loaded!.tabs[1].hasMessages).toBe(true);
    expect(loaded!.activeTabId).toBe("b");
  });
});

// ── findTabBySessionId ─────────────────────────────────────────────────────

describe("findTabBySessionId", () => {
  it("finds a tab by ID", () => {
    const tabs = [
      createTab({ id: "a", title: "Alpha" }),
      createTab({ id: "b", title: "Beta" }),
    ];
    expect(findTabBySessionId(tabs, "b")?.title).toBe("Beta");
  });

  it("returns undefined for missing ID", () => {
    const tabs = [createTab({ id: "a" })];
    expect(findTabBySessionId(tabs, "missing")).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(findTabBySessionId([], "any")).toBeUndefined();
  });
});

// ── MAX_TABS constant ──────────────────────────────────────────────────────

describe("MAX_TABS", () => {
  it("is 12", () => {
    expect(MAX_TABS).toBe(12);
  });
});
