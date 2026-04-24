import { describe, expect, it } from "vitest";
import { UnitType } from "../../src/core/game/Game";
import { EconomyAdvisorEngine } from "../../src/client/advisor/EconomyAdvisorEngine";

function mockUnit(
  type: UnitType,
  tile: number,
  readiness = 1,
  level = 1,
): {
  type: () => UnitType;
  tile: () => number;
  level: () => number;
  isActive: () => boolean;
  isUnderConstruction: () => boolean;
  missileReadinesss: () => number;
} {
  return {
    type: () => type,
    tile: () => tile,
    level: () => level,
    isActive: () => true,
    isUnderConstruction: () => false,
    missileReadinesss: () => readiness,
  };
}

function mockPlayer(params: {
  id: number;
  name: string;
  gold: number;
  troops: number;
  tiles: number;
  friendlyIds?: number[];
  units?: ReturnType<typeof mockUnit>[];
}) {
  return {
    smallID: () => params.id,
    displayName: () => params.name,
    gold: () => BigInt(params.gold),
    troops: () => params.troops,
    numTilesOwned: () => params.tiles,
    isAlive: () => true,
    hasSpawned: () => true,
    nameLocation: () => ({ x: params.id * 20, y: params.id * 15 }),
    isFriendly: (other: { smallID: () => number }) =>
      (params.friendlyIds ?? []).includes(other.smallID()),
    units: (...types: UnitType[]) =>
      (params.units ?? []).filter((unit) => types.includes(unit.type())),
  };
}

describe("EconomyAdvisorEngine", () => {
  it("flags critical missile risk and prefers build action", () => {
    const my = mockPlayer({
      id: 1,
      name: "me",
      gold: 300_000,
      troops: 6_000,
      tiles: 80,
      units: [mockUnit(UnitType.City, 15)],
    });
    const enemy = mockPlayer({
      id: 2,
      name: "enemy",
      gold: 1_200_000,
      troops: 5_500,
      tiles: 85,
      units: [mockUnit(UnitType.MissileSilo, 90, 1)],
    });

    let tick = 100;
    const game = {
      ticks: () => tick,
      myPlayer: () => my,
      players: () => [my, enemy],
      config: () => ({
        maxTroops: () => 12_000,
        SiloCooldown: () => 600,
      }),
      unitInfo: () => ({
        constructionDuration: 100,
      }),
      width: () => 200,
      height: () => 120,
      isValidCoord: () => true,
      ref: (x: number, y: number) => y * 200 + x,
      isLand: () => true,
      isShore: () => false,
      isValidRef: () => true,
      isWater: () => false,
      circleSearch: () => new Set<number>(),
      x: (tile: number) => tile,
      y: (tile: number) => tile,
      manhattanDist: (a: number, b: number) => Math.abs(a - b),
    };

    const engine = new EconomyAdvisorEngine();
    engine.update(game as any);
    tick += 10;
    const report = engine.update(game as any);

    expect(report).not.toBeNull();
    expect(report?.bestAction).toBe("build");
    expect(report?.bestBuilding).toBe("SAM Launcher");
    expect(report?.maxSafeSendPercent).toBeGreaterThan(0);
    expect(report?.targetActions.length).toBeGreaterThan(0);
    expect(report?.alerts.some((alert) => alert.urgency === "critical")).toBe(
      true,
    );
    expect(report?.samThreats[0]).toContain("gold");
  });

  it("recommends nuke when behind with ready silo and funding", () => {
    const my = mockPlayer({
      id: 1,
      name: "me",
      gold: 1_200_000,
      troops: 3_500,
      tiles: 40,
      units: [mockUnit(UnitType.MissileSilo, 10, 1)],
    });
    const enemy = mockPlayer({
      id: 2,
      name: "leader",
      gold: 3_500_000,
      troops: 10_000,
      tiles: 150,
      units: [],
    });

    let tick = 200;
    const game = {
      ticks: () => tick,
      myPlayer: () => my,
      players: () => [my, enemy],
      config: () => ({
        maxTroops: () => 12_000,
        SiloCooldown: () => 600,
      }),
      unitInfo: () => ({
        constructionDuration: 100,
      }),
      width: () => 200,
      height: () => 120,
      isValidCoord: () => true,
      ref: (x: number, y: number) => y * 200 + x,
      isLand: () => true,
      isShore: () => false,
      isValidRef: () => true,
      isWater: () => false,
      circleSearch: () => new Set<number>(),
      x: (tile: number) => tile,
      y: (tile: number) => tile,
      manhattanDist: (a: number, b: number) => Math.abs(a - b),
    };

    const engine = new EconomyAdvisorEngine();
    engine.update(game as any);
    tick += 15;
    const report = engine.update(game as any);

    expect(report).not.toBeNull();
    expect(report?.bestAction).toBe("nuke");
    expect(report?.recommendedSendPercent).toBeGreaterThanOrEqual(0);
    expect(
      report?.targetActions.some((plan) => plan.action === "strategic_strike"),
    ).toBe(true);
  });
});
