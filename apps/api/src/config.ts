import { sessionCookieName, type ApiEnv } from '@conote/shared';

export type Clock = () => Date;

export interface RateLimitRule {
  max: number;
  timeWindowMs: number;
}

/**
 * Rate-limit rules (docs/API_CONTRACTS.md §1, D25). Values are the initial Phase 2
 * choices recorded in docs/ARCHITECTURE.md §10.4; they are tunable, not measured.
 */
export interface RateLimits {
  /** Per client IP, all authenticated endpoints. */
  general: RateLimitRule;
  /** Per client IP: AUTH-01. */
  register: RateLimitRule;
  /** Per client IP: AUTH-02. */
  login: RateLimitRule;
  /** Per normalized email: AUTH-02 (brute force on one account from many addresses). */
  loginAccount: RateLimitRule;
  /** Per client IP and per user: AUTH-07. */
  password: RateLimitRule;
}

const MINUTE = 60_000;
const DAY_MS = 24 * 60 * MINUTE;

export const DEFAULT_RATE_LIMITS: RateLimits = {
  general: { max: 300, timeWindowMs: MINUTE },
  register: { max: 10, timeWindowMs: 60 * MINUTE },
  login: { max: 20, timeWindowMs: 15 * MINUTE },
  loginAccount: { max: 10, timeWindowMs: 15 * MINUTE },
  password: { max: 5, timeWindowMs: 15 * MINUTE },
};

export interface ApiConfig {
  nodeEnv: 'development' | 'test' | 'production';
  allowedOrigins: string[];
  /** Trusted reverse-proxy addresses; empty = trust none. */
  trustProxy: string[];
  sessionIdleTtlMs: number;
  sessionAbsoluteTtlMs: number;
  cookieName: string;
  secureCookies: boolean;
  rateLimits: RateLimits;
  /** Redis key prefix for rate-limit counters. */
  rateLimitNamespace: string;
}

export function createApiConfig(
  env: Pick<
    ApiEnv,
    | 'NODE_ENV'
    | 'ALLOWED_ORIGINS'
    | 'TRUST_PROXY'
    | 'SESSION_IDLE_TTL_DAYS'
    | 'SESSION_ABSOLUTE_TTL_DAYS'
  >,
): ApiConfig {
  return {
    nodeEnv: env.NODE_ENV,
    allowedOrigins: env.ALLOWED_ORIGINS,
    trustProxy: env.TRUST_PROXY,
    sessionIdleTtlMs: env.SESSION_IDLE_TTL_DAYS * DAY_MS,
    sessionAbsoluteTtlMs: env.SESSION_ABSOLUTE_TTL_DAYS * DAY_MS,
    cookieName: sessionCookieName(env.NODE_ENV),
    secureCookies: env.NODE_ENV === 'production',
    rateLimits: DEFAULT_RATE_LIMITS,
    rateLimitNamespace: 'conote:rl:',
  };
}
