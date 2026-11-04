import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { EventClosureService, EVENT_CLOSURE_PAGE_SIZE } from "./event-closure.service";
import { EventClosurePolicy } from "./event-closure.policy";

/** setTimeout após cada ciclo: nenhuma sobreposição, inclusive em ciclos lentos. */
@Injectable()
export class EventClosureScheduler implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(EventClosureScheduler.name);
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  private stopped = false;

  constructor(@Inject(EventClosureService) private readonly closure: EventClosureService,
    @Inject(EventClosurePolicy) private readonly policy: EventClosurePolicy) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.policy.configuration.enabled) return;
    await this.runCycle();
    this.schedule();
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.runCycle().then(() => this.schedule());
    }, this.policy.configuration.intervalMs);
    this.timer.unref();
  }

  runCycle(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.sweep().catch(() => { this.logger.error("EVENT_CLOSURE_CYCLE_FAILED"); })
      .finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async sweep(): Promise<void> {
    let afterId: string | null = null, closed = 0, failed = 0;
    do {
      const candidates = await this.closure.findCandidates(afterId);
      for (const eventId of candidates) {
        if (this.stopped) return;
        try { if ((await this.closure.regularizeEvent(eventId, true)).kind === "closed") closed++; }
        catch (error) {
          failed++;
          this.logger.error({ event: error instanceof Error && error.message === "EVENT_CLOSURE_INTEGRITY"
            ? "EVENT_CLOSURE_INTEGRITY" : "EVENT_CLOSURE_EVENT_FAILED", eventId });
        }
      }
      if (candidates.length < EVENT_CLOSURE_PAGE_SIZE) break;
      afterId = candidates[candidates.length - 1];
    } while (!this.stopped);
    if (closed || failed) this.logger.log({ event: "EVENT_CLOSURE_CYCLE", closed, failed });
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
  }
}
