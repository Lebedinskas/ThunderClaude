import type { ChatMessage } from "./claude-protocol";

/** Sentinel parent ID for root-level messages (no parent). */
export const ROOT_PARENT = "__root__";

/** Map from parentId → ordered child message IDs. */
export type ChildrenMap = Map<string, string[]>;

/** Map from parentId → 0-based index of the active child. */
export type ActiveBranchMap = Map<string, number>;

/** Branch info for a message that has siblings. */
export interface BranchInfo {
  currentIndex: number;
  totalBranches: number;
  parentId: string;
}

/**
 * Build a map of parent → children from a flat list of tree-structured messages.
 * Messages without parentId are children of ROOT_PARENT.
 */
export function buildChildrenMap(messages: ChatMessage[]): ChildrenMap {
  const children = new Map<string, string[]>();
  for (const msg of messages) {
    const parent = msg.parentId ?? ROOT_PARENT;
    const list = children.get(parent);
    if (list) {
      list.push(msg.id);
    } else {
      children.set(parent, [msg.id]);
    }
  }
  return children;
}

/**
 * Walk the tree from root, following active branch choices,
 * to produce the currently-visible linear message path.
 */
export function getActivePath(
  allMessages: ChatMessage[],
  children: ChildrenMap,
  activeBranch: ActiveBranchMap,
): ChatMessage[] {
  const byId = new Map(allMessages.map((m) => [m.id, m]));
  const path: ChatMessage[] = [];
  let currentParent = ROOT_PARENT;

  while (true) {
    const childIds = children.get(currentParent);
    if (!childIds || childIds.length === 0) break;

    const activeIndex = activeBranch.get(currentParent) ?? 0;
    const clampedIndex = Math.min(
      Math.max(0, activeIndex),
      childIds.length - 1,
    );
    const childId = childIds[clampedIndex];
    const child = byId.get(childId);
    if (!child) break;

    path.push(child);
    currentParent = child.id;
  }

  return path;
}

/**
 * Get branch info for a message (how many siblings, which one is active).
 * Returns null if the message has no siblings.
 */
export function getBranchInfo(
  message: ChatMessage,
  children: ChildrenMap,
): BranchInfo | null {
  const parentId = message.parentId ?? ROOT_PARENT;
  const siblings = children.get(parentId);
  if (!siblings || siblings.length <= 1) return null;

  const currentIndex = siblings.indexOf(message.id);
  if (currentIndex === -1) return null;

  return {
    currentIndex,
    totalBranches: siblings.length,
    parentId,
  };
}

/**
 * Serialize an ActiveBranchMap for JSON storage.
 * Only stores non-zero entries (zero is the default).
 */
export function serializeActiveBranches(
  activeBranch: ActiveBranchMap,
): Record<string, number> {
  const obj: Record<string, number> = {};
  for (const [key, value] of activeBranch) {
    if (value !== 0) obj[key] = value;
  }
  return obj;
}

/**
 * Deserialize an ActiveBranchMap from JSON storage.
 */
export function deserializeActiveBranches(
  obj?: Record<string, number>,
): ActiveBranchMap {
  const map = new Map<string, number>();
  if (obj) {
    for (const [key, value] of Object.entries(obj)) {
      map.set(key, value);
    }
  }
  return map;
}
