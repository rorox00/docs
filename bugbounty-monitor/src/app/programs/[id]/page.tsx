import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Shell } from '@/components/Shell';
import {
  Badge,
  Card,
  ConfidenceBadge,
  EmptyState,
  ProgramTypeBadge,
  SectionTitle,
  SelfHostedBadge,
  StatusBadge,
  Unknown,
} from '@/components/ui';
import { CHANGE_TYPE_LABELS, PROGRAM_TYPE_LABELS, REWARD_KIND_LABELS, SOURCE_KIND_LABELS, confidenceBand, type ChangeType, type ProgramType, type RewardKind, type SourceKind } from '@/lib/constants';
import { daysSince, formatDate, formatRelative } from '@/lib/dates';
import { displayUrl } from '@/lib/url';
import { platformById } from '@/lib/platforms';
import { formatAmount } from '@/pipeline/extract/rewards';
import { getProgramDetail } from '@/server/repos/queryRepo';
import { getSession } from '@/server/auth';
import { VerifyButton } from '@/components/VerifyButton';

export const dynamic = 'force-dynamic';

/**
 * Program detail.
 *
 * The layout is organised around the accuracy rules: the four date fields are
 * shown side by side and separately labelled, and the confidence score is
 * always accompanied by the factors that produced it.
 */
export default async function ProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const programId = Number.parseInt(id, 10);
  if (!Number.isFinite(programId)) notFound();

  const program = await getProgramDetail(programId);
  if (!program) notFound();

  const session = await getSession();
  const now = new Date();
  const inScope = program.assets.filter((a) => a.inScope && !a.removedAt);
  const outOfScope = program.assets.filter((a) => !a.inScope && !a.removedAt);
  const removedAssets = program.assets.filter((a) => a.removedAt);
  const activeRewards = program.rewards.filter((r) => !r.removedAt);
  const discoveredDays = daysSince(program.firstSeenAt, now);

  return (
    <Shell current="/programs">
      {/* Header */}
      <div className="mb-4">
        <Link href="/" className="text-xs font-semibold text-muted hover:text-accent">
          ← Back to new programs
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{program.companyName}</h1>
            <p className="mt-0.5 text-[15px] text-muted">{program.name}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={program.status} />
              <SelfHostedBadge
                selfHosted={program.selfHosted}
                hasThirdParty={program.hasThirdPartyProgram}
              />
              <ProgramTypeBadge type={program.programType} />
              {discoveredDays <= 7 ? (
                <Badge tone="new">Discovered {discoveredDays === 0 ? 'today' : `${discoveredDays}d ago`}</Badge>
              ) : null}
              {program.falsePositive ? <Badge tone="danger">Marked false positive</Badge> : null}
              {program.hidden ? <Badge tone="warn">Hidden</Badge> : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a
              href={program.programUrl}
              target="_blank"
              rel="noreferrer noopener nofollow"
              className="rounded-lg border border-accent bg-accent px-3 py-1.5 text-[13px] font-semibold text-accent-contrast hover:opacity-90"
            >
              Open program ↗
            </a>
            {program.companyWebsite ? (
              <a
                href={program.companyWebsite}
                target="_blank"
                rel="noreferrer noopener nofollow"
                className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[13px] font-semibold text-muted hover:bg-surface-hover hover:text-text"
              >
                Company site ↗
              </a>
            ) : null}
            {session?.role === 'admin' ? <VerifyButton programId={program.id} /> : null}
          </div>
        </div>

        <p className="mt-2 font-mono text-[12px] text-faint">
          <a href={program.programUrl} target="_blank" rel="noreferrer noopener nofollow" className="hover:text-accent">
            {displayUrl(program.programUrl, 120)}
          </a>
        </p>
      </div>

      {program.summary ? (
        <Card className="mb-4">
          <p className="text-[13px] leading-relaxed text-muted">{program.summary}</p>
        </Card>
      ) : null}

      {/* Dates — deliberately four separate, labelled fields. */}
      <Card className="mb-4">
        <SectionTitle hint="These are distinct fields. A page's last-modified date is never treated as a launch date.">
          Dates
        </SectionTitle>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          <DateField
            label="Launch date"
            value={program.launchDate}
            note={
              program.launchDate
                ? `from ${(program.launchDateSource ?? 'page evidence').replace(/_/g, ' ')}`
                : 'could not be determined'
            }
            emphasis
          />
          <DateField label="Published date" value={program.publishedDate} note="page metadata" />
          <DateField label="Last modified" value={program.modifiedDate} note="page metadata" />
          <DateField
            label="First discovered"
            value={program.firstSeenAt}
            note={formatRelative(program.firstSeenAt, now)}
          />
          <DateField
            label="Last verified"
            value={program.lastVerifiedAt}
            note={program.lastVerifiedAt ? formatRelative(program.lastVerifiedAt, now) : 'never verified'}
          />
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {/* Scope */}
          <Card>
            <SectionTitle
              hint={
                program.assets.length === 0
                  ? undefined
                  : `${inScope.length} in scope · ${outOfScope.length} out of scope`
              }
            >
              Scope
            </SectionTitle>

            {program.assets.length === 0 ? (
              <p className="text-[13px] text-faint italic">
                No structured scope could be extracted from the program page. Read the program policy
                directly before testing.
              </p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <AssetList title="In scope" tone="ok" symbol="✓" assets={inScope} />
                <AssetList title="Out of scope" tone="danger" symbol="✗" assets={outOfScope} />
              </div>
            )}

            {removedAssets.length > 0 ? (
              <details className="mt-3 border-t border-border pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-muted">
                  {removedAssets.length} asset{removedAssets.length === 1 ? '' : 's'} no longer listed
                </summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {removedAssets.map((asset) => (
                    <li key={asset.id} className="font-mono text-[12px] text-faint line-through">
                      {asset.identifier}
                      <span className="ml-2 not-italic no-underline">
                        (removed {formatDate(asset.removedAt)})
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </Card>

          {/* Rewards */}
          <Card>
            <SectionTitle hint="Amounts are only shown when they are stated explicitly on the program page.">
              Rewards
            </SectionTitle>

            <div className="mb-3 flex flex-wrap items-center gap-4">
              <Figure
                label="Maximum bounty"
                value={
                  program.maxBounty !== null
                    ? formatAmount(program.maxBounty, program.bountyCurrency)
                    : null
                }
              />
              <Figure
                label="Minimum bounty"
                value={
                  program.minBounty !== null
                    ? formatAmount(program.minBounty, program.bountyCurrency)
                    : null
                }
              />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">Reward model</p>
                <p className="mt-0.5 text-[15px] font-semibold">
                  {REWARD_KIND_LABELS[program.rewardKind as RewardKind] ?? program.rewardKind}
                </p>
              </div>
            </div>

            {activeRewards.length > 0 ? (
              <div className="scroll-x">
                <table className="w-full min-w-[420px] border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-1.5 pr-3 text-[11px] font-bold uppercase tracking-wide text-faint">Tier</th>
                      <th className="py-1.5 pr-3 text-right text-[11px] font-bold uppercase tracking-wide text-faint">Minimum</th>
                      <th className="py-1.5 pr-3 text-right text-[11px] font-bold uppercase tracking-wide text-faint">Maximum</th>
                      <th className="py-1.5 text-[11px] font-bold uppercase tracking-wide text-faint">Source text</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeRewards.map((reward) => (
                      <tr key={reward.id} className="border-b border-border last:border-0">
                        <td className="py-1.5 pr-3 font-semibold">{reward.tier}</td>
                        <td className="tabular py-1.5 pr-3 text-right">
                          {reward.minAmount !== null ? formatAmount(reward.minAmount, reward.currency) : '—'}
                        </td>
                        <td className="tabular py-1.5 pr-3 text-right font-semibold text-paid">
                          {reward.maxAmount !== null ? formatAmount(reward.maxAmount, reward.currency) : '—'}
                        </td>
                        <td className="py-1.5 font-mono text-[11px] text-faint">
                          {reward.rawText ? reward.rawText.slice(0, 90) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[13px] text-faint italic">
                No reward table was published, or amounts could not be verified.
              </p>
            )}
          </Card>

          {/* Policy excerpt */}
          {program.policyText ? (
            <Card>
              <SectionTitle hint="Excerpt from the program page. Always read the full policy at the source.">
                Policy
              </SectionTitle>
              <pre className="scroll-x max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-[12px] leading-relaxed text-muted">
                {program.policyText.slice(0, 6000)}
              </pre>
            </Card>
          ) : null}

          {/* Changes */}
          <Card>
            <SectionTitle hint={`${program.changes.length} recorded event${program.changes.length === 1 ? '' : 's'}`}>
              Change history
            </SectionTitle>
            {program.changes.length === 0 ? (
              <p className="text-[13px] text-faint italic">No changes recorded yet.</p>
            ) : (
              <ul className="flex flex-col">
                {program.changes.map((change) => (
                  <li key={change.id} className="flex gap-3 border-b border-border py-2 last:border-0">
                    <span className="tabular w-24 shrink-0 text-[12px] text-faint">
                      {formatDate(change.detectedAt)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge
                          tone={
                            change.severity === 'high'
                              ? 'danger'
                              : change.severity === 'medium'
                                ? 'warn'
                                : change.severity === 'low'
                                  ? 'info'
                                  : 'neutral'
                          }
                        >
                          {CHANGE_TYPE_LABELS[change.changeType as ChangeType] ?? change.changeType}
                        </Badge>
                        <span className="text-[13px]">{change.summary}</span>
                      </div>
                      {change.previousValue || change.newValue ? (
                        <p className="mt-0.5 font-mono text-[11px] text-faint">
                          {change.previousValue ? <span className="line-through">{change.previousValue.slice(0, 80)}</span> : null}
                          {change.previousValue && change.newValue ? ' → ' : ''}
                          {change.newValue ? <span>{change.newValue.slice(0, 80)}</span> : null}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Sidebar */}
        <div className="flex flex-col gap-4">
          {/* Confidence */}
          <Card>
            <SectionTitle>Confidence</SectionTitle>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="tabular text-3xl font-bold">{program.confidenceScore}%</span>
              <ConfidenceBadge score={program.confidenceScore} />
            </div>
            <div
              className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-soft"
              role="img"
              aria-label={`Confidence ${program.confidenceScore} of 100, ${confidenceBand(program.confidenceScore)}`}
            >
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${Math.max(2, program.confidenceScore)}%` }}
              />
            </div>
            <ul className="flex flex-col gap-1">
              {program.confidenceFactors.map((factor) => (
                <li key={factor.id} className="flex items-start justify-between gap-2 text-[12px]">
                  <span className="text-muted">{factor.label}</span>
                  <span
                    className={`tabular shrink-0 font-semibold ${factor.points >= 0 ? 'text-ok' : 'text-danger'}`}
                  >
                    {factor.points >= 0 ? '+' : ''}
                    {factor.points}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {/* Facts */}
          <Card>
            <SectionTitle>Details</SectionTitle>
            <dl className="flex flex-col gap-2 text-[13px]">
              <Fact label="Program type" value={PROGRAM_TYPE_LABELS[program.programType as ProgramType] ?? program.programType} />
              <Fact label="Company domain" value={program.companyDomain} mono />
              <Fact label="Country" value={program.countryName ?? undefined} />
              <Fact label="Assets in scope" value={String(program.assetCount)} />
              <Fact
                label="Technologies"
                value={program.technologies.length > 0 ? program.technologies.join(', ') : undefined}
              />
              <Fact
                label="Reporting"
                value={program.contactMethods.length > 0 ? program.contactMethods.join(', ') : undefined}
              />
              {program.hasThirdPartyProgram ? (
                <Fact
                  label="Also on"
                  value={
                    program.thirdPartyPlatforms
                      .map((id) => platformById(id)?.name ?? id)
                      .join(', ') || undefined
                  }
                />
              ) : null}
            </dl>
          </Card>

          {/* Sources */}
          <Card>
            <SectionTitle hint="Every route by which this program was found, with its reliability.">
              Sources
            </SectionTitle>
            {program.sources.length === 0 ? (
              <p className="text-[13px] text-faint italic">No sources recorded.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {program.sources.map((source) => (
                  <li key={source.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-ok" aria-hidden>
                        ✓
                      </span>
                      <span className="text-[13px] font-semibold">
                        {SOURCE_KIND_LABELS[source.kind as SourceKind] ?? source.kind}
                      </span>
                      <Badge tone="neutral" mono title="Source reliability">
                        {Math.round(source.reliability * 100)}%
                      </Badge>
                    </div>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer noopener nofollow"
                      className="break-all pl-5 font-mono text-[11px] text-faint hover:text-accent"
                    >
                      {displayUrl(source.url, 60)}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Timeline */}
          <Card>
            <SectionTitle>Timeline</SectionTitle>
            <Timeline program={program} />
          </Card>

          {program.versions.length > 0 ? (
            <Card>
              <SectionTitle hint="Stored snapshots of the program page.">Versions</SectionTitle>
              <ul className="flex flex-col gap-1 text-[12px]">
                {program.versions.slice(0, 12).map((version) => (
                  <li key={version.id} className="flex items-center justify-between gap-2">
                    <span className="font-semibold">v{version.version}</span>
                    <span className="tabular text-faint">{formatDate(version.capturedAt)}</span>
                    <span className="font-mono text-faint">{version.contentHash.slice(0, 8)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ */

function DateField({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: Date | null;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</dt>
      <dd className={`tabular mt-0.5 ${emphasis ? 'text-[15px] font-bold' : 'text-[13px] font-semibold'}`}>
        {value ? formatDate(value) : <Unknown />}
      </dd>
      {note ? <p className="mt-0.5 text-[11px] text-faint">{note}</p> : null}
    </div>
  );
}

function AssetList({
  title,
  tone,
  symbol,
  assets,
}: {
  title: string;
  tone: 'ok' | 'danger';
  symbol: string;
  assets: Array<{ id: number; identifier: string; category: string; description: string | null }>;
}) {
  return (
    <div>
      <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-faint">{title}</h3>
      {assets.length === 0 ? (
        <p className="text-[12px] text-faint italic">None listed</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {assets.map((asset) => (
            <li key={asset.id} className="flex items-start gap-1.5">
              <span className={tone === 'ok' ? 'text-ok' : 'text-danger'} aria-hidden>
                {symbol}
              </span>
              <div className="min-w-0">
                <span className="break-all font-mono text-[12px]">{asset.identifier}</span>
                {asset.category !== 'other' ? (
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-faint">
                    {asset.category}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</p>
      <p className="tabular mt-0.5 text-xl font-bold text-paid">
        {value ?? <span className="text-[15px] font-semibold text-faint italic">Not specified</span>}
      </p>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-faint">{label}</dt>
      <dd className={`min-w-0 break-words text-right font-semibold ${mono ? 'font-mono text-[12px]' : ''}`}>
        {value ?? <Unknown label="Not specified" />}
      </dd>
    </div>
  );
}

/** Chronological view built from the dates and change events we actually hold. */
function Timeline({
  program,
}: {
  program: {
    launchDate: Date | null;
    publishedDate: Date | null;
    firstSeenAt: Date;
    lastVerifiedAt: Date | null;
    changes: Array<{ id: number; summary: string; detectedAt: Date; changeType: string }>;
  };
}) {
  const entries: Array<{ date: Date; label: string; key: string }> = [];

  if (program.launchDate) {
    entries.push({ date: program.launchDate, label: 'Program launched', key: 'launch' });
  } else if (program.publishedDate) {
    entries.push({ date: program.publishedDate, label: 'Page published', key: 'published' });
  }
  entries.push({ date: program.firstSeenAt, label: 'Program discovered', key: 'discovered' });

  for (const change of program.changes.slice(0, 10)) {
    if (change.changeType === 'program_discovered') continue;
    entries.push({ date: change.detectedAt, label: change.summary, key: `c${change.id}` });
  }
  if (program.lastVerifiedAt) {
    entries.push({ date: program.lastVerifiedAt, label: 'Last page verification', key: 'verified' });
  }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());

  if (entries.length === 0) return <EmptyState title="No timeline events" />;

  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => (
        <li key={entry.key} className="flex gap-2.5">
          <div className="flex flex-col items-center">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            {index < entries.length - 1 ? <span className="w-px flex-1 bg-border" aria-hidden /> : null}
          </div>
          <div className="pb-3">
            <p className="tabular text-[11px] font-semibold uppercase tracking-wide text-faint">
              {formatDate(entry.date)}
            </p>
            <p className="text-[13px]">{entry.label}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
