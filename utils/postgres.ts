import { Pool, PoolClient, QueryResult } from "pg";
import dotenv from "dotenv";

dotenv.config();

let poolInstance: Pool | null = null;

// Create a mock pool that implements the Pool interface but does nothing
const createMockPool = (): Pool => {
  const mockQueryResult: QueryResult = {
    command: "",
    rowCount: 0,
    oid: 0,
    fields: [],
    rows: [],
  };

  const mockClient = {
    query: async () => mockQueryResult,
    release: () => {},
    connect: async () => {},
    on: () => mockClient,
    off: () => mockClient,
    removeListener: () => mockClient,
    removeAllListeners: () => mockClient,
    once: () => mockClient,
    addListener: () => mockClient,
    emit: () => false,
    eventNames: () => [],
    getMaxListeners: () => 0,
    listenerCount: () => 0,
    listeners: () => [],
    prependListener: () => mockClient,
    prependOnceListener: () => mockClient,
    rawListeners: () => [],
    setMaxListeners: () => mockClient,
    queryStream: () => ({ on: () => {}, destroy: () => {} }),
    ref: () => mockClient,
    unref: () => mockClient,
    escapeLiteral: (str: string) => str,
    escapeIdentifier: (str: string) => str,
    cancel: async () => {},
    pauseDrain: () => {},
    resumeDrain: () => {},
  } as unknown as PoolClient;

  const mockPool = {
    connect: async () => mockClient,
    end: async () => {},
    query: async () => mockQueryResult,
    on: () => mockPool,
    off: () => mockPool,
    removeListener: () => mockPool,
    removeAllListeners: () => mockPool,
    once: () => mockPool,
    addListener: () => mockPool,
    emit: () => false,
    eventNames: () => [],
    getMaxListeners: () => 0,
    listenerCount: () => 0,
    listeners: () => [],
    prependListener: () => mockPool,
    prependOnceListener: () => mockPool,
    rawListeners: () => [],
    setMaxListeners: () => mockPool,
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  } as unknown as Pool;

  return mockPool;
};

const createPool = (): Pool => {
  if (!process.env.ABI_DATABASE_URL) {
    console.warn("ABI_DATABASE_URL not defined - ABI storage will be disabled");
    return createMockPool();
  }

  const pool = new Pool({
    connectionString: process.env.ABI_DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  pool.on("error", (err) => {
    console.error("Unexpected error on idle client:", {
      error: err.message,
      stack: err.stack,
    });
  });

  return pool;
};

export const getPool = (): Pool => {
  if (!poolInstance) {
    poolInstance = createPool();
  }
  return poolInstance;
};

export const pool = getPool();

export const executeQuery = async <T>(
  queryFn: (client: PoolClient) => Promise<T>,
  retries = 3
): Promise<T> => {
  const pool = getPool();
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await pool.connect();
      try {
        return await queryFn(client);
      } finally {
        client.release();
      }
    } catch (err: any) {
      lastError = err;
      console.error(`Database connection attempt ${attempt} failed:`, {
        error: err.message,
        code: err.code,
        host: new URL(process.env.ABI_DATABASE_URL || "").hostname,
      });

      if (attempt < retries) {
        // Wait before retrying (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 1000)
        );
      }
    }
  }
  throw lastError;
};

const testConnection = async (): Promise<void> => {
  if (!process.env.ABI_DATABASE_URL) {
    console.warn("Skipping PostgreSQL connection test - ABI_DATABASE_URL not defined");
    return;
  }

  try {
    await executeQuery(async (client) => {
      const result = await client.query("SELECT NOW()");
      console.log(
        "Successfully connected to PostgreSQL at:",
        result.rows[0].now
      );
    });
  } catch (err) {
    console.error("Error connecting to PostgreSQL:", err);
  }
};

void testConnection();
