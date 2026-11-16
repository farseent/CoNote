import { z } from 'zod';
import { LOG_LEVELS } from './logging.js';

/**
 * Environment variable names and validation (docs/DEPLOYMENT.md §4).
 * Only variables used by the current phase are validated. Later phases add
 * their variables together with the code that uses them.
 *
 * Validation errors list variable NAMES and reasons only, never the values,
 * because values may be secrets.
 */

const port = (defaultPort: number) =>
  z.coerce.number().int().min(1).max(65535).default(defaultPort);

const postgresUrl = z
  .string()
  .min(1)
  .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must start with postgresql:// or postgres://');

const redisUrl = z
  .string()
  .min(1)
  .refine((v) => /^rediss?:\/\//.test(v), 'must start with redis:// or rediss://');

const httpOrigin = z
  .string()
  .min(1)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin === v;
    } catch {
      return false;
    }
  }, 'must be an origin such as http://localhost:3000 (no path, no trailing slash)');

const httpUrl = z
  .string()
  .min(1)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an http(s) URL');

const PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
const IP_OR_CIDR = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;

const trustedProxies = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  )
  .refine((entries) => entries.every((e) => PROXY_KEYWORDS.has(e) || IP_OR_CIDR.test(e)), {
    error: 'must be a comma-separated list of IPs, CIDR ranges, loopback, linklocal or uniquelocal',
  });

const days = (defaultDays: number) => z.coerce.number().int().min(1).max(365).default(defaultDays);

const nodeEnv = z.enum(['development', 'test', 'production']);
const logLevel = z.enum(LOG_LEVELS).default('info');

export const apiEnvSchema = z
  .object({
    NODE_ENV: nodeEnv,
    LOG_LEVEL: logLevel,
    DATABASE_URL: postgresUrl,
    REDIS_URL: redisUrl,
    PORT: port(4000),
    APP_URL: httpOrigin,
    ALLOWED_ORIGINS: z.string().optional(),
    /**
     * Addresses of reverse proxies whose `X-Forwarded-For` is trusted: comma-separated
     * IPs, CIDR ranges or the keywords `loopback`, `linklocal`, `uniquelocal`. Empty (the
     * default) trusts none. The client address is the first untrusted entry from the right,
     * so a client-supplied left-most entry is ignored and a direct client cannot spoof it.
     */
    TRUST_PROXY: trustedProxies,
    /** Idle (sliding) session lifetime; docs/DECISIONS.md D5 (7 days). */
    SESSION_IDLE_TTL_DAYS: days(7),
    /** Absolute session lifetime; docs/DECISIONS.md D5 (30 days). */
    SESSION_ABSOLUTE_TTL_DAYS: days(30),
    /**
     * Directory of the local-disk image storage adapter (D55). Relative paths are resolved
     * against the API's working directory. Use a persistent volume; it is not a database.
     */
    ASSET_STORAGE_DIR: z.string().min(1).default('.data/assets'),
  })
  .transform((env) => ({
    ...env,
    ALLOWED_ORIGINS: parseOriginList(env.ALLOWED_ORIGINS, env.APP_URL),
  }));
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const collabEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,
  DATABASE_URL: postgresUrl,
  REDIS_URL: redisUrl,
  COLLAB_PORT: port(4100),
});
export type CollabEnv = z.infer<typeof collabEnvSchema>;

export const webEnvSchema = z.object({
  NODE_ENV: nodeEnv,
  APP_URL: httpOrigin,
  API_INTERNAL_URL: httpUrl,
});
export type WebEnv = z.infer<typeof webEnvSchema>;

/** Migration/Prisma tooling only needs the database URL. */
export const dbEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
});
export type DbEnv = z.infer<typeof dbEnvSchema>;

export class EnvValidationError extends Error {
  readonly issues: readonly { variable: string; message: string }[];

  constructor(scope: string, issues: readonly { variable: string; message: string }[]) {
    const lines = issues.map((i) => `  - ${i.variable}: ${i.message}`).join('\n');
    super(`Invalid environment for ${scope}:\n${lines}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Validate an environment-like object (e.g. `process.env`) against a schema.
 * Pure: the caller supplies the source. Throws EnvValidationError listing
 * variable names and reasons, never values.
 */
export function parseEnv<S extends z.ZodType>(
  scope: string,
  schema: S,
  source: Record<string, string | undefined>,
): z.output<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    variable: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    message: issue.message,
  }));
  throw new EnvValidationError(scope, issues);
}

export function parseOriginList(raw: string | undefined, fallback: string): string[] {
  const source = raw === undefined || raw.trim() === '' ? fallback : raw;
  return source
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
