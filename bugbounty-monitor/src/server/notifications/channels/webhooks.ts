import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import type { DeliveryResult, NotificationChannel, NotificationMessage } from '../channel';

const log = createLogger('notify:webhook');

/**
 * Chat channels.
 *
 * These are the "structure the code so Telegram/Discord/Slack can be added
 * later" extension points — implemented, inert until their credentials are
 * present in the environment.
 */

async function post(url: string, payload: unknown, channel: string): Promise<DeliveryResult> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { channel, status: 'failed', error: `HTTP ${response.status} ${text.slice(0, 200)}` };
    }
    return { channel, status: 'sent' };
  } catch (error) {
    log.error(`${channel} delivery failed`, { error });
    return { channel, status: 'failed', error: String(error) };
  }
}

function plainText(message: NotificationMessage): string {
  const lines = [`*${message.title}*`, message.body];
  for (const field of message.fields ?? []) lines.push(`${field.label}: ${field.value}`);
  if (message.url) lines.push(message.url);
  return lines.join('\n');
}

export class SlackChannel implements NotificationChannel {
  readonly id = 'slack';
  readonly label = 'Slack';

  isConfigured(): boolean {
    return Boolean(env().NOTIFY_SLACK_WEBHOOK_URL);
  }

  unavailableReason(): string | null {
    return this.isConfigured() ? null : 'NOTIFY_SLACK_WEBHOOK_URL is not set';
  }

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    const url = env().NOTIFY_SLACK_WEBHOOK_URL;
    if (!url) return { channel: this.id, status: 'skipped', error: this.unavailableReason() ?? undefined };

    return post(
      url,
      {
        text: message.title,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: message.title.slice(0, 150) } },
          { type: 'section', text: { type: 'mrkdwn', text: message.body.slice(0, 2900) } },
          ...(message.fields?.length
            ? [
                {
                  type: 'section',
                  fields: message.fields.slice(0, 10).map((f) => ({
                    type: 'mrkdwn',
                    text: `*${f.label}*\n${f.value}`,
                  })),
                },
              ]
            : []),
          ...(message.url
            ? [
                {
                  type: 'actions',
                  elements: [
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: 'Open program' },
                      url: message.url,
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      this.id,
    );
  }
}

export class DiscordChannel implements NotificationChannel {
  readonly id = 'discord';
  readonly label = 'Discord';

  isConfigured(): boolean {
    return Boolean(env().NOTIFY_DISCORD_WEBHOOK_URL);
  }

  unavailableReason(): string | null {
    return this.isConfigured() ? null : 'NOTIFY_DISCORD_WEBHOOK_URL is not set';
  }

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    const url = env().NOTIFY_DISCORD_WEBHOOK_URL;
    if (!url) return { channel: this.id, status: 'skipped', error: this.unavailableReason() ?? undefined };

    const colours = { info: 0x64748b, low: 0x0ea5e9, medium: 0xf59e0b, high: 0xef4444 };
    return post(
      url,
      {
        embeds: [
          {
            title: message.title.slice(0, 250),
            description: message.body.slice(0, 4000),
            url: message.url ?? undefined,
            color: colours[message.severity],
            fields: (message.fields ?? []).slice(0, 25).map((f) => ({
              name: f.label.slice(0, 250),
              value: f.value.slice(0, 1000),
              inline: true,
            })),
            timestamp: new Date().toISOString(),
          },
        ],
      },
      this.id,
    );
  }
}

export class TelegramChannel implements NotificationChannel {
  readonly id = 'telegram';
  readonly label = 'Telegram';

  isConfigured(): boolean {
    const config = env();
    return Boolean(config.NOTIFY_TELEGRAM_BOT_TOKEN && config.NOTIFY_TELEGRAM_CHAT_ID);
  }

  unavailableReason(): string | null {
    if (this.isConfigured()) return null;
    return 'NOTIFY_TELEGRAM_BOT_TOKEN and NOTIFY_TELEGRAM_CHAT_ID must both be set';
  }

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    const config = env();
    if (!this.isConfigured()) {
      return { channel: this.id, status: 'skipped', error: this.unavailableReason() ?? undefined };
    }
    return post(
      `https://api.telegram.org/bot${config.NOTIFY_TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: config.NOTIFY_TELEGRAM_CHAT_ID,
        text: plainText(message).slice(0, 4000),
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      },
      this.id,
    );
  }
}
