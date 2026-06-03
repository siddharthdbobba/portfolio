// tests/worldcup-data.test.ts
import { describe, it, expect } from "vitest";
import { loadSnapshot, isEmptySnapshot } from "../src/lib/worldcup-data";

describe("loadSnapshot", () => {
  it("returns a snapshot object with the expected shape", () => {
    const { snapshot } = loadSnapshot();
    expect(snapshot).toHaveProperty("meta");
    expect(snapshot).toHaveProperty("forecasts");
    expect(Array.isArray(snapshot.forecasts)).toBe(true);
  });

  it("flags an empty (sample) snapshot via isEmptySnapshot", () => {
    const { snapshot } = loadSnapshot();
    // In the test environment the real file may be absent => sample => empty.
    expect(typeof isEmptySnapshot(snapshot)).toBe("boolean");
    expect(isEmptySnapshot({ ...snapshot, forecasts: [] })).toBe(true);
  });
});
