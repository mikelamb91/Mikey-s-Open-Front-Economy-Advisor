import { EventBus } from "../../../core/EventBus";
import { GameView } from "../../../core/game/GameView";
import { AdvisorOverlayHints } from "../../advisor/EconomyAdvisorEngine";
import { AdvisorOverlayUpdateEvent } from "./EconomyAdvisor";
import { Layer } from "./Layer";

export class EconomyAdvisorOverlayLayer implements Layer {
  private isVisible = true;
  private hints: AdvisorOverlayHints | null = null;
  private layers = {
    spawn: true,
    build: true,
    target: true,
    route: true,
  };

  constructor(
    private readonly game: GameView,
    private readonly eventBus: EventBus,
  ) {}

  init(): void {
    this.eventBus.on(AdvisorOverlayUpdateEvent, (event) => {
      this.isVisible = event.visible;
      this.hints = event.hints;
      this.layers = event.layers;
    });
  }

  shouldTransform(): boolean {
    return true;
  }

  renderLayer(context: CanvasRenderingContext2D): void {
    if (!this.isVisible || this.hints === null) {
      return;
    }

    if (this.layers.route && this.hints.route) {
      this.drawRoute(context, this.hints.route.from, this.hints.route.to);
    }
    if (this.layers.target && this.hints.attackTarget) {
      this.drawPulseDot(context, this.hints.attackTarget.x, this.hints.attackTarget.y, {
        core: "rgba(255, 80, 80, 0.95)",
        glow: "rgba(255, 40, 40, 0.25)",
      });
      this.drawLabel(context, this.hints.attackTarget.x, this.hints.attackTarget.y, this.hints.attackTarget.label);
    }
    if (this.layers.build && this.hints.buildLocation) {
      this.drawPulseDot(context, this.hints.buildLocation.x, this.hints.buildLocation.y, {
        core: "rgba(110, 255, 170, 0.95)",
        glow: "rgba(90, 255, 170, 0.22)",
      });
      this.drawLabel(
        context,
        this.hints.buildLocation.x,
        this.hints.buildLocation.y,
        this.hints.buildLocation.label,
      );
    }
    if (this.layers.spawn) {
      this.drawSpawnCandidates(context);
    }
  }

  private drawRoute(
    context: CanvasRenderingContext2D,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    context.save();
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.strokeStyle = "rgba(100, 200, 255, 0.8)";
    context.lineWidth = 2;
    context.setLineDash([6, 6]);
    context.stroke();
    context.restore();
  }

  private drawPulseDot(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    colors: { core: string; glow: string },
  ): void {
    const phase = (this.game.ticks() % 20) / 20;
    const radius = 5 + phase * 4;

    context.save();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = colors.glow;
    context.fill();
    context.beginPath();
    context.arc(x, y, 3.2, 0, Math.PI * 2);
    context.fillStyle = colors.core;
    context.fill();
    context.restore();
  }

  private drawLabel(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
  ): void {
    context.save();
    context.font = "bold 10px Inter, Arial, sans-serif";
    context.fillStyle = "rgba(0, 0, 0, 0.65)";
    const metrics = context.measureText(label);
    const width = metrics.width + 8;
    const height = 14;
    context.fillRect(x + 7, y - 16, width, height);
    context.fillStyle = "#f4f4f5";
    context.fillText(label, x + 11, y - 6);
    context.restore();
  }

  private drawSpawnCandidates(context: CanvasRenderingContext2D): void {
    const candidates = this.hints?.spawnCandidates ?? [];
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const intensity = Math.max(0.2, Math.min(1, candidate.strength));
      const coreAlpha = 0.4 + intensity * 0.6;
      const glowAlpha = 0.08 + intensity * 0.22;
      this.drawPulseDot(context, candidate.x, candidate.y, {
        core: `rgba(255, 70, 70, ${coreAlpha.toFixed(2)})`,
        glow: `rgba(255, 40, 40, ${glowAlpha.toFixed(2)})`,
      });
      if (i === 0) {
        this.drawLabel(
          context,
          candidate.x,
          candidate.y,
          `Top spawn (${Math.round(candidate.strength * 100)}%)`,
        );
      }
    }
  }
}
