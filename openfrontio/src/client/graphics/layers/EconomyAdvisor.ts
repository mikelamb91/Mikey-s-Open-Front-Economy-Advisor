import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { renderTroops } from "../../Utils";
import {
  AdvisorOverlayHints,
  EconomyAdvisorEngine,
  EconomyAdvisorReport,
} from "../../advisor/EconomyAdvisorEngine";
import { Layer } from "./Layer";

export class AdvisorOverlayUpdateEvent {
  constructor(
    public readonly visible: boolean,
    public readonly hints: AdvisorOverlayHints | null,
    public readonly layers: {
      spawn: boolean;
      build: boolean;
      target: boolean;
      route: boolean;
    },
  ) {}
}

@customElement("economy-advisor")
export class EconomyAdvisor extends LitElement implements Layer {
  public game: GameView;
  public eventBus: EventBus;

  @state() private report: EconomyAdvisorReport | null = null;
  @state() private isVisible = true;
  @state() private collapsed = false;
  @state() private overlayEnabled = true;
  @state()
  private overlayLayers = {
    spawn: true,
    build: true,
    target: true,
    route: true,
  };

  private readonly engine = new EconomyAdvisorEngine();

  createRenderRoot() {
    return this;
  }

  getTickIntervalMs() {
    return 300;
  }

  tick() {
    const myPlayer = this.game?.myPlayer();
    const shouldHide =
      !this.game ||
      !myPlayer ||
      (!myPlayer.isAlive() && myPlayer.hasSpawned());
    if (shouldHide) {
      this.report = null;
      this.isVisible = false;
      this.eventBus.emit(
        new AdvisorOverlayUpdateEvent(false, null, this.overlayLayers),
      );
      this.requestUpdate();
      return;
    }

    this.isVisible = true;
    this.report = this.engine.update(this.game);
    this.eventBus.emit(
      new AdvisorOverlayUpdateEvent(
        this.overlayEnabled,
        this.report?.overlayHints ?? null,
        this.overlayLayers,
      ),
    );
    this.requestUpdate();
  }

  shouldTransform(): boolean {
    return false;
  }

  private severityClass(severity: "info" | "warn" | "critical"): string {
    switch (severity) {
      case "critical":
        return "text-red-300 border-red-500/40 bg-red-500/10";
      case "warn":
        return "text-amber-200 border-amber-500/40 bg-amber-500/10";
      case "info":
      default:
        return "text-blue-200 border-blue-500/40 bg-blue-500/10";
    }
  }

  private toggleCollapsed() {
    this.collapsed = !this.collapsed;
  }

  private toggleOverlay() {
    this.overlayEnabled = !this.overlayEnabled;
    this.eventBus.emit(
      new AdvisorOverlayUpdateEvent(
        this.overlayEnabled,
        this.report?.overlayHints ?? null,
        this.overlayLayers,
      ),
    );
    this.requestUpdate();
  }

  private toggleOverlayLayer(layer: "spawn" | "build" | "target" | "route") {
    this.overlayLayers = {
      ...this.overlayLayers,
      [layer]: !this.overlayLayers[layer],
    };
    this.eventBus.emit(
      new AdvisorOverlayUpdateEvent(
        this.overlayEnabled,
        this.report?.overlayHints ?? null,
        this.overlayLayers,
      ),
    );
    this.requestUpdate();
  }

  private renderSamPlacements() {
    if (!this.report || this.report.samPlacements.length === 0) {
      return html`<li class="text-zinc-300 text-xs">No placement data yet.</li>`;
    }

    return this.report.samPlacements.slice(0, 3).map(
      (placement) => html`
        <li class="text-xs text-zinc-200">
          (${placement.x}, ${placement.y}) - ${placement.reason}
        </li>
      `,
    );
  }

  render() {
    if (!this.isVisible || !this.report) {
      return html``;
    }

    return html`
      <aside
        class="fixed top-4 left-4 z-[1200] w-[24rem] max-w-[95vw] pointer-events-auto"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        <div class="rounded-lg border border-white/15 bg-zinc-900/90 shadow-xl">
          <button
            class="w-full px-3 py-2 border-b border-white/10 flex items-center justify-between text-left"
            @click=${() => this.toggleCollapsed()}
          >
            <span class="font-semibold text-sm text-white"
              >Economy Advisor</span
            >
            <span class="text-xs text-zinc-300"
              >${this.collapsed ? "Expand" : "Collapse"}</span
            >
          </button>

          ${this.collapsed
            ? html``
            : html`
                <div class="p-3 space-y-2.5">
                  <div class="rounded-md border border-cyan-500/35 bg-cyan-500/10 p-2">
                    <div class="text-[11px] uppercase text-cyan-200/85">
                      Best Next Step
                    </div>
                    <div class="text-sm text-cyan-100 font-semibold">
                      ${this.report.bestAction.toUpperCase()}
                    </div>
                    <div class="text-xs text-zinc-100 mt-1">
                      ${this.report.actionReason}
                    </div>
                    <div class="text-xs text-zinc-200 mt-1">
                      ${this.report.bestBuilding
                        ? `Best build now: ${this.report.bestBuilding}.`
                        : "No immediate build recommendation."}
                    </div>
                    <div class="text-[11px] text-zinc-300 mt-1">
                      ${this.report.bestBuildingReason}
                    </div>
                    ${this.report.overlayHints.buildLocation
                      ? html`<div class="text-[11px] text-emerald-200 mt-1">
                          Build marker: (${this.report.overlayHints.buildLocation.x},
                          ${this.report.overlayHints.buildLocation.y})
                        </div>`
                      : html``}
                    <div class="mt-2">
                      <button
                        class="text-[11px] px-2 py-1 rounded border ${this
                          .overlayEnabled
                          ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-100"
                          : "border-white/20 bg-white/5 text-zinc-200"}"
                        @click=${() => this.toggleOverlay()}
                      >
                        ${this.overlayEnabled
                          ? "Hide Map Overlay"
                          : "Show Map Overlay"}
                      </button>
                    </div>
                    <div class="mt-2 flex flex-wrap gap-1.5">
                      <button
                        class="text-[10px] px-1.5 py-1 rounded border ${this
                          .overlayLayers.spawn
                          ? "border-red-400/70 text-red-200 bg-red-500/20"
                          : "border-white/20 text-zinc-300 bg-white/5"}"
                        @click=${() => this.toggleOverlayLayer("spawn")}
                      >
                        Spawn dots
                      </button>
                      <button
                        class="text-[10px] px-1.5 py-1 rounded border ${this
                          .overlayLayers.build
                          ? "border-emerald-400/70 text-emerald-200 bg-emerald-500/20"
                          : "border-white/20 text-zinc-300 bg-white/5"}"
                        @click=${() => this.toggleOverlayLayer("build")}
                      >
                        Build spot
                      </button>
                      <button
                        class="text-[10px] px-1.5 py-1 rounded border ${this
                          .overlayLayers.target
                          ? "border-rose-400/70 text-rose-200 bg-rose-500/20"
                          : "border-white/20 text-zinc-300 bg-white/5"}"
                        @click=${() => this.toggleOverlayLayer("target")}
                      >
                        Target dot
                      </button>
                      <button
                        class="text-[10px] px-1.5 py-1 rounded border ${this
                          .overlayLayers.route
                          ? "border-sky-400/70 text-sky-200 bg-sky-500/20"
                          : "border-white/20 text-zinc-300 bg-white/5"}"
                        @click=${() => this.toggleOverlayLayer("route")}
                      >
                        Route line
                      </button>
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <div class="rounded-md border border-white/10 bg-white/5 p-2">
                      <div class="text-[11px] text-zinc-400 uppercase">
                        Recommended Send
                      </div>
                      <div class="text-sm font-semibold text-white">
                        ${renderTroops(this.report.recommendedSendTroops)} (${this
                          .report.recommendedSendPercent}
                        %)
                      </div>
                    </div>
                    <div class="rounded-md border border-white/10 bg-white/5 p-2">
                      <div class="text-[11px] text-zinc-400 uppercase">
                        Max Safe Send
                      </div>
                      <div class="text-sm font-semibold text-white">
                        ${renderTroops(this.report.maxSafeSendTroops)} (${this
                          .report.maxSafeSendPercent}
                        %)
                      </div>
                    </div>
                  </div>

                  <div class="rounded-md border border-white/10 bg-white/5 p-2">
                    <div class="text-[11px] uppercase text-zinc-400">
                      Enemy Economy Lead
                    </div>
                    <div class="text-xs text-zinc-100 mt-1">
                      ${this.report.enemyLeadSummary}
                    </div>
                  </div>

                  ${this.report.isLeadingEconomy
                    ? html``
                    : html`
                        <div class="rounded-md border border-white/10 bg-white/5 p-2">
                          <div class="text-[11px] uppercase text-zinc-400">
                            Catch-Up Plan
                          </div>
                          <ul class="list-disc ml-4 mt-1 space-y-1">
                            ${this.report.catchUpPlan.map(
                              (line) =>
                                html`<li class="text-xs text-zinc-100">${line}</li>`,
                            )}
                          </ul>
                        </div>
                      `}

                  <div class="rounded-md border border-white/10 bg-white/5 p-2">
                    <div class="text-[11px] uppercase text-zinc-400 mb-1">
                      Strategic Alerts
                    </div>
                    <div class="space-y-1.5">
                      ${this.report.alerts.length === 0
                        ? html`<div class="text-xs text-zinc-300">
                            No critical enemy strategic signals right now.
                          </div>`
                        : this.report.alerts.map(
                            (alert) => html`
                              <div
                                class="text-xs rounded border px-2 py-1 ${this.severityClass(alert.urgency)}"
                              >
                                ${alert.message}
                              </div>
                            `,
                          )}
                    </div>
                  </div>

                  <div class="rounded-md border border-white/10 bg-white/5 p-2">
                    <div class="text-[11px] uppercase text-zinc-400 mb-1">
                      Action Plan
                    </div>
                    <ul class="list-disc ml-4 mt-1 space-y-1">
                      ${this.report.targetActions.map(
                        (plan) =>
                          html`<li class="text-xs text-zinc-100">
                            <span class="font-semibold">${plan.action}</span>
                            -> <span class="font-semibold">${plan.target}</span>
                            ${plan.sendTroops > 0
                              ? html`(${renderTroops(plan.sendTroops)} / ${plan.sendPercent}%)`
                              : html``}
                            <span class="text-zinc-300"> - ${plan.reason}</span>
                          </li>`,
                      )}
                    </ul>
                  </div>

                  <div class="rounded-md border border-white/10 bg-white/5 p-2">
                    <div class="text-[11px] uppercase text-zinc-400">
                      SAM Plan
                    </div>
                    <div class="text-xs text-zinc-100 mt-1">
                      Need about ${this.report.requiredSamLaunchers} SAM launchers
                      (${this.report.currentSamLaunchers} built).
                    </div>
                    <ul class="list-disc ml-4 mt-1 space-y-1">
                      ${this.renderSamPlacements()}
                    </ul>
                    <div class="text-[11px] uppercase text-zinc-400 mt-2">
                      Threat Breakdown
                    </div>
                    <ul class="list-disc ml-4 mt-1 space-y-1">
                      ${this.report.samThreats.length === 0
                        ? html`<li class="text-xs text-zinc-300">
                            No enemy missile economy threats detected.
                          </li>`
                        : this.report.samThreats.map(
                            (line) =>
                              html`<li class="text-xs text-zinc-100">${line}</li>`,
                          )}
                    </ul>
                  </div>

                  ${this.report.spawnRecommendation
                    ? html`
                        <div class="rounded-md border border-white/10 bg-white/5 p-2">
                          <div class="text-[11px] uppercase text-zinc-400">
                            Start Positions (Live)
                          </div>
                          <div class="text-sm font-semibold text-white">
                            (${this.report.spawnRecommendation.x},
                            ${this.report.spawnRecommendation.y})
                          </div>
                          <div class="text-xs text-zinc-100 mt-1">
                            ${this.report.spawnRecommendation.reason}
                          </div>
                          <div class="text-[11px] text-zinc-300 mt-1">
                            Red brightness indicates recommendation strength.
                          </div>
                        </div>
                      `
                    : html``}
                </div>
              `}
        </div>
      </aside>
    `;
  }
}
