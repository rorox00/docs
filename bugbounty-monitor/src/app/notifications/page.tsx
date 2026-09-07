import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { Badge, Card, EmptyState, SectionTitle } from '@/components/ui';
import { formatRelative } from '@/lib/dates';
import { getSession } from '@/server/auth';
import { listNotifications } from '@/server/notifications/dispatcher';
import { SavedFilters } from '@/components/SavedFilters';
import { MarkAllRead } from '@/components/MarkAllRead';

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  const items = await listNotifications(session.userId, 100);

  return (
    <Shell
      current="/notifications"
      title="Notifications"
      subtitle="Alerts from your saved filters."
      actions={<MarkAllRead />}
    >
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card padded={false}>
            <div className="p-4 pb-0">
              <SectionTitle>Inbox</SectionTitle>
            </div>
            {items.length === 0 ? (
              <div className="p-4 pt-0">
                <EmptyState
                  title="No notifications yet"
                  hint="Create a saved filter to be alerted when a matching program is discovered or changes."
                />
              </div>
            ) : (
              <ul>
                {items.map((item) => (
                  <li
                    key={item.id}
                    className={`border-t border-border px-4 py-3 ${item.readAt ? '' : 'bg-accent-soft/30'}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {!item.readAt ? <Badge tone="accent">New</Badge> : null}
                          <Badge
                            tone={
                              item.severity === 'high'
                                ? 'danger'
                                : item.severity === 'medium'
                                  ? 'warn'
                                  : 'neutral'
                            }
                          >
                            {item.kind.replace(/_/g, ' ')}
                          </Badge>
                          {item.programId ? (
                            <Link href={`/programs/${item.programId}`} className="text-[13px] font-semibold hover:text-accent">
                              {item.title}
                            </Link>
                          ) : (
                            <span className="text-[13px] font-semibold">{item.title}</span>
                          )}
                        </div>
                        {item.body ? (
                          <p className="mt-1 whitespace-pre-line text-[12px] text-muted">{item.body.slice(0, 400)}</p>
                        ) : null}
                      </div>
                      <span className="shrink-0 text-[11px] text-faint">{formatRelative(item.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div>
          <SavedFilters />
        </div>
      </div>
    </Shell>
  );
}
