import type {
  AssetCategory,
  ProgramStatus,
  ProgramType,
  RewardKind,
  SourceKind,
} from '@/lib/constants';

/** Structured view of a fetched HTML document. */
export interface ParsedPage {
  url: string;
  finalUrl: string;
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  lang: string | null;
  /** Whitespace-normalised visible text. */
  text: string;
  /** Lowercased `text`, cached because nearly every detector needs it. */
  lowerText: string;
  headings: Array<{ level: number; text: string }>;
  links: Array<{ href: string; text: string; rel: string | null }>;
  /** All JSON-LD blocks, flattened over `@graph`. */
  jsonLd: Array<Record<string, unknown>>;
  meta: Record<string, string>;
  /** Definition-style `dt/dd`, table rows and list items, kept structured. */
  lists: Array<{ heading: string | null; items: string[] }>;
  tables: Array<{ heading: string | null; rows: string[][] }>;
  emails: string[];
  /** `<time datetime="...">` values. */
  timeElements: Array<{ datetime: string | null; text: string }>;
}

/** A URL worth fetching, produced by a discovery source. */
export interface CandidateUrl {
  url: string;
  sourceKind: SourceKind;
  sourceDetail?: string;
  /** Prefilter score; higher is fetched first. */
  priority: number;
  /** Optional hint about launch date from the source (e.g. sitemap lastmod). */
  hintedDate?: Date | null;
  hintedDateKind?: DateSignalKind;
}

export type DateSignalKind =
  | 'explicit_launch_text'
  | 'json_ld_date_published'
  | 'json_ld_date_modified'
  | 'meta_published_time'
  | 'meta_modified_time'
  | 'time_element'
  | 'security_txt_expires'
  | 'sitemap_lastmod'
  | 'rss_published'
  | 'http_last_modified'
  | 'search_engine_indexed'
  | 'page_text_date'
  | 'first_discovered';

export interface DateSignal {
  kind: DateSignalKind;
  date: Date;
  /** 0..1 — how strongly this signal indicates the *launch* date. */
  weight: number;
  raw: string;
}

export interface ExtractedDates {
  /** Best estimate of when the program went live, or null when unknowable. */
  launchDate: Date | null;
  launchDateSource: DateSignalKind | null;
  publishedDate: Date | null;
  modifiedDate: Date | null;
  signals: DateSignal[];
}

export interface ExtractedAsset {
  identifier: string;
  normalizedIdentifier: string;
  category: AssetCategory;
  inScope: boolean;
  description?: string;
}

export interface ExtractedRewardTier {
  tier: string;
  tierRank: number;
  minAmount: number | null;
  maxAmount: number | null;
  currency: string | null;
  rawText: string;
}

export interface ExtractedRewards {
  kind: RewardKind;
  currency: string | null;
  minBounty: number | null;
  maxBounty: number | null;
  tiers: ExtractedRewardTier[];
}

export interface ClassificationResult {
  programType: ProgramType;
  status: ProgramStatus;
  /** 0..1 confidence that this page really is a program page. */
  programScore: number;
  /** True when the page is about bug bounties but is not itself a program. */
  isFalsePositive: boolean;
  rejectionReason: string | null;
  matchedSignals: string[];
}

export interface SelfHostedResult {
  selfHosted: boolean;
  /** Set when the page itself lives on a third-party platform. */
  hostedOnPlatform: string | null;
  /** Platform ids linked from the page. */
  linkedPlatforms: string[];
  hasThirdPartyProgram: boolean;
  /**
   * True when the page exists only to point at a third-party platform — it has
   * no policy of its own worth tracking as a self-hosted program.
   */
  redirectsToPlatform: boolean;
  reasons: string[];
}

export interface ConfidenceFactor {
  id: string;
  label: string;
  points: number;
}

export interface ConfidenceResult {
  score: number;
  band: string;
  factors: ConfidenceFactor[];
}

/** Everything the pipeline learned about one page. */
export interface AnalyzedProgram {
  url: string;
  finalUrl: string;
  companyDomain: string;
  companyName: string;
  companyWebsite: string;
  programName: string;
  summary: string | null;
  classification: ClassificationResult;
  selfHosted: SelfHostedResult;
  dates: ExtractedDates;
  assets: ExtractedAsset[];
  rewards: ExtractedRewards;
  confidence: ConfidenceResult;
  contactMethods: string[];
  technologies: string[];
  countryCode: string | null;
  countryName: string | null;
  policyText: string | null;
  contentHash: string;
  contentText: string;
  languages: string[];
  facets: ScopeFacets;
}

export interface ScopeFacets {
  hasApi: boolean;
  hasAndroid: boolean;
  hasIos: boolean;
  hasMobile: boolean;
  hasWildcard: boolean;
  hasCloud: boolean;
  hasWeb: boolean;
  assetCount: number;
}

export interface AnalysisContext {
  /** Signals the discovery source already knows about. */
  sourceKind: SourceKind;
  sourceDetail?: string;
  hintedDate?: Date | null;
  hintedDateKind?: DateSignalKind;
  /** `Last-Modified` from the HTTP response. */
  httpLastModified?: Date | null;
  /** Whether a security.txt was found for this domain. */
  securityTxtFound?: boolean;
  /** Number of distinct discovery sources that pointed at this page. */
  independentSignals?: number;
  now?: Date;
}
