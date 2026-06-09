// Adopted from ccread/src/services/api/withRetry.ts and errors.ts
// Cascading classifier: specific -> generic

export type ErrorCategory =
  | 'auth_error'
  | 'rate_limit'
  | 'server_error'
  | 'connection_error'
  | 'timeout'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
}

// Error codes that indicate transient connection issues
const RETRYABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'ERR_SSL_PACKET_LENGTH',
]);

const RETRYABLE_HTTP_STATUS = new Set([429, 502, 503, 504]);

export function classifyError(err: Error | string): ClassifiedError {
  const msg = typeof err === 'string' ? err : err.message || String(err);

  // Auth errors — not retryable
  if (/401|403|unauthorized|forbidden|auth|token|login|credential/i.test(msg)) {
    return {
      category: 'auth_error',
      message: `Authentication failed: ${msg}. Check your token in settings.`,
      retryable: false,
    };
  }

  // Rate limiting — retryable with backoff
  if (/429|rate.?limit|too many requests/i.test(msg)) {
    return {
      category: 'rate_limit',
      message: `Rate limited: ${msg}. Will retry with backoff.`,
      retryable: true,
    };
  }

  // Server errors — retryable
  if (/502|503|504|bad gateway|service unavailable|gateway timeout/i.test(msg)) {
    return {
      category: 'server_error',
      message: `Server error: ${msg}. Will retry.`,
      retryable: true,
    };
  }

  // SSL errors — usually non-retryable (unless self-signed and verifySsl:false)
  if (/certificate|ssl|tls|EPROTO/i.test(msg)) {
    return {
      category: 'connection_error',
      message: `SSL error: ${msg}. If using a self-signed certificate, disable SSL verification in settings.`,
      retryable: false,
    };
  }

  // Known retryable connection codes
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as any).code as string;
    if (RETRYABLE_CODES.has(code)) {
      return {
        category: 'connection_error',
        message: `Connection error (${code}): ${msg}. Will retry.`,
        retryable: true,
      };
    }
  }
  if (RETRYABLE_CODES.has(msg.split(':')[0].trim())) {
    return {
      category: 'connection_error',
      message: `Connection error: ${msg}. Will retry.`,
      retryable: true,
    };
  }

  // Timeout — retryable
  if (/timeout|timed.?out/i.test(msg)) {
    return {
      category: 'timeout',
      message: `Request timed out: ${msg}. Will retry.`,
      retryable: true,
    };
  }

  // Connection errors (general) — retryable
  if (/ECONN|ENET|EHOST|ERR_CONNECTION|ERR_NETWORK|ERR_PROXY/i.test(msg)) {
    return {
      category: 'connection_error',
      message: `Network error: ${msg}. Will retry.`,
      retryable: true,
    };
  }

  return {
    category: 'unknown',
    message: msg,
    retryable: false,
  };
}

// Exponential backoff with jitter (adopted from ccread BASE_DELAY_MS pattern)
export function getRetryDelay(attempt: number, baseMs = 500): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * 300;
  return exponential + jitter;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
