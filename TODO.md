# Files to Modify

- [x] utils/openai.ts
  - Added EMBEDDING_ENABLED environment variable check
  - Made embedding generation optional
  - Return empty embeddings when disabled

- [ ] utils/index.ts
  - Add REDIS_ENABLED environment variable check
  - Make Redis client creation optional
  - Add fallbacks for when Redis is disabled

- [ ] utils/postgres.ts
  - Make ABI_DATABASE_URL optional
  - Add warning when not configured
  - Provide stub implementation when disabled

- [ ] scripts/setupDatabase.ts
  - Create new setup script
  - Add database initialization logic
  - Add error handling for missing env vars

- [ ] .env.example
  - Add new environment variables
  - Document optional vs required vars
  - Add example values

- [ ] ponder.config.ts
  - Add checks for required RPC URLs
  - Add error messages for missing vars
  - Document required configuration
