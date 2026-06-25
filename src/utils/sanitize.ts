const SECRET_PATTERNS = {
  jwt: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
  bearer: /\bBearer\s+[a-zA-Z0-9._~+/=-]{12,}/gi,
  headerSecret: /\b(authorization|x-api-key|apikey|api-key|access-token|refresh-token|set-cookie|cookie|x-shopify-hmac-sha256|x-webhook-signature|signature)\b(\s*[:=]\s*)['"]?[^'",\s}]+/gi,
  keyValue: /(api[_-]?key|secret|token|password|authorization|service[_-]?role|anon[_-]?key|publishable[_-]?key|signing[_-]?secret|client[_-]?secret)['":\s]*[=:]\s*['"]?([a-zA-Z0-9_\-./+=]{8,})['"]?/gi,
  querySecret: /([?&](?:token|access_token|refresh_token|api_key|apikey|key|secret|signature|hmac|state|code|password)=)[^&#\s]+/gi,
};

const PII_PATTERNS = {
  email: /([a-zA-Z0-9._%+-]+)@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi,
  phone: /(\+?\d{1,4})?[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
};

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'supabasetoken',
  'shopifysessiontoken',
  'apikey',
  'apisecretkey',
  'secret',
  'clientsecret',
  'signingsecret',
  'webhooksignature',
  'servicerolekey',
  'anonkey',
  'publishablekey',
  'authorization',
  'hmac',
  'signature',
  'xshopifyhmacsha256',
  'xwebhooksignature',
  'cookie',
  'setcookie',
  'session',
  'sessiontoken',
  'deliverylinktoken',
  'otp',
  'pin',
  'verificationcode',
]);

function redactString(value: string): string {
  let redacted = value
    .replace(SECRET_PATTERNS.jwt, '[JWT_REDACTED]')
    .replace(SECRET_PATTERNS.bearer, 'Bearer [REDACTED]')
    .replace(SECRET_PATTERNS.headerSecret, '$1$2[REDACTED]')
    .replace(SECRET_PATTERNS.keyValue, '$1=[REDACTED]')
    .replace(SECRET_PATTERNS.querySecret, '$1[REDACTED]');

  if (import.meta.env.PROD) {
    redacted = redacted.replace(PII_PATTERNS.email, (_match, local, domain) => `${local.slice(0, 2)}***@${domain}`);
    redacted = redacted.replace(PII_PATTERNS.phone, (match) => {
      const cleaned = match.replace(/[-.\s()]/g, '');
      if (cleaned.length < 8) return match;
      return `${cleaned.slice(0, 3)}***${cleaned.slice(-2)}`;
    });
  }

  return redacted;
}

export function sanitizeForClientLogs<T = unknown>(value: T, depth = 0): T {
  if (depth > 8) return '[MAX_DEPTH]' as T;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value) as T;
  if (typeof value !== 'object') return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(import.meta.env.DEV ? { stack: redactString(value.stack || '') } : {}),
    } as T;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeForClientLogs(item, depth + 1)) as T;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(input)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      SENSITIVE_KEYS.has(normalizedKey) ||
      normalizedKey.includes('password') ||
      normalizedKey.includes('token') ||
      normalizedKey.includes('secret') ||
      normalizedKey.includes('apikey') ||
      normalizedKey.includes('authorization')
    ) {
      output[key] = '[REDACTED]';
      continue;
    }

    output[key] = sanitizeForClientLogs(nestedValue, depth + 1);
  }

  return output as T;
}

export function installConsoleSanitizer(): void {
  const consoleWithFlag = console as Console & { __ordefySanitized?: boolean };
  if (consoleWithFlag.__ordefySanitized) return;

  for (const method of ['log', 'debug', 'info', 'warn', 'error'] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      original(...args.map((arg) => sanitizeForClientLogs(arg)));
    };
  }

  consoleWithFlag.__ordefySanitized = true;
}
