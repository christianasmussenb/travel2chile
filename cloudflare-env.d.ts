interface CloudflareEnv {
  travel2chile_db: D1Database;
  travel2chile_kv: KVNamespace;
  travel2chile_images: R2Bucket;
  OPENROUTER_API_KEY: string;
  ASSETS: Fetcher;
  IMAGES: ImagesBinding;
  WORKER_SELF_REFERENCE: Fetcher;
}
