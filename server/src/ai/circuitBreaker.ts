/**
 * Minimal circuit breaker for the LLM API.
 *
 * After `failureThreshold` consecutive failures the circuit opens and calls are
 * skipped (callers fall back immediately) for `cooldownMs`. After the cooldown a
 * single trial call is let through ("half-open"); success closes the circuit,
 * failure re-opens it. This stops an outage or rate-limit storm from adding a
 * 30-second timeout to every ticket while the provider is down.
 */
export type CircuitState = "closed" | "open" | "half_open";

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private trialInFlight = false;

  constructor(
    private readonly failureThreshold = 3,
    private readonly cooldownMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  get state(): CircuitState {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.cooldownMs ? "half_open" : "open";
  }

  /** Returns true if a request may proceed. Claims the single trial slot when half-open. */
  tryAcquire(): boolean {
    const state = this.state;
    if (state === "closed") return true;
    if (state === "half_open" && !this.trialInFlight) {
      this.trialInFlight = true;
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.trialInFlight = false;
  }

  recordFailure() {
    this.consecutiveFailures++;
    if (this.trialInFlight || this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = this.now();
    }
    this.trialInFlight = false;
  }

  /** For calls that ended without a verdict on provider health (e.g. a refusal). */
  release() {
    this.trialInFlight = false;
  }
}
