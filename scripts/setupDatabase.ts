/**
 * Database Setup Script
 * 
 * This script initializes the PostgreSQL database with the required tables and extensions
 * for the AgentScan indexer. It creates the context_embeddings table with vector support
 * for storing embeddings and related metadata.
 * 
 * Prerequisites:
 * 1. PostgreSQL database with vector extension support
 * 2. ABI_DATABASE_URL environment variable set in .env or .env.local
 *    Format: postgresql://user:password@host:port/database
 * 
 * Usage:
 * ```bash
 * # First, ensure your environment variables are set
 * cp .env.example .env.local
 * # Edit .env.local to add your ABI_DATABASE_URL
 * 
 * # Then run the setup script
 * npm run setup-db
 * # or
 * npx ts-node scripts/setupDatabase.ts
 * ```
 * 
 * The script will:
 * 1. Create the vector extension if not exists
 * 2. Create the context_embeddings table with 512-dimension vector support
 * 3. Set up necessary indexes for efficient querying
 */

import { executeQuery } from "../utils/postgres";
import dotenv from "dotenv";

dotenv.config();

async function createTables() {
  const createContextEmbeddingsTable = `
    CREATE TABLE IF NOT EXISTS context_embeddings (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      type TEXT,
      location TEXT,
      content TEXT,
      name TEXT,
      embedding VECTOR(512),
      is_chunk BOOLEAN,
      original_location TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP WITH TIME ZONE
    );
  `;

  const createIndexes = `
    CREATE INDEX IF NOT EXISTS idx_context_embeddings_company_id ON context_embeddings(company_id);
    CREATE INDEX IF NOT EXISTS idx_context_embeddings_type ON context_embeddings(type);
    CREATE INDEX IF NOT EXISTS idx_context_embeddings_location ON context_embeddings(location);
  `;

  try {
    await executeQuery(async (client) => {
      // Create the vector extension if it doesn't exist
      await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
      
      // Create table
      await client.query(createContextEmbeddingsTable);
      
      // Create indexes
      await client.query(createIndexes);
      
      console.log("Successfully created context embeddings table and indexes");
    });
  } catch (error: any) {
    console.error("Error creating database tables:", error.message);
    throw error;
  }
}

async function main() {
  if (!process.env.ABI_DATABASE_URL) {
    console.warn("ABI_DATABASE_URL not defined - skipping database setup");
    process.exit(0);
  }

  try {
    await createTables();
    console.log("Database setup completed successfully");
  } catch (error) {
    console.error("Database setup failed:", error);
    process.exit(1);
  }
}

void main();
