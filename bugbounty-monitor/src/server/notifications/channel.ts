/**
 * Notification channel abstraction.
 *
 * In-app and email ship today; Telegram, Discord and Slack are implemented
 * against the same interface and activate as soon as their webhook/token is
 * configured. Adding another channel means adding one file and one registry
 * entry — nothing else in the codebase changes.
 */

export interface NotificationMessage {
  /** Recipient user id (in-app) — channels that broadcast may ignore it. */
  userId: number;
  email?: string | null;
  title: string;
  body: string;
  url?: string | null;
  severity: 'info' | 'low' | 'medium' | 'high';
  kind: 'new_program' | 'change' | 'digest';
  programId?: number | null;
  changeId?: number | null;
  /** Rich fields channels can render however they like. */
  fields?: Array<{ label: string; value: string }>;
}

export type DeliveryStatus = 'sent' | 'skipped' | 'failed';

export interface DeliveryResult {
  channel: string;
  status: DeliveryStatus;
  error?: string;
}

export interface NotificationChannel {
  readonly id: string;
  readonly label: string;
  /** False when the deployment has not configured this channel. */
  isConfigured(): boolean;
  /** Why the channel is unavailable, surfaced in the admin panel. */
  unavailableReason?(): string | null;
  send(message: NotificationMessage): Promise<DeliveryResult>;
}
