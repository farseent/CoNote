import type {
  ChangePasswordRequest,
  ErrorCode,
  ErrorDetail,
  LoginRequest,
  RegisterRequest,
  SessionInfoDto,
  UpdateProfileRequest,
  UserDto,
} from '@conote/shared';

/** Error raised for every failed API call, whatever the cause. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK_ERROR' | 'UNKNOWN';
  readonly details: ErrorDetail[];
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(input: {
    status: number;
    code: ApiError['code'];
    message: string;
    details?: ErrorDetail[];
    requestId?: string;
    retryAfterSeconds?: number;
  }) {
    super(input.message);
    this.name = 'ApiError';
    this.status = input.status;
    this.code = input.code;
    this.details = input.details ?? [];
    this.requestId = input.requestId;
    this.retryAfterSeconds = input.retryAfterSeconds;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      // The API requires a JSON content type on every state-changing request (D25).
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  } catch {
    throw new ApiError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }

  if (isRecord(json) && json['success'] === true) return json['data'] as T;

  const retryAfter = Number(response.headers.get('retry-after'));
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
  if (isRecord(json) && json['success'] === false && isRecord(json['error'])) {
    const error = json['error'];
    throw new ApiError({
      status: response.status,
      code: typeof error['code'] === 'string' ? (error['code'] as ErrorCode) : 'UNKNOWN',
      message: typeof error['message'] === 'string' ? error['message'] : 'Request failed.',
      details: Array.isArray(error['details']) ? (error['details'] as ErrorDetail[]) : [],
      ...(typeof error['requestId'] === 'string' ? { requestId: error['requestId'] } : {}),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    });
  }
  throw new ApiError({
    status: response.status,
    code: 'UNKNOWN',
    message: 'The server returned an unexpected response.',
  });
}

export const api = {
  register: (input: RegisterRequest) =>
    request<{ user: UserDto }>('POST', '/api/v1/auth/register', input),
  login: (input: LoginRequest) => request<{ user: UserDto }>('POST', '/api/v1/auth/login', input),
  logout: () => request<null>('POST', '/api/v1/auth/logout'),
  updateProfile: (input: UpdateProfileRequest) =>
    request<{ user: UserDto }>('PATCH', '/api/v1/users/me', input),
  changePassword: (input: ChangePasswordRequest) =>
    request<null>('POST', '/api/v1/auth/password', input),
  listSessions: () => request<{ sessions: SessionInfoDto[] }>('GET', '/api/v1/auth/sessions'),
  revokeSession: (sessionId: string) =>
    request<null>('DELETE', `/api/v1/auth/sessions/${encodeURIComponent(sessionId)}`),
};

/** Human-readable text for an API failure, safe to show to the user. */
export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return 'Incorrect email or password.';
    case 'EMAIL_TAKEN':
      return 'An account with this email already exists.';
    case 'RATE_LIMITED': {
      const seconds = error.retryAfterSeconds;
      if (seconds === undefined) return 'Too many attempts. Please wait a moment and try again.';
      const wait = seconds >= 90 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
      return `Too many attempts. Please try again in about ${wait}.`;
    }
    case 'SERVICE_UNAVAILABLE':
      return 'The service is temporarily unavailable. Please try again shortly.';
    case 'NETWORK_ERROR':
      return error.message;
    case 'INVALID_ORIGIN':
    case 'UNSUPPORTED_MEDIA_TYPE':
      return 'The request was rejected. Reload the page and try again.';
    case 'VALIDATION_ERROR':
      return 'Please check the highlighted fields.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

/** Map API field errors (`details`) to `{ field: message }`. */
export function fieldErrorsFromApi(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const result: Record<string, string> = {};
  for (const detail of error.details) {
    if (detail.path !== '' && result[detail.path] === undefined)
      result[detail.path] = detail.message;
  }
  return result;
}
