const DEV_TEST_EMAIL = 'test@test.com';

function normalizeEnvValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function isPrivateLanHost(hostname: string): boolean {
  return (
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

function isLocalDevelopmentHost(hostname: string): boolean {
  const normalizedHost = hostname.trim().toLowerCase();

  if (!normalizedHost) {
    return false;
  }

  return (
    normalizedHost === 'localhost' ||
    normalizedHost === '127.0.0.1' ||
    normalizedHost.endsWith('.local') ||
    isPrivateLanHost(normalizedHost)
  );
}

export function isDevTestLoginEnabled(): boolean {
  const flag = normalizeEnvValue(import.meta.env.VITE_ENABLE_DEV_TEST_LOGIN);

  if (flag !== 'true') {
    return false;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  return isLocalDevelopmentHost(window.location.hostname);
}

export function isDevTestLoginEmail(email: string): boolean {
  return email.trim().toLowerCase() === DEV_TEST_EMAIL;
}

export function getDevTestLoginEmail(): string {
  return DEV_TEST_EMAIL;
}
