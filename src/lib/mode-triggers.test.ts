import { describe, it, expect } from "vitest";
import { suggestMode, detectMode } from "./mode-triggers";

describe("detectMode", () => {
  it("returns direct for short messages", () => {
    expect(detectMode("hello")).toBe("direct");
    expect(detectMode("fix the bug")).toBe("direct");
  });

  it("detects researcher mode for research queries with strong signals", () => {
    // Multiple researcher triggers must fire to exceed threshold
    expect(detectMode("research and do a comprehensive analysis of AI agent frameworks")).toBe("researcher");
    expect(detectMode("compare React vs Vue — a deep dive into the pros and cons")).toBe("researcher");
    expect(detectMode("what are the best practices and current state of the art in API design")).toBe("researcher");
    expect(detectMode("do a comprehensive in-depth analysis of the payment gateway market")).toBe("researcher");
  });

  it("detects commander mode for multi-step implementation tasks with strong signals", () => {
    // Multiple commander triggers must fire to exceed threshold
    expect(detectMode("build me a REST API and implement authentication with database setup")).toBe("commander");
    expect(detectMode("create a full project and set up the CI/CD pipeline with Docker")).toBe("commander");
    expect(detectMode("refactor the entire codebase and migrate everything to TypeScript")).toBe("commander");
    expect(detectMode("build me a complete app, scaffold the project, and generate the tests")).toBe("commander");
  });

  it("returns direct when no strong signals", () => {
    expect(detectMode("what does this error mean in my code")).toBe("direct");
    expect(detectMode("explain how closures work in JavaScript")).toBe("direct");
    expect(detectMode("fix the typo on line 42 of the readme file")).toBe("direct");
  });

  it("picks the strongest signal when both modes match", () => {
    // "research" + "implement" — research should win if it has more matches
    const result = detectMode("research and implement a comprehensive caching system");
    expect(["commander", "researcher"]).toContain(result);
  });
});

describe("suggestMode", () => {
  it("returns null for short messages", () => {
    expect(suggestMode("hi", "direct")).toBeNull();
  });

  it("returns null when already in the suggested mode", () => {
    expect(suggestMode("research the latest AI frameworks in depth", "researcher")).toBeNull();
  });

  it("suggests researcher when in direct mode with research query", () => {
    const result = suggestMode("research the latest AI frameworks in depth", "direct");
    expect(result).not.toBeNull();
    expect(result!.mode).toBe("researcher");
  });

  it("suggests commander when in direct mode with implementation query", () => {
    const result = suggestMode("build me a complete REST API with authentication", "direct");
    expect(result).not.toBeNull();
    expect(result!.mode).toBe("commander");
  });

  it("returns null when in auto mode (auto handles it)", () => {
    expect(suggestMode("research the latest AI frameworks", "auto")).toBeNull();
    expect(suggestMode("build me a REST API project", "auto")).toBeNull();
  });
});
