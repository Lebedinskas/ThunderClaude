import { describe, it, expect } from "vitest";
import {
  buildChildrenMap,
  getActivePath,
  getBranchInfo,
  serializeActiveBranches,
  deserializeActiveBranches,
  ROOT_PARENT,
  type ActiveBranchMap,
} from "./branching";
import type { ChatMessage } from "./claude-protocol";

// Helper to create a minimal ChatMessage
function msg(id: string, parentId?: string, role: "user" | "assistant" = "user"): ChatMessage {
  return { id, role, content: `msg-${id}`, timestamp: Date.now(), parentId };
}

// ── buildChildrenMap ──────────────────────────────────────────────────────────

describe("buildChildrenMap", () => {
  it("puts root messages (no parentId) under ROOT_PARENT", () => {
    const messages = [msg("a"), msg("b")];
    const cmap = buildChildrenMap(messages);
    expect(cmap.get(ROOT_PARENT)).toEqual(["a", "b"]);
  });

  it("groups children by parentId", () => {
    const messages = [msg("a"), msg("b", "a"), msg("c", "a"), msg("d", "b")];
    const cmap = buildChildrenMap(messages);
    expect(cmap.get(ROOT_PARENT)).toEqual(["a"]);
    expect(cmap.get("a")).toEqual(["b", "c"]);
    expect(cmap.get("b")).toEqual(["d"]);
  });

  it("returns empty map for empty input", () => {
    expect(buildChildrenMap([]).size).toBe(0);
  });

  it("preserves insertion order of children", () => {
    const messages = [msg("root"), msg("c1", "root"), msg("c2", "root"), msg("c3", "root")];
    const cmap = buildChildrenMap(messages);
    expect(cmap.get("root")).toEqual(["c1", "c2", "c3"]);
  });
});

// ── getActivePath ─────────────────────────────────────────────────────────────

describe("getActivePath", () => {
  it("returns linear chain with no branches", () => {
    const messages = [msg("a"), msg("b", "a"), msg("c", "b")];
    const cmap = buildChildrenMap(messages);
    const path = getActivePath(messages, cmap, new Map());
    expect(path.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("follows first child by default (index 0)", () => {
    const messages = [
      msg("a"),
      msg("b", "a"),  // first child of a
      msg("c", "a"),  // second child of a
    ];
    const cmap = buildChildrenMap(messages);
    const path = getActivePath(messages, cmap, new Map());
    expect(path.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("follows active branch when set", () => {
    const messages = [
      msg("a"),
      msg("b", "a"),
      msg("c", "a"),  // branch
      msg("d", "c"),  // continuation of branch
    ];
    const cmap = buildChildrenMap(messages);
    const branches: ActiveBranchMap = new Map([["a", 1]]);
    const path = getActivePath(messages, cmap, branches);
    expect(path.map((m) => m.id)).toEqual(["a", "c", "d"]);
  });

  it("clamps out-of-bounds index to last child", () => {
    const messages = [msg("a"), msg("b", "a"), msg("c", "a")];
    const cmap = buildChildrenMap(messages);
    const branches: ActiveBranchMap = new Map([["a", 999]]);
    const path = getActivePath(messages, cmap, branches);
    expect(path.map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("clamps negative index to 0", () => {
    const messages = [msg("a"), msg("b", "a"), msg("c", "a")];
    const cmap = buildChildrenMap(messages);
    const branches: ActiveBranchMap = new Map([["a", -5]]);
    const path = getActivePath(messages, cmap, branches);
    expect(path.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("handles multiple branch points", () => {
    // a → b → d (default path)
    //   └ c   └ e (branches)
    const messages = [
      msg("a"),
      msg("b", "a"), msg("c", "a"),
      msg("d", "b"), msg("e", "b"),
    ];
    const cmap = buildChildrenMap(messages);
    // Switch to branch c at a, and branch e at b
    const branches: ActiveBranchMap = new Map([["a", 1], ["b", 1]]);
    const path = getActivePath(messages, cmap, branches);
    // a → c (second child of a). c has no children, so path ends.
    // b=1 is irrelevant because we followed c, not b.
    expect(path.map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("returns empty array for empty messages", () => {
    expect(getActivePath([], new Map(), new Map())).toEqual([]);
  });

  it("handles multiple root messages (takes first by default)", () => {
    const messages = [msg("a"), msg("b")]; // both are roots
    const cmap = buildChildrenMap(messages);
    const path = getActivePath(messages, cmap, new Map());
    expect(path.map((m) => m.id)).toEqual(["a"]);
  });

  it("can select second root message via active branch", () => {
    const messages = [msg("a"), msg("b")];
    const cmap = buildChildrenMap(messages);
    const branches: ActiveBranchMap = new Map([[ROOT_PARENT, 1]]);
    const path = getActivePath(messages, cmap, branches);
    expect(path.map((m) => m.id)).toEqual(["b"]);
  });
});

// ── getBranchInfo ─────────────────────────────────────────────────────────────

describe("getBranchInfo", () => {
  it("returns null for messages with no siblings", () => {
    const messages = [msg("a"), msg("b", "a")];
    const cmap = buildChildrenMap(messages);
    expect(getBranchInfo(messages[1], cmap)).toBeNull();
  });

  it("returns branch info for messages with siblings", () => {
    const messages = [msg("a"), msg("b", "a"), msg("c", "a"), msg("d", "a")];
    const cmap = buildChildrenMap(messages);

    const infoB = getBranchInfo(messages[1], cmap);
    expect(infoB).toEqual({ currentIndex: 0, totalBranches: 3, parentId: "a" });

    const infoC = getBranchInfo(messages[2], cmap);
    expect(infoC).toEqual({ currentIndex: 1, totalBranches: 3, parentId: "a" });

    const infoD = getBranchInfo(messages[3], cmap);
    expect(infoD).toEqual({ currentIndex: 2, totalBranches: 3, parentId: "a" });
  });

  it("returns null for root messages with no siblings", () => {
    const messages = [msg("a")];
    const cmap = buildChildrenMap(messages);
    expect(getBranchInfo(messages[0], cmap)).toBeNull();
  });

  it("returns branch info for root messages with siblings", () => {
    const messages = [msg("a"), msg("b")]; // both roots
    const cmap = buildChildrenMap(messages);
    const info = getBranchInfo(messages[0], cmap);
    expect(info).toEqual({ currentIndex: 0, totalBranches: 2, parentId: ROOT_PARENT });
  });

  it("returns null for unknown message", () => {
    const cmap = buildChildrenMap([msg("a")]);
    expect(getBranchInfo(msg("unknown"), cmap)).toBeNull();
  });
});

// ── serialize/deserialize ─────────────────────────────────────────────────────

describe("serializeActiveBranches", () => {
  it("omits zero-value entries", () => {
    const map: ActiveBranchMap = new Map([["a", 0], ["b", 2], ["c", 0]]);
    expect(serializeActiveBranches(map)).toEqual({ b: 2 });
  });

  it("returns empty object for empty map", () => {
    expect(serializeActiveBranches(new Map())).toEqual({});
  });

  it("returns empty object for all-zero map", () => {
    const map: ActiveBranchMap = new Map([["a", 0]]);
    expect(serializeActiveBranches(map)).toEqual({});
  });
});

describe("deserializeActiveBranches", () => {
  it("creates map from object", () => {
    const map = deserializeActiveBranches({ a: 1, b: 3 });
    expect(map.get("a")).toBe(1);
    expect(map.get("b")).toBe(3);
    expect(map.size).toBe(2);
  });

  it("returns empty map for undefined", () => {
    expect(deserializeActiveBranches(undefined).size).toBe(0);
  });

  it("returns empty map for empty object", () => {
    expect(deserializeActiveBranches({}).size).toBe(0);
  });

  it("roundtrips with serialize", () => {
    const original: ActiveBranchMap = new Map([["x", 5], ["y", 0], ["z", 2]]);
    const serialized = serializeActiveBranches(original);
    const deserialized = deserializeActiveBranches(serialized);
    // y was 0 so it was dropped during serialization — deserialize defaults to 0
    expect(deserialized.get("x")).toBe(5);
    expect(deserialized.get("z")).toBe(2);
    expect(deserialized.has("y")).toBe(false); // dropped (default 0)
  });
});

// ── Realistic conversation branching scenarios ────────────────────────────────

describe("realistic branching scenarios", () => {
  it("models a user retrying a question", () => {
    // user1 → assistant1 → user2 → assistant2
    //                     └ user3 → assistant3  (retry)
    const messages = [
      msg("u1", undefined, "user"),
      msg("a1", "u1", "assistant"),
      msg("u2", "a1", "user"),       // original question
      msg("a2", "u2", "assistant"),
      msg("u3", "a1", "user"),       // retry (branch from assistant1)
      msg("a3", "u3", "assistant"),
    ];
    const cmap = buildChildrenMap(messages);

    // Default path: u1 → a1 → u2 → a2
    const path1 = getActivePath(messages, cmap, new Map());
    expect(path1.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);

    // Switch to branch: u1 → a1 → u3 → a3
    const branches: ActiveBranchMap = new Map([["a1", 1]]);
    const path2 = getActivePath(messages, cmap, branches);
    expect(path2.map((m) => m.id)).toEqual(["u1", "a1", "u3", "a3"]);

    // Branch selector on u2/u3 shows 2 branches
    expect(getBranchInfo(messages[2], cmap)).toEqual({ currentIndex: 0, totalBranches: 2, parentId: "a1" });
    expect(getBranchInfo(messages[4], cmap)).toEqual({ currentIndex: 1, totalBranches: 2, parentId: "a1" });
  });

  it("models nested branches (branch within a branch)", () => {
    // u1 → a1 → u2 → a2 → u3 → a3    (default path)
    //          └ u4 → a4 → u5 → a5    (branch at a1)
    //                     └ u6 → a6    (branch at a4 within branch at a1)
    const messages = [
      msg("u1", undefined, "user"),
      msg("a1", "u1", "assistant"),
      msg("u2", "a1", "user"), msg("a2", "u2", "assistant"),
      msg("u3", "a2", "user"), msg("a3", "u3", "assistant"),
      msg("u4", "a1", "user"), msg("a4", "u4", "assistant"),
      msg("u5", "a4", "user"), msg("a5", "u5", "assistant"),
      msg("u6", "a4", "user"), msg("a6", "u6", "assistant"),
    ];
    const cmap = buildChildrenMap(messages);

    // Switch to outer branch: a1 → u4 path
    const path1 = getActivePath(messages, cmap, new Map([["a1", 1]]));
    expect(path1.map((m) => m.id)).toEqual(["u1", "a1", "u4", "a4", "u5", "a5"]);

    // Switch to inner branch too: a4 → u6 path
    const path2 = getActivePath(messages, cmap, new Map([["a1", 1], ["a4", 1]]));
    expect(path2.map((m) => m.id)).toEqual(["u1", "a1", "u4", "a4", "u6", "a6"]);
  });

  it("handles legacy messages without parentId (linear chain)", () => {
    // Legacy messages: no parentId set
    const messages = [
      { id: "1", role: "user" as const, content: "hi", timestamp: 1 },
      { id: "2", role: "assistant" as const, content: "hello", timestamp: 2 },
    ];
    const cmap = buildChildrenMap(messages);

    // Both are roots (no parentId) — only first is selected
    const path = getActivePath(messages, cmap, new Map());
    expect(path.map((m) => m.id)).toEqual(["1"]);

    // But ROOT_PARENT has both as children
    expect(cmap.get(ROOT_PARENT)).toEqual(["1", "2"]);
  });
});
