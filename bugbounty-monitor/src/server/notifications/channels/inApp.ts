import { db } from '@/db';
import { notifications } from '@/db/schema';
import { createLogger } from '@/lib/logger';
import type { DeliveryResult, NotificationChannel, NotificationMessage } from '../channel';

const log = createLogger('notify:in-app');

/**
 * In-app notifications. Always available.
 *
 * The unique index on (user, kind, program, change) makes delivery idempotent:
 * re-running a digest or re-processing a change never duplicates a bell entry.
 */
export class InAppChannel implements NotificationChannel {
  readonly id = 'in_app';
  readonly label = 'In-app';

  isConfigured(): boolean {
    return true;
  }

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    try {
      await db()
        .insert(notifications)
        .values({
          userId: message.userId,
          programId: message.programId ?? null,
          changeId: message.changeId ?? null,
          kind: message.kind,
          title: message.title,
          body: message.body,
          url: message.url ?? null,
          severity: message.severity,
          deliveries: { in_app: 'sent' },
        })
        .onConflictDoNothing();
      return { channel: this.id, status: 'sent' };
    } catch (error) {
      log.error('Failed to store in-app notification', { error });
      return { channel: this.id, status: 'failed', error: String(error) };
    }
  }
}
