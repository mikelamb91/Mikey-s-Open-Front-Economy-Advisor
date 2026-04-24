import { UnitType } from "../../core/game/Game";
import { GameView, PlayerView, UnitView } from "../../core/game/GameView";

const ATOM_BOMB_COST = 750_000;
const HYDROGEN_BOMB_COST = 5_000_000;
const MISSILE_SILO_COST = 1_000_000;
const MIRV_BASE_COST = 25_000_000;
const ECONOMY_BUILD_TARGET = 500_000;
const APPROACHING_THRESHOLD = 0.8;

export type AdvisorAction = "build" | "attack" | "hold" | "nuke";
export type AdvisorUrgency = "info" | "warn" | "critical";

export interface AdvisorAlert {
  message: string;
  urgency: AdvisorUrgency;
}

export interface SamPlacement {
  x: number;
  y: number;
  reason: string;
}

export interface SpawnRecommendation {
  x: number;
  y: number;
  reason: string;
  strength: number;
}

export interface TargetActionRecommendation {
  action: "pressure_attack" | "contain_threat" | "eco_expand" | "strategic_strike";
  target: string;
  sendTroops: number;
  sendPercent: number;
  score: number;
  reason: string;
  targetX?: number;
  targetY?: number;
}

export interface AdvisorOverlayPoint {
  x: number;
  y: number;
  label: string;
}

export interface AdvisorOverlayRoute {
  from: AdvisorOverlayPoint;
  to: AdvisorOverlayPoint;
  label: string;
}

export interface AdvisorOverlayHints {
  attackTarget: AdvisorOverlayPoint | null;
  buildLocation: AdvisorOverlayPoint | null;
  route: AdvisorOverlayRoute | null;
  spawnCandidates: SpawnRecommendation[];
}

export interface EconomyAdvisorReport {
  bestAction: AdvisorAction;
  actionReason: string;
  recommendedSendTroops: number;
  recommendedSendPercent: number;
  maxSafeSendTroops: number;
  maxSafeSendPercent: number;
  bestBuilding: string | null;
  bestBuildingReason: string;
  enemyLeadSummary: string;
  isLeadingEconomy: boolean;
  catchUpPlan: string[];
  alerts: AdvisorAlert[];
  requiredSamLaunchers: number;
  currentSamLaunchers: number;
  samPlacements: SamPlacement[];
  samThreats: string[];
  spawnRecommendation: SpawnRecommendation | null;
  spawnCandidates: SpawnRecommendation[];
  targetActions: TargetActionRecommendation[];
  overlayHints: AdvisorOverlayHints;
}

type EconomySample = {
  tick: number;
  gold: number;
  troops: number;
  tiles: number;
};

type GrowthRate = {
  goldPerSec: number;
  troopsPerSec: number;
};

type EnemyThreat = {
  enemy: PlayerView;
  silos: UnitView[];
  bestSiloReadiness: number;
  gold: number;
  goldPerSec: number;
  hasSilo: boolean;
  missilesReadyNow: number;
  missilesReadyIn60s: number;
  atomDeployEtaSec: number;
  atomAffordableCount: number;
  hydrogenAffordableCount: number;
  mirvAffordableCount: number;
  missileReadySoon: boolean;
  hydrogenSoon: boolean;
};

export class EconomyAdvisorEngine {
  private history = new Map<number, EconomySample[]>();
  private readonly maxSamples = 45;
  private lastSpawnRecommendationTick = -1;
  private cachedSpawnRecommendation: SpawnRecommendation | null = null;
  private cachedSpawnCandidates: SpawnRecommendation[] = [];

  private formatEtaMmSs(totalSeconds: number): string {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60);
    const seconds = safeSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  update(game: GameView): EconomyAdvisorReport | null {
    const myPlayer = game.myPlayer();
    if (!myPlayer) {
      return null;
    }
    // During pre-spawn, players may not be "alive" yet. Keep advisor active so
    // spawn recommendations still render. Hide only if a spawned player is dead.
    if (!myPlayer.isAlive() && myPlayer.hasSpawned()) {
      return null;
    }

    const enemies = game
      .players()
      .filter(
        (player) =>
          player.isAlive() &&
          player.smallID() !== myPlayer.smallID() &&
          !myPlayer.isFriendly(player),
      );

    this.pushSample(myPlayer, game);
    enemies.forEach((enemy) => this.pushSample(enemy, game));

    const myGrowth = this.computeGrowth(myPlayer);
    const strongestEnemy = this.pickStrongestEnemy(enemies);
    const enemyGrowth = strongestEnemy ? this.computeGrowth(strongestEnemy) : null;

    const myStrength = this.strengthScore(myPlayer, myGrowth);
    const enemyStrength = strongestEnemy
      ? this.strengthScore(strongestEnemy, enemyGrowth)
      : 0;
    const behindRatio =
      enemyStrength > 0 ? Math.max(0, (enemyStrength - myStrength) / enemyStrength) : 0;
    const isLeadingEconomy = myStrength > 0 && myStrength >= enemyStrength;

    const threats = enemies.map((enemy) => this.computeThreat(game, enemy));
    const threatAlerts = this.computeThreatAlerts(threats);
    const topThreat = this.pickTopThreat(threats);

    const sendPlan = this.computeSendPlan(game, myPlayer, strongestEnemy, behindRatio);
    const nukeOpportunity = this.shouldRecommendNuke(myPlayer, behindRatio);
    const buildingPlan = this.pickBestBuilding(
      myPlayer,
      myGrowth,
      behindRatio,
      topThreat,
    );

    const action = this.pickAction(
      myPlayer,
      behindRatio,
      sendPlan.recommendedSendTroops,
      topThreat,
      nukeOpportunity,
    );

    const defensePlan = this.computeSamPlan(game, myPlayer, threats);

    const catchUpPlan = this.computeCatchUpPlan(
      myPlayer,
      strongestEnemy,
      behindRatio,
      sendPlan.recommendedSendTroops,
      nukeOpportunity,
    );
    const { spawnRecommendation, spawnCandidates } = this.computeSpawnRecommendations(
      game,
      myPlayer,
    );
    const targetActions = this.computeTargetActions(
      game,
      myPlayer,
      enemies,
      threats,
      strongestEnemy,
      behindRatio,
      sendPlan,
      nukeOpportunity,
    );
    const overlayHints = this.computeOverlayHints(
      game,
      myPlayer,
      targetActions,
      buildingPlan.building,
      strongestEnemy,
      spawnCandidates,
    );

    return {
      bestAction: action.bestAction,
      actionReason: action.reason,
      recommendedSendTroops: sendPlan.recommendedSendTroops,
      recommendedSendPercent: sendPlan.recommendedSendPercent,
      maxSafeSendTroops: sendPlan.maxSafeSendTroops,
      maxSafeSendPercent: sendPlan.maxSafeSendPercent,
      bestBuilding: buildingPlan.building,
      bestBuildingReason: buildingPlan.reason,
      enemyLeadSummary: this.enemyLeadSummary(
        strongestEnemy,
        myStrength,
        enemyStrength,
        isLeadingEconomy,
        behindRatio,
        myGrowth,
        enemyGrowth,
      ),
      isLeadingEconomy,
      catchUpPlan: isLeadingEconomy ? [] : catchUpPlan,
      alerts: threatAlerts,
      requiredSamLaunchers: defensePlan.requiredSamLaunchers,
      currentSamLaunchers: defensePlan.currentSamLaunchers,
      samPlacements: defensePlan.samPlacements,
      samThreats: defensePlan.samThreats,
      spawnRecommendation,
      spawnCandidates,
      targetActions,
      overlayHints,
    };
  }

  private pushSample(player: PlayerView, game: GameView): void {
    const playerId = player.smallID();
    const sample: EconomySample = {
      tick: game.ticks(),
      gold: Number(player.gold()),
      troops: player.troops(),
      tiles: player.numTilesOwned(),
    };

    const samples = this.history.get(playerId) ?? [];
    if (samples.length > 0 && samples[samples.length - 1]!.tick === sample.tick) {
      samples[samples.length - 1] = sample;
    } else {
      samples.push(sample);
      if (samples.length > this.maxSamples) {
        samples.shift();
      }
    }

    this.history.set(playerId, samples);
  }

  private computeGrowth(player: PlayerView): GrowthRate {
    const samples = this.history.get(player.smallID()) ?? [];
    if (samples.length < 2) {
      return { goldPerSec: 0, troopsPerSec: 0 };
    }
    const first = samples[0]!;
    const last = samples[samples.length - 1]!;
    const ticksDelta = Math.max(1, last.tick - first.tick);
    const secondsDelta = ticksDelta / 10;
    return {
      goldPerSec: (last.gold - first.gold) / secondsDelta,
      troopsPerSec: (last.troops - first.troops) / secondsDelta,
    };
  }

  private pluralized(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  private strengthScore(player: PlayerView, growth: GrowthRate | null): number {
    const growthScore = growth
      ? Math.max(0, growth.goldPerSec) * 12 + Math.max(0, growth.troopsPerSec) * 220
      : 0;
    return (
      Number(player.gold()) +
      player.troops() * 220 +
      player.numTilesOwned() * 2_000 +
      growthScore
    );
  }

  private pickStrongestEnemy(enemies: PlayerView[]): PlayerView | null {
    if (enemies.length === 0) {
      return null;
    }

    return enemies.reduce((best, current) => {
      const bestGold = Number(best.gold());
      const currentGold = Number(current.gold());
      const bestScore = bestGold + best.troops() * 200 + best.numTilesOwned() * 1_500;
      const currentScore =
        currentGold + current.troops() * 200 + current.numTilesOwned() * 1_500;
      return currentScore > bestScore ? current : best;
    });
  }

  private computeThreat(game: GameView, enemy: PlayerView): EnemyThreat {
    const growth = this.computeGrowth(enemy);
    const silos = enemy
      .units(UnitType.MissileSilo)
      .filter((unit) => unit.isActive() && !unit.isUnderConstruction());
    const bestSiloReadiness = silos.reduce(
      (maxReadiness, silo) => Math.max(maxReadiness, silo.missileReadinesss()),
      0,
    );

    const gold = Number(enemy.gold());
    const affordableAtomBombs = Math.floor(gold / ATOM_BOMB_COST);
    const totalSiloCapacity = silos.reduce((sum, silo) => sum + silo.level(), 0);
    const readySlotsNow = silos.reduce(
      (sum, silo) =>
        sum +
        Math.max(
          0,
          Math.min(silo.level(), Math.floor(silo.level() * silo.missileReadinesss())),
        ),
      0,
    );
    const missilesReadyNow = Math.min(affordableAtomBombs, readySlotsNow);
    const futureAffordableAtomBombs = Math.floor(
      (gold + Math.max(0, growth.goldPerSec) * 60) / ATOM_BOMB_COST,
    );
    const missilesReadyIn60s = Math.min(futureAffordableAtomBombs, totalSiloCapacity);
    const siloBuildSec = Math.ceil(
      (game.unitInfo(UnitType.MissileSilo).constructionDuration ?? 0) / 10,
    );
    const timeToGold = (targetGold: number) =>
      gold >= targetGold
        ? 0
        : Math.ceil((targetGold - gold) / Math.max(1, Math.max(0, growth.goldPerSec)));

    const readinessDelaySec = silos.length
      ? Math.ceil(
          Math.max(0, 1 - bestSiloReadiness) * (game.config().SiloCooldown() / 10),
        )
      : 0;

    const atomDeployEtaSec = silos.length
      ? missilesReadyNow > 0
        ? 0
        : Math.max(timeToGold(ATOM_BOMB_COST), readinessDelaySec)
      : timeToGold(MISSILE_SILO_COST + ATOM_BOMB_COST) + siloBuildSec;

    const availableAfterSilo = Math.max(0, gold - (silos.length > 0 ? 0 : MISSILE_SILO_COST));
    const atomAffordableCount = Math.floor(availableAfterSilo / ATOM_BOMB_COST);
    const hydrogenAffordableCount = Math.floor(availableAfterSilo / HYDROGEN_BOMB_COST);
    const mirvAffordableCount = Math.floor(availableAfterSilo / MIRV_BASE_COST);

    return {
      enemy,
      silos,
      bestSiloReadiness,
      gold,
      goldPerSec: growth.goldPerSec,
      hasSilo: silos.length > 0,
      missilesReadyNow,
      missilesReadyIn60s,
      atomDeployEtaSec,
      atomAffordableCount,
      hydrogenAffordableCount,
      mirvAffordableCount,
      missileReadySoon:
        silos.length > 0 &&
        bestSiloReadiness >= 0.7 &&
        gold >= ATOM_BOMB_COST * APPROACHING_THRESHOLD,
      hydrogenSoon: gold >= HYDROGEN_BOMB_COST * APPROACHING_THRESHOLD,
    };
  }

  private computeThreatAlerts(threats: EnemyThreat[]): AdvisorAlert[] {
    const alerts: AdvisorAlert[] = [];

    for (const threat of threats) {
      const enemyName = threat.enemy.displayName();
      if (threat.atomDeployEtaSec > 0 && threat.atomDeployEtaSec <= 5 * 60) {
        alerts.push({
          urgency: threat.atomDeployEtaSec <= 120 ? "critical" : "warn",
          message: `${enemyName} is approaching Atom Bomb affordability and could deploy in ${this.formatEtaMmSs(
            threat.atomDeployEtaSec,
          )}.`,
        });
      }

      if (threat.hasSilo && threat.gold >= ATOM_BOMB_COST && threat.bestSiloReadiness >= 0.9) {
        alerts.push({
          urgency: "critical",
          message: `${enemyName} can launch a missile now. Prioritize SAM and split key assets.`,
        });
      } else if (threat.missileReadySoon) {
        alerts.push({
          urgency: "warn",
          message: `${enemyName} is close to missile launch readiness. Prepare SAM coverage immediately.`,
        });
      }

      if (threat.hydrogenSoon) {
        alerts.push({
          urgency: threat.gold >= HYDROGEN_BOMB_COST ? "critical" : "warn",
          message: `${enemyName} is approaching Hydrogen Bomb funding levels.`,
        });
      }
    }

    return alerts.slice(0, 5);
  }

  private pickTopThreat(threats: EnemyThreat[]): EnemyThreat | null {
    if (threats.length === 0) {
      return null;
    }
    return threats.reduce((best, current) => {
      const bestScore =
        best.gold +
        best.silos.length * 1_000_000 +
        best.bestSiloReadiness * 1_000_000;
      const currentScore =
        current.gold +
        current.silos.length * 1_000_000 +
        current.bestSiloReadiness * 1_000_000;
      return currentScore > bestScore ? current : best;
    });
  }

  private computeSendPlan(
    game: GameView,
    myPlayer: PlayerView,
    strongestEnemy: PlayerView | null,
    behindRatio: number,
  ): {
    maxSafeSendTroops: number;
    maxSafeSendPercent: number;
    recommendedSendTroops: number;
    recommendedSendPercent: number;
  } {
    const myTroops = myPlayer.troops();
    const maxTroops = game.config().maxTroops(myPlayer);
    const enemyTroops = strongestEnemy?.troops() ?? 0;

    const reserveFromCap = Math.floor(maxTroops * 0.35);
    const reserveFromThreat = Math.floor(enemyTroops * 0.4);
    const reserveFromCurrent = Math.floor(myTroops * 0.2);
    const reserve = Math.max(200, reserveFromCap, reserveFromThreat, reserveFromCurrent);
    const maxSafeSendTroops = Math.max(0, myTroops - reserve);

    const aggressionFactor = behindRatio > 0.25 ? 0.9 : 0.65;
    const recommendedSendTroops = Math.max(
      0,
      Math.floor(maxSafeSendTroops * aggressionFactor),
    );
    const maxSafeSendPercent =
      myTroops > 0 ? Math.min(100, Math.round((maxSafeSendTroops / myTroops) * 100)) : 0;
    const recommendedSendPercent =
      myTroops > 0
        ? Math.min(100, Math.round((recommendedSendTroops / myTroops) * 100))
        : 0;

    return {
      maxSafeSendTroops,
      maxSafeSendPercent,
      recommendedSendTroops,
      recommendedSendPercent,
    };
  }

  private pickBestBuilding(
    myPlayer: PlayerView,
    myGrowth: GrowthRate,
    behindRatio: number,
    topThreat: EnemyThreat | null,
  ): { building: string | null; reason: string } {
    const gold = Number(myPlayer.gold());
    const hasSilo = myPlayer
      .units(UnitType.MissileSilo)
      .some((unit) => unit.isActive() && !unit.isUnderConstruction());

    if (
      topThreat &&
      topThreat.hasSilo &&
      (topThreat.missilesReadyNow > 0 || topThreat.bestSiloReadiness >= 0.7)
    ) {
      return {
        building: "SAM Launcher",
        reason:
          "Best build now is SAM Launcher because enemy missile pressure is high.",
      };
    }

    if (!hasSilo && behindRatio >= 0.3 && gold >= MISSILE_SILO_COST) {
      return {
        building: "Missile Silo",
        reason:
          "You are behind and can afford strategic deterrence. Building a silo opens comeback pressure.",
      };
    }

    if (gold >= 125_000) {
      if (myGrowth.goldPerSec < 1.5) {
        return {
          building: "City",
          reason:
            "Your gold slope is low. A City is the best economy scaling build right now.",
        };
      }
      return {
        building: "Factory",
        reason:
          "You can sustain upgrades; Factory is best for stronger force conversion and map tempo.",
      };
    }

    return {
      building: null,
      reason:
        "Not enough gold for a high-impact structure yet. Keep stabilizing income and map control.",
    };
  }

  private shouldRecommendNuke(myPlayer: PlayerView, behindRatio: number): boolean {
    const readySilo = myPlayer
      .units(UnitType.MissileSilo)
      .some((silo) => silo.isActive() && !silo.isUnderConstruction() && silo.missileReadinesss() >= 0.9);
    return readySilo && Number(myPlayer.gold()) >= ATOM_BOMB_COST && behindRatio >= 0.3;
  }

  private pickAction(
    myPlayer: PlayerView,
    behindRatio: number,
    recommendedSendTroops: number,
    topThreat: EnemyThreat | null,
    nukeOpportunity: boolean,
  ): { bestAction: AdvisorAction; reason: string } {
    const highThreat =
      topThreat !== null &&
      topThreat.hasSilo &&
      topThreat.bestSiloReadiness >= 0.8 &&
      topThreat.gold >= ATOM_BOMB_COST * APPROACHING_THRESHOLD;

    if (highThreat) {
      return {
        bestAction: "build",
        reason:
          "Missile threat is high. Build SAM coverage and preserve economy before over-extending.",
      };
    }

    if (nukeOpportunity) {
      return {
        bestAction: "nuke",
        reason:
          "You are behind and have a ready silo with funding. A precision nuke can reset enemy momentum.",
      };
    }

    if (behindRatio > 0.2 && recommendedSendTroops > 0) {
      return {
        bestAction: "attack",
        reason:
          "You are behind on economy strength. Pressure a high-value enemy target while maintaining growth reserve.",
      };
    }

    if (Number(myPlayer.gold()) >= ECONOMY_BUILD_TARGET) {
      return {
        bestAction: "build",
        reason:
          "Current funding supports stronger long-term scaling. Add economy structures before forcing fights.",
      };
    }

    return {
      bestAction: "hold",
      reason:
        "Stabilize troop growth and watch enemy timing windows before committing major resources.",
    };
  }

  private computeCatchUpPlan(
    myPlayer: PlayerView,
    strongestEnemy: PlayerView | null,
    behindRatio: number,
    recommendedSendTroops: number,
    nukeOpportunity: boolean,
  ): string[] {
    if (behindRatio < 0.05) {
      return [
        "You are not materially behind. Keep scaling and deny enemy trade routes.",
        "Keep troop reserve above one-third of cap to stay safe against surprise attacks.",
      ];
    }

    const targetName = strongestEnemy?.displayName() ?? "the leading enemy";
    const plan: string[] = [
      "Prioritize economy first: chain city/factory upgrades until income stabilizes.",
    ];

    if (recommendedSendTroops > 0) {
      plan.push(
        `Send about ${Math.floor(recommendedSendTroops / 10)} troops pressure toward ${targetName} to slow their growth.`,
      );
    }

    if (nukeOpportunity) {
      plan.push("Nuke option is viable now if a high-value enemy cluster is exposed.");
    } else {
      plan.push("Delay nuclear spend unless enemy lead grows or a guaranteed strike opens.");
    }

    return plan.slice(0, 3);
  }

  private enemyLeadSummary(
    strongestEnemy: PlayerView | null,
    myStrength: number,
    enemyStrength: number,
    isLeadingEconomy: boolean,
    behindRatio: number,
    myGrowth: GrowthRate,
    enemyGrowth: GrowthRate | null,
  ): string {
    if (!strongestEnemy) {
      return "No hostile economy signal detected.";
    }

    const leadRatio =
      myStrength > 0 ? Math.max(0, (myStrength - enemyStrength) / myStrength) : 0;
    const diffPercent = Math.round(
      (isLeadingEconomy ? leadRatio : behindRatio) * 100,
    );
    const enemyGoldPerSec = enemyGrowth ? Math.max(0, enemyGrowth.goldPerSec) : 0;
    const myGoldPerSec = Math.max(0, myGrowth.goldPerSec);
    if (isLeadingEconomy) {
      return `You lead economy by about ${diffPercent}% over ${strongestEnemy.displayName()}. Gold trend: you ${myGoldPerSec.toFixed(
        1,
      )}/s vs #2 ${enemyGoldPerSec.toFixed(1)}/s.`;
    }
    return `${strongestEnemy.displayName()} leads by about ${diffPercent}%. Gold trend: you ${myGoldPerSec.toFixed(
      1,
    )}/s vs enemy ${enemyGoldPerSec.toFixed(1)}/s.`;
  }

  private computeSamPlan(
    game: GameView,
    myPlayer: PlayerView,
    threats: EnemyThreat[],
  ): {
    requiredSamLaunchers: number;
    currentSamLaunchers: number;
    samPlacements: SamPlacement[];
    samThreats: string[];
  } {
    const currentSamLaunchers = myPlayer
      .units(UnitType.SAMLauncher)
      .filter((unit) => unit.isActive() && !unit.isUnderConstruction()).length;

    const enemySiloUnits = threats.flatMap((threat) => threat.silos);
    const hydrogenThreatCount = threats.filter((threat) => threat.hydrogenSoon).length;
    const readySiloCount = threats.filter(
      (threat) => threat.bestSiloReadiness >= 0.7 && threat.hasSilo,
    ).length;
    const requiredSamLaunchers = Math.max(
      1,
      Math.ceil(readySiloCount * 1.5 + hydrogenThreatCount * 0.75),
    );

    const highValueUnits = myPlayer
      .units(UnitType.City, UnitType.Factory, UnitType.MissileSilo)
      .filter((unit) => unit.isActive() && !unit.isUnderConstruction());

    const placements: SamPlacement[] = highValueUnits
      .map((unit) => {
        const minDist = enemySiloUnits.reduce((closest, enemySilo) => {
          const dist = game.manhattanDist(unit.tile(), enemySilo.tile());
          return Math.min(closest, dist);
        }, Number.POSITIVE_INFINITY);

        let reason = "Protect economy cluster.";
        if (unit.type() === UnitType.MissileSilo) {
          reason = "Protect your silo from counter-strike.";
        } else if (minDist < 90) {
          reason = "Forward defense near likely missile path.";
        }

        return {
          x: game.x(unit.tile()),
          y: game.y(unit.tile()),
          score: (unit.type() === UnitType.MissileSilo ? 3 : 2) + 1 / (minDist + 1),
          reason,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map(({ x, y, reason }) => ({ x, y, reason }));

    const samThreats = threats
      .map((threat) => {
        const name = threat.enemy.displayName();
        const atomEta =
          threat.atomDeployEtaSec === 0
            ? "Atom deploy now"
            : `Atom deploy ETA ${this.formatEtaMmSs(threat.atomDeployEtaSec)}`;
        const atomText = this.pluralized(
          threat.atomAffordableCount,
          "Atom Bomb",
          "Atom Bombs",
        );
        const hydrogenText = this.pluralized(
          threat.hydrogenAffordableCount,
          "Hydrogen Bomb",
          "Hydrogen Bombs",
        );
        const mirvText = this.pluralized(threat.mirvAffordableCount, "MIRV", "MIRVs");
        const missileNow = threat.missilesReadyNow;
        const missileSoon = threat.missilesReadyIn60s;
        return `${name}: gold ${threat.gold.toLocaleString()}, missiles now ${missileNow}, missiles in 60s ${missileSoon}, ${atomText}, ${hydrogenText}, ${mirvText}, ${atomEta}.`;
      })
      .sort((a, b) => b.length - a.length)
      .slice(0, 4);

    return {
      requiredSamLaunchers,
      currentSamLaunchers,
      samPlacements: placements,
      samThreats,
    };
  }

  private computeTargetActions(
    game: GameView,
    myPlayer: PlayerView,
    enemies: PlayerView[],
    threats: EnemyThreat[],
    strongestEnemy: PlayerView | null,
    behindRatio: number,
    sendPlan: {
      maxSafeSendTroops: number;
      maxSafeSendPercent: number;
      recommendedSendTroops: number;
      recommendedSendPercent: number;
    },
    nukeOpportunity: boolean,
  ): TargetActionRecommendation[] {
    const myTroops = myPlayer.troops();
    const threatByEnemyId = new Map<number, EnemyThreat>(
      threats.map((threat) => [threat.enemy.smallID(), threat]),
    );

    const enemyPlans = enemies.map((enemy) => {
      const threat = threatByEnemyId.get(enemy.smallID()) ?? null;
      const growth = this.computeGrowth(enemy);
      const economicValue =
        Number(enemy.gold()) / 100_000 +
        enemy.numTilesOwned() * 0.8 +
        Math.max(0, growth.goldPerSec) * 6;
      const militaryPressure = enemy.troops() / Math.max(1, myTroops);
      const strategicRisk =
        threat === null
          ? 0
          : threat.missilesReadyNow * 4 +
            threat.hydrogenAffordableCount * 2 +
            (threat.atomDeployEtaSec <= 90 ? 2 : 0);
      const score = economicValue + militaryPressure * 4 + strategicRisk;

      const desiredPressurePercent = Math.min(
        sendPlan.maxSafeSendPercent,
        Math.max(
          15,
          Math.round(sendPlan.recommendedSendPercent * (1 + strategicRisk / 8)),
        ),
      );
      const sendTroops = Math.min(
        sendPlan.maxSafeSendTroops,
        Math.max(0, Math.floor((myTroops * desiredPressurePercent) / 100)),
      );

      const reasonParts = [
        `economy value ${economicValue.toFixed(1)}`,
        `military pressure x${militaryPressure.toFixed(2)}`,
      ];
      if (strategicRisk > 0) {
        reasonParts.push(`strategic risk ${strategicRisk.toFixed(1)}`);
      }

      return {
        action:
          strategicRisk >= 3
            ? ("contain_threat" as const)
            : ("pressure_attack" as const),
        target: enemy.displayName(),
        sendTroops,
        sendPercent: desiredPressurePercent,
        score,
        reason: reasonParts.join(", "),
        targetX: enemy.nameLocation().x,
        targetY: enemy.nameLocation().y,
      };
    });

    enemyPlans.sort((a, b) => b.score - a.score);
    const topEnemyPlans = enemyPlans.slice(0, 2);

    const plans: TargetActionRecommendation[] = [...topEnemyPlans];

    const ecoExpandScore = (1 - Math.min(1, behindRatio + 0.1)) * 10;
    plans.push({
      action: "eco_expand",
      target: "Own economy core",
      sendTroops: 0,
      sendPercent: 0,
      score: ecoExpandScore,
      reason:
        Number(myPlayer.gold()) >= ECONOMY_BUILD_TARGET
          ? "Convert current gold into City/Factory upgrades for sustained growth."
          : "Build economy first while preserving troop reserve before committing.",
    });

    if (nukeOpportunity && strongestEnemy) {
      plans.push({
        action: "strategic_strike",
        target: strongestEnemy.displayName(),
        sendTroops: 0,
        sendPercent: 0,
        score: 15,
        reason:
          "Ready silo plus funding available. Strategic strike can reset top enemy momentum.",
      });
    }

    plans.sort((a, b) => b.score - a.score);
    return plans.slice(0, 3);
  }

  private computeOverlayHints(
    game: GameView,
    myPlayer: PlayerView,
    targetActions: TargetActionRecommendation[],
    bestBuilding: string | null,
    strongestEnemy: PlayerView | null,
    spawnCandidates: SpawnRecommendation[],
  ): AdvisorOverlayHints {
    const myCenter = myPlayer.nameLocation();
    const attackPlan = targetActions.find((plan) => plan.sendTroops > 0);
    const attackTarget =
      attackPlan &&
      attackPlan.targetX !== undefined &&
      attackPlan.targetY !== undefined
        ? {
            x: attackPlan.targetX,
            y: attackPlan.targetY,
            label: `${attackPlan.target} (${attackPlan.sendPercent}%)`,
          }
        : strongestEnemy
          ? {
              x: strongestEnemy.nameLocation().x,
              y: strongestEnemy.nameLocation().y,
              label: strongestEnemy.displayName(),
            }
          : null;

    const buildLocation = this.computeBuildOverlayPoint(game, myPlayer, bestBuilding);
    const route =
      attackTarget !== null
        ? {
            from: {
              x: myCenter.x,
              y: myCenter.y,
              label: "Your core",
            },
            to: attackTarget,
            label: "Recommended pressure route",
          }
        : null;

    return {
      attackTarget,
      buildLocation,
      route,
      spawnCandidates,
    };
  }

  private computeBuildOverlayPoint(
    game: GameView,
    myPlayer: PlayerView,
    bestBuilding: string | null,
  ): AdvisorOverlayPoint | null {
    if (!bestBuilding) {
      return null;
    }

    const center = myPlayer.nameLocation();
    const centerX = Math.max(0, Math.min(game.width() - 1, Math.round(center.x)));
    const centerY = Math.max(0, Math.min(game.height() - 1, Math.round(center.y)));
    const centerTile = game.ref(centerX, centerY);

    const searchTiles = Array.from(
      game.circleSearch(centerTile, 24, (tile) => game.isValidRef(tile)),
    );
    if (searchTiles.length === 0) {
      return null;
    }

    const wantsPort = bestBuilding.toLowerCase().includes("port");
    const candidate = searchTiles
      .filter((tile) => {
        if (!game.isLand(tile)) return false;
        if (wantsPort) return game.isShore(tile);
        return true;
      })
      .sort(
        (a, b) =>
          game.euclideanDistSquared(a, centerTile) -
          game.euclideanDistSquared(b, centerTile),
      )[0];

    if (candidate === undefined) {
      return null;
    }

    return {
      x: game.x(candidate),
      y: game.y(candidate),
      label: `Build ${bestBuilding}`,
    };
  }

  private computeSpawnRecommendations(
    game: GameView,
    myPlayer: PlayerView,
  ): {
    spawnRecommendation: SpawnRecommendation | null;
    spawnCandidates: SpawnRecommendation[];
  } {
    if (myPlayer.hasSpawned()) {
      this.cachedSpawnRecommendation = null;
      this.cachedSpawnCandidates = [];
      this.lastSpawnRecommendationTick = -1;
      return {
        spawnRecommendation: null,
        spawnCandidates: [],
      };
    }


    const nowTick = game.ticks();
    if (
      this.cachedSpawnRecommendation !== null &&
      this.lastSpawnRecommendationTick >= 0 &&
      nowTick - this.lastSpawnRecommendationTick < 30
    ) {
      return {
        spawnRecommendation: this.cachedSpawnRecommendation,
        spawnCandidates: this.cachedSpawnCandidates,
      };
    }

    const width = game.width();
    const height = game.height();
    const stepX = Math.max(3, Math.floor(width / 42));
    const stepY = Math.max(3, Math.floor(height / 42));

    const allies = game
      .players()
      .filter(
        (p) => p.smallID() !== myPlayer.smallID() && p.isAlive() && myPlayer.isFriendly(p),
      )
      .map((p) => p.nameLocation());

    const enemies = game
      .players()
      .filter(
        (p) => p.smallID() !== myPlayer.smallID() && p.isAlive() && !myPlayer.isFriendly(p),
      )
      .map((p) => p.nameLocation());

    const scoredCandidates: Array<{ tile: number; score: number; reason: string }> =
      [];

    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        if (!game.isValidCoord(x, y)) continue;
        const tile = game.ref(x, y);
        if (!this.isValidSpawnCenter(game, tile, myPlayer)) continue;

        const allyDist = this.minDistanceToPoints(x, y, allies);
        const enemyDist = this.minDistanceToPoints(x, y, enemies);

        // Favor safer distance from enemies.
        const enemySafetyScore = Math.min(180, enemyDist) * 1.35;
        // If allies exist, favor moderate distance for support, not overlap.
        const allySupportScore =
          allies.length === 0
            ? 40
            : Math.max(0, 100 - Math.abs(allyDist - 45)) * 1.2;

        // Water access score: prefer shoreline / near-shore openings.
        const localTiles = Array.from(
          game.circleSearch(tile, 10, (candidate) => game.isValidRef(candidate)),
        );
        const waterCount = localTiles.reduce(
          (sum, candidate) => sum + (game.isWater(candidate) ? 1 : 0),
          0,
        );
        const shoreBonus = game.isShore(tile) ? 32 : 0;
        const waterAccessScore = Math.min(70, waterCount) + shoreBonus;

        const closeEnemyPenalty = enemyDist < 35 ? (35 - enemyDist) * 6 : 0;

        const score =
          enemySafetyScore + allySupportScore + waterAccessScore - closeEnemyPenalty;

        scoredCandidates.push({
          tile,
          score,
          reason: `Enemy distance ~${Math.round(enemyDist)}, ally distance ~${Math.round(
            allyDist,
          )}, water access score ${Math.round(waterAccessScore)}.`,
        });
      }
    }

    scoredCandidates.sort((a, b) => b.score - a.score);
    const best = scoredCandidates[0] ?? null;
    const bestScore = best?.score ?? 1;
    const spawnCandidates = scoredCandidates.slice(0, 4).map((candidate) => ({
      x: game.x(candidate.tile),
      y: game.y(candidate.tile),
      reason: candidate.reason,
      strength: Math.max(0.2, Math.min(1, candidate.score / bestScore)),
    }));

    this.lastSpawnRecommendationTick = nowTick;
    this.cachedSpawnRecommendation =
      best === null
        ? null
        : {
            x: game.x(best.tile),
            y: game.y(best.tile),
            reason: best.reason,
            strength: 1,
          };
    this.cachedSpawnCandidates = spawnCandidates;
    return {
      spawnRecommendation: this.cachedSpawnRecommendation,
      spawnCandidates: this.cachedSpawnCandidates,
    };
  }

  private minDistanceToPoints(
    x: number,
    y: number,
    points: Array<{ x: number; y: number }>,
  ): number {
    if (points.length === 0) {
      return 80;
    }
    let minDist = Number.POSITIVE_INFINITY;
    for (const point of points) {
      const dx = point.x - x;
      const dy = point.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      minDist = Math.min(minDist, dist);
    }
    return Number.isFinite(minDist) ? minDist : 80;
  }

  private isValidSpawnCenter(
    game: GameView,
    center: number,
    myPlayer: PlayerView,
  ): boolean {
    if (!game.isLand(center) || game.hasOwner(center) || game.isBorder(center)) {
      return false;
    }

    const spawnAreaTiles = Array.from(
      game.circleSearch(center, 4, (tile) => game.isValidRef(tile)),
    );
    if (spawnAreaTiles.length < 16) {
      return false;
    }
    if (spawnAreaTiles.some((tile) => !game.isLand(tile) || game.hasOwner(tile))) {
      return false;
    }

    const minDistance = game.config().minDistanceBetweenPlayers();
    const spawnedOthers = game
      .players()
      .filter((player) => player.smallID() !== myPlayer.smallID() && player.hasSpawned());
    for (const other of spawnedOthers) {
      const location = other.nameLocation();
      if (!game.isValidCoord(location.x, location.y)) continue;
      const otherTile = game.ref(location.x, location.y);
      if (game.manhattanDist(center, otherTile) < minDistance) {
        return false;
      }
    }

    return true;
  }
}
