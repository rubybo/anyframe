import { afterEach, describe, expect, it } from "vitest";
import { derived, effect, read, state } from "anyframe";

const stops: Array<() => void> = [];

afterEach(() => {
  for (const stop of stops) stop();
  stops.length = 0;
});

describe("signals", () => {
  it("notifies subscribers and skips identical values", () => {
    const count = state(0);
    const seen: number[] = [];
    const stop = count.subscribe((value) => seen.push(value));
    stops.push(stop);
    count(1);
    count(1);
    count(2);
    stop();
    count(3);
    expect(seen).toEqual([1, 2]);
    expect(count()).toBe(3);
    count.set(4);
    expect(count.get()).toBe(4);
  });

  it("updates derived signals from their sources", () => {
    const width = state(2);
    const height = state(3);
    const area = derived(() => width() * height());
    expect(area()).toBe(6);
    const seen: number[] = [];
    const stop = area.subscribe((value) => seen.push(value));
    stops.push(stop);
    width(4);
    expect(area()).toBe(12);
    expect(seen).toEqual([12]);
    expect(() => area(1)).toThrow(/derived/);
    expect(() => area.set(1)).toThrow(/derived/);
  });

  it("runs effects, reruns on change, and calls cleanup", () => {
    const count = state(0);
    const log: string[] = [];
    const stop = effect(() => {
      count();
      log.push("run");
      return () => log.push("cleanup");
    });
    expect(log).toEqual(["run"]);
    count(1);
    expect(log).toEqual(["run", "cleanup", "run"]);
    stop();
    count(2);
    expect(log).toEqual(["run", "cleanup", "run", "cleanup"]);
  });

  it("reads signals inside effects and returns plain values unchanged", () => {
    const count = state(1);
    let seen = 0;
    stops.push(effect(() => {
      seen = read(count);
    }));
    expect(seen).toBe(1);
    count(5);
    expect(seen).toBe(5);
    expect(read(7)).toBe(7);
    expect(read("task")).toBe("task");
  });
});
