/**
 * SafetyIncident — C-backend-plataforma.md §3.2's TS shape, reproduced
 * verbatim (this is the one place the spec gives an exact interface for a
 * C2 entity outside `@buxo/domain` — kept here rather than added to
 * `@buxo/domain` since B3 never modeled it and the hard rule for this task
 * forbids touching `packages/*`).
 */
import type { SafetyCategory } from "./classifier";

export interface SafetyIncident {
  id: string;
  userId: string;
  sessionId: string;
  exchangeId: string | null;
  category: Exclude<SafetyCategory, "none">;
  detectedAt: string;
  classifierProviderId: string;
  classifierModelId: string;
  /** Exact student message that triggered the block — null for pre-migration rows. */
  triggeringText: string | null;
  reviewedAt: string | null;
  reviewedBy: "founder" | null;
  reviewNotes: string | null;
  schemaVersion: number;
}

/**
 * §3.2 point 4: "alerta casi en tiempo real al founder ... canal de C6".
 * No real channel exists in F1 (Slack/email/PagerDuty wiring is C6, out of
 * scope) — this interface lets the escalation path be fully wired now; a
 * console/log-based implementation is the F1 stand-in, same pattern as
 * `EmailSender`.
 */
export interface SafetyNotifier {
  notify(incident: SafetyIncident): Promise<void>;
}

export class ConsoleSafetyNotifier implements SafetyNotifier {
  async notify(incident: SafetyIncident): Promise<void> {
    console.error(
      `[SAFETY INCIDENT] category=${incident.category} userId=${incident.userId} sessionId=${incident.sessionId} detectedAt=${incident.detectedAt} — review within SLA (proposal: 24h, C-backend §3.2)`,
    );
  }
}

export class RecordingSafetyNotifier implements SafetyNotifier {
  public readonly notified: SafetyIncident[] = [];
  async notify(incident: SafetyIncident): Promise<void> {
    this.notified.push(incident);
  }
}
