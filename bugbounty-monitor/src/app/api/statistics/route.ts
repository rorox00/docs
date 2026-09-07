import type { NextRequest } from 'next/server';
import { intParam, ok } from '@/server/api';
import {
  getDashboardStats,
  getDiscoveriesPerDay,
  getDiscoveriesPerWeek,
  getProgramTypeBreakdown,
  getRewardRangeBreakdown,
  getScopeCategoryBreakdown,
  getTopCountries,
} from '@/server/repos/statsRepo';

export const dynamic = 'force-dynamic';

/** GET /api/statistics — dashboard counters plus every chart series. */
export async function GET(request: NextRequest) {
  const days = intParam(request.nextUrl.searchParams, 'days', 30, 1, 365);

  const [summary, perDay, perWeek, types, rewards, countries, scope] = await Promise.all([
    getDashboardStats(),
    getDiscoveriesPerDay(days),
    getDiscoveriesPerWeek(12),
    getProgramTypeBreakdown(),
    getRewardRangeBreakdown(),
    getTopCountries(10),
    getScopeCategoryBreakdown(),
  ]);

  return ok({
    data: {
      summary,
      charts: {
        discoveriesPerDay: perDay,
        discoveriesPerWeek: perWeek,
        programTypes: types,
        rewardRanges: rewards,
        topCountries: countries,
        scopeCategories: scope,
      },
    },
  });
}
