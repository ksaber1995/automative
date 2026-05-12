import { AsyncLocalStorage } from 'async_hooks';

/**
 * Per-request data that flows alongside the async chain without having to
 * thread it through every function signature. Populated in `src/index.ts`
 * before the ts-rest router runs.
 */
export interface RequestContextData {
  ip: string | null;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export function runWithRequestContext<T>(data: RequestContextData, fn: () => T): T {
  return storage.run(data, fn);
}

export function getRequestContext(): RequestContextData | undefined {
  return storage.getStore();
}

export function getClientIp(): string | null {
  return storage.getStore()?.ip ?? null;
}
