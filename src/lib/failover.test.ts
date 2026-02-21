import { describe, it, expect, beforeEach } from "vitest";
import {
  isRateLimitError,
  reportRateLimit,
  reportSuccess,
  isModelAvailable,
  getAvailableModel,
  getAvailableModelWithEngine,
  getCooldownRemaining,
  getCooldownInfo,
  getActiveCooldowns,
  clearAllCooldowns,
} from "./failover";

beforeEach(() => {
  clearAllCooldowns();
});

// ── Rate Limit Detection ────────────────────────────────────────────────────

describe("isRateLimitError", () => {
  it("detects common rate limit patterns", () => {
    expect(isRateLimitError("Error 429: Too many requests")).toBe(true);
    expect(isRateLimitError("rate_limit_exceeded")).toBe(true);
    expect(isRateLimitError("Rate limit reached")).toBe(true);
    expect(isRateLimitError("Server overloaded, please retry")).toBe(true);
    expect(isRateLimitError("Quota exceeded for model")).toBe(true);
    expect(isRateLimitError("RESOURCE_EXHAUSTED")).toBe(true);
    expect(isRateLimitError("insufficient capacity")).toBe(true);
    expect(isRateLimitError("exceeded rate limit")).toBe(true);
    expect(isRateLimitError("retry-after: 60")).toBe(true);
  });

  it("rejects non-rate-limit errors", () => {
    expect(isRateLimitError("Connection refused")).toBe(false);
    expect(isRateLimitError("Authentication failed")).toBe(false);
    expect(isRateLimitError("Invalid API key")).toBe(false);
    expect(isRateLimitError("Model not found")).toBe(false);
    expect(isRateLimitError("")).toBe(false);
  });
});

// ── Cooldown Management ─────────────────────────────────────────────────────

describe("reportRateLimit + isModelAvailable", () => {
  it("puts a model in cooldown after rate limit", () => {
    expect(isModelAvailable("claude-sonnet-4-6")).toBe(true);
    reportRateLimit("claude-sonnet-4-6");
    expect(isModelAvailable("claude-sonnet-4-6")).toBe(false);
  });

  it("has non-zero remaining after rate limit", () => {
    reportRateLimit("claude-sonnet-4-6");
    expect(getCooldownRemaining("claude-sonnet-4-6")).toBeGreaterThan(0);
  });

  it("returns cooldown info for rate-limited model", () => {
    reportRateLimit("claude-sonnet-4-6", "test reason");
    const info = getCooldownInfo("claude-sonnet-4-6");
    expect(info).not.toBeNull();
    expect(info!.model).toBe("claude-sonnet-4-6");
    expect(info!.failures).toBe(1);
    expect(info!.reason).toBe("test reason");
    expect(info!.remainingMs).toBeGreaterThan(0);
  });

  it("returns null cooldown info for available model", () => {
    expect(getCooldownInfo("claude-sonnet-4-6")).toBeNull();
  });

  it("tracks active cooldowns", () => {
    expect(getActiveCooldowns()).toHaveLength(0);
    reportRateLimit("claude-sonnet-4-6");
    reportRateLimit("gemini-2.5-pro");
    expect(getActiveCooldowns()).toHaveLength(2);
  });
});

describe("reportSuccess", () => {
  it("clears cooldown on success", () => {
    reportRateLimit("claude-sonnet-4-6");
    expect(isModelAvailable("claude-sonnet-4-6")).toBe(false);
    reportSuccess("claude-sonnet-4-6");
    expect(isModelAvailable("claude-sonnet-4-6")).toBe(true);
  });

  it("is a no-op for models not in cooldown", () => {
    reportSuccess("claude-sonnet-4-6"); // Should not throw
    expect(isModelAvailable("claude-sonnet-4-6")).toBe(true);
  });
});

describe("exponential backoff", () => {
  it("escalates cooldown with consecutive failures", () => {
    reportRateLimit("claude-sonnet-4-6");
    const first = getCooldownRemaining("claude-sonnet-4-6");

    reportRateLimit("claude-sonnet-4-6");
    const second = getCooldownRemaining("claude-sonnet-4-6");

    // Second cooldown should be longer than first
    expect(second).toBeGreaterThan(first);
  });

  it("tracks failure count correctly", () => {
    reportRateLimit("claude-sonnet-4-6");
    expect(getCooldownInfo("claude-sonnet-4-6")!.failures).toBe(1);

    reportRateLimit("claude-sonnet-4-6");
    expect(getCooldownInfo("claude-sonnet-4-6")!.failures).toBe(2);

    reportRateLimit("claude-sonnet-4-6");
    expect(getCooldownInfo("claude-sonnet-4-6")!.failures).toBe(3);
  });

  it("caps backoff at maximum", () => {
    // Apply 10 consecutive failures — should not exceed max backoff
    for (let i = 0; i < 10; i++) {
      reportRateLimit("claude-sonnet-4-6");
    }
    // Max backoff is 1 hour = 3,600,000ms
    const remaining = getCooldownRemaining("claude-sonnet-4-6");
    expect(remaining).toBeLessThanOrEqual(3_600_100); // Small margin for test timing
  });
});

describe("clearAllCooldowns", () => {
  it("clears everything", () => {
    reportRateLimit("claude-sonnet-4-6");
    reportRateLimit("gemini-2.5-pro");
    expect(getActiveCooldowns()).toHaveLength(2);

    clearAllCooldowns();
    expect(getActiveCooldowns()).toHaveLength(0);
    expect(isModelAvailable("claude-sonnet-4-6")).toBe(true);
    expect(isModelAvailable("gemini-2.5-pro")).toBe(true);
  });
});

// ── Failover Chains ─────────────────────────────────────────────────────────

describe("getAvailableModel", () => {
  it("returns preferred model when available", () => {
    expect(getAvailableModel("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("fails over to cross-provider alternative", () => {
    reportRateLimit("claude-sonnet-4-6");
    const alt = getAvailableModel("claude-sonnet-4-6");
    // Should failover to a Gemini model
    expect(alt).not.toBe("claude-sonnet-4-6");
    expect(alt).toMatch(/^gemini/);
  });

  it("walks the failover chain when multiple models are rate-limited", () => {
    reportRateLimit("claude-sonnet-4-6");
    reportRateLimit("gemini-3-flash-preview"); // First in chain
    const alt = getAvailableModel("claude-sonnet-4-6");
    // Should skip to next available in chain
    expect(alt).not.toBe("claude-sonnet-4-6");
    expect(alt).not.toBe("gemini-3-flash-preview");
  });

  it("returns something even when all models are rate-limited", () => {
    // Rate-limit everything — should still return a model (the one with shortest cooldown)
    reportRateLimit("claude-sonnet-4-6");
    reportRateLimit("gemini-3-flash-preview");
    reportRateLimit("gemini-2.5-pro");
    reportRateLimit("claude-sonnet-4-5-20250929");
    const result = getAvailableModel("claude-sonnet-4-6");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles models without a failover chain", () => {
    reportRateLimit("some-unknown-model");
    // Should return the preferred model itself since no chain exists
    expect(getAvailableModel("some-unknown-model" as any)).toBe("some-unknown-model");
  });
});

describe("getAvailableModelWithEngine", () => {
  it("returns correct engine for Claude models", () => {
    const result = getAvailableModelWithEngine("claude-sonnet-4-6");
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.engine).toBe("claude");
    expect(result.wasFailover).toBe(false);
  });

  it("returns correct engine for Gemini models", () => {
    const result = getAvailableModelWithEngine("gemini-2.5-pro");
    expect(result.model).toBe("gemini-2.5-pro");
    expect(result.engine).toBe("gemini");
    expect(result.wasFailover).toBe(false);
  });

  it("flags failover and returns correct cross-provider engine", () => {
    reportRateLimit("claude-sonnet-4-6");
    const result = getAvailableModelWithEngine("claude-sonnet-4-6");
    expect(result.wasFailover).toBe(true);
    // Should have switched to Gemini engine
    expect(result.engine).toBe("gemini");
    expect(result.model).toMatch(/^gemini/);
  });
});
