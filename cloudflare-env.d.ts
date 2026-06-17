interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

type R2Bucket = unknown;
type Fetcher = unknown;
type ImagesBinding = unknown;

interface CloudflareEnv {
  travel2chile_db: D1Database;
  travel2chile_kv: KVNamespace;
  travel2chile_images: R2Bucket;
  OPENROUTER_API_KEY: string;
  NEXTJS_ENV?: string;
  ASSETS: Fetcher;
  IMAGES: ImagesBinding;
  WORKER_SELF_REFERENCE: Fetcher;
}
