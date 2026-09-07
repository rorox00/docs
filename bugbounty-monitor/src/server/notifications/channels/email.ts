import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import type { DeliveryResult, NotificationChannel, NotificationMessage } from '../channel';

const log = createLogger('notify:email');

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  const config = env();
  if (!config.NOTIFY_EMAIL_ENABLED || !config.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    });
  }
  return transporter;
}

/** Test hook: drop the memoised transport after changing SMTP settings. */
export function resetEmailTransport(): void {
  transporter = null;
}

export class EmailChannel implements NotificationChannel {
  readonly id = 'email';
  readonly label = 'Email';

  isConfigured(): boolean {
    return getTransporter() !== null;
  }

  unavailableReason(): string | null {
    const config = env();
    if (!config.NOTIFY_EMAIL_ENABLED) return 'Disabled via NOTIFY_EMAIL_ENABLED';
    if (!config.SMTP_HOST) return 'SMTP_HOST is not set';
    return null;
  }

  async send(message: NotificationMessage): Promise<DeliveryResult> {
    const transport = getTransporter();
    if (!transport) return { channel: this.id, status: 'skipped', error: this.unavailableReason() ?? undefined };
    if (!message.email) return { channel: this.id, status: 'skipped', error: 'No email address' };

    try {
      await transport.sendMail({
        from: env().MAIL_FROM,
        to: message.email,
        subject: message.title,
        text: renderText(message),
        html: renderHtml(message),
      });
      return { channel: this.id, status: 'sent' };
    } catch (error) {
      log.error('Email delivery failed', { to: message.email, error });
      return { channel: this.id, status: 'failed', error: String(error) };
    }
  }
}

function renderText(message: NotificationMessage): string {
  const lines = [message.title, '', message.body];
  for (const field of message.fields ?? []) lines.push(`${field.label}: ${field.value}`);
  if (message.url) lines.push('', message.url);
  lines.push('', '—', 'Bug Bounty Monitor');
  return lines.join('\n');
}

function renderHtml(message: NotificationMessage): string {
  const fields = (message.fields ?? [])
    .map(
      (f) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:13px">${escapeHtml(f.label)}</td>` +
        `<td style="padding:4px 0;font-size:13px;font-weight:600">${escapeHtml(f.value)}</td></tr>`,
    )
    .join('');

  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
      <p style="margin:0 0 4px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Bug Bounty Monitor</p>
      <h1 style="margin:0 0 12px;font-size:18px;color:#0f172a">${escapeHtml(message.title)}</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#334155">${escapeHtml(message.body)}</p>
      ${fields ? `<table style="border-collapse:collapse;margin-bottom:16px">${fields}</table>` : ''}
      ${
        message.url
          ? `<a href="${escapeHtml(message.url)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:9px 16px;border-radius:8px;font-size:13px;font-weight:600">Open program</a>`
          : ''
      }
    </div>
    <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;text-align:center">
      You are receiving this because you subscribed to a saved filter.
    </p>
  </div></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
