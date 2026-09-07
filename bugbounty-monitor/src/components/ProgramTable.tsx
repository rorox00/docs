import Link from 'next/link';
import { daysSince, formatDate, formatRelative } from '@/lib/dates';
import { displayUrl } from '@/lib/url';
import { formatAmountShort } from '@/pipeline/extract/rewards';
import type { ProgramListItem } from '@/server/repos/queryRepo';
import {
  Badge,
  ConfidenceBadge,
  EmptyState,
  ProgramTypeBadge,
  SelfHostedBadge,
  StatusBadge,
  Unknown,
} from './ui';

/**
 * The dense program table.
 *
 * The launch column is the one place the accuracy rules bite hardest: when a
 * launch date is unknown the cell says so and shows the *discovery* date on a
 * second line, clearly labelled, rather than passing one off as the other.
 */
export function ProgramTable({
  programs,
  now = new Date(),
  emptyTitle = 'No programs match these filters',
  emptyHint,
}: {
  programs: ProgramListItem[];
  now?: Date;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  if (programs.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <div className="scroll-x rounded-[10px] border border-border bg-surface shadow-[var(--shadow)]">
      <table className="w-full min-w-[1080px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border bg-surface-2 text-left">
            <Th className="w-[22%]">Company</Th>
            <Th className="w-[17%]">Program</Th>
            <Th>Type</Th>
            <Th>Launch</Th>
            <Th className="text-right">Reward</Th>
            <Th>Status</Th>
            <Th className="text-right">Scope</Th>
            <Th>Signals</Th>
            <Th className="text-right">Conf.</Th>
          </tr>
        </thead>
        <tbody>
          {programs.map((program) => {
            const age = daysSince(program.firstSeenAt, now);
            const isFresh = age <= 7;

            return (
              <tr
                key={program.id}
                className="border-b border-border last:border-0 hover:bg-surface-hover"
              >
                {/* Company */}
                <Td>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/programs/${program.id}`}
                        className="block truncate font-semibold text-text hover:text-accent"
                      >
                        {program.companyName}
                      </Link>
                      <span className="block truncate font-mono text-[11px] text-faint">
                        {program.companyDomain}
                        {program.countryCode ? ` · ${program.countryCode}` : ''}
                      </span>
                    </div>
                    {isFresh ? (
                      <Badge tone="new" title={`First discovered ${formatRelative(program.firstSeenAt, now)}`}>
                        NEW
                      </Badge>
                    ) : null}
                  </div>
                </Td>

                {/* Program name + URL */}
                <Td>
                  <Link href={`/programs/${program.id}`} className="block truncate hover:text-accent">
                    {program.name}
                  </Link>
                  <a
                    href={program.programUrl}
                    target="_blank"
                    rel="noreferrer noopener nofollow"
                    className="block truncate font-mono text-[11px] text-faint hover:text-accent"
                    title={program.programUrl}
                  >
                    {displayUrl(program.programUrl, 38)} ↗
                  </a>
                </Td>

                <Td>
                  <ProgramTypeBadge type={program.programType} />
                </Td>

                {/* Launch vs discovery — never conflated. */}
                <Td>
                  {program.launchDate ? (
                    <>
                      <span className="tabular block font-semibold">{formatDate(program.launchDate)}</span>
                      <span className="block text-[11px] text-faint">launch date</span>
                    </>
                  ) : (
                    <>
                      <Unknown />
                      <span className="tabular block text-[11px] text-faint">
                        found {formatDate(program.firstSeenAt)}
                      </span>
                    </>
                  )}
                </Td>

                {/* Reward */}
                <Td className="text-right">
                  {program.rewardKind === 'paid' ? (
                    program.maxBounty !== null ? (
                      <>
                        <span className="tabular block font-semibold text-paid">
                          {formatAmountShort(program.maxBounty, program.bountyCurrency)}
                        </span>
                        {program.minBounty !== null ? (
                          <span className="tabular block text-[11px] text-faint">
                            from {formatAmountShort(program.minBounty, program.bountyCurrency)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <Badge tone="paid">Paid</Badge>
                    )
                  ) : program.rewardKind === 'unknown' ? (
                    <Unknown label="Not specified" />
                  ) : (
                    <Badge tone="neutral">
                      {program.rewardKind === 'hall_of_fame'
                        ? 'Hall of Fame'
                        : program.rewardKind === 'swag'
                          ? 'Swag'
                          : 'No reward'}
                    </Badge>
                  )}
                </Td>

                <Td>
                  <StatusBadge status={program.status} />
                </Td>

                <Td className="text-right">
                  <span className="tabular font-semibold">{program.assetCount}</span>
                  <span className="ml-1 text-[11px] text-faint">assets</span>
                </Td>

                {/* Scope facets at a glance. */}
                <Td>
                  <div className="flex flex-wrap items-center gap-1">
                    <SelfHostedBadge
                      selfHosted={program.selfHosted}
                      hasThirdParty={program.hasThirdPartyProgram}
                    />
                    {program.hasApi ? <Badge tone="info">API</Badge> : null}
                    {program.hasAndroid ? <Badge tone="info">Android</Badge> : null}
                    {program.hasIos ? <Badge tone="info">iOS</Badge> : null}
                    {program.hasWildcard ? <Badge tone="accent" mono>*.</Badge> : null}
                    {program.hasCloud ? <Badge tone="info">Cloud</Badge> : null}
                  </div>
                </Td>

                <Td className="text-right">
                  <ConfidenceBadge score={program.confidenceScore} />
                </Td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-[11px] font-bold uppercase tracking-[0.06em] text-faint ${className}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-top ${className}`}>{children}</td>;
}
