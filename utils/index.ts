import axios from "axios";

import { generateEmbeddingWithRetry } from "./openai";
import { replaceBigInts } from "ponder";
import { createClient } from "redis";
import type { RedisClientType } from "redis";
import {
  ConfigInfo,
  ImplementationResult,
  MetadataJson,
  TokenTransferData,
} from "../src/types";
import { executeQuery, pool } from "./postgres";
import { processPackageDownload } from "./ipfs";

const getAbidataRedisKey = (address: string, network: string): string =>
  `abidata:${address.toLowerCase()}:${network}`;

const TTL = 7 * 24 * 60 * 60; // 1 week

const NEGATIVE_RESPONSE_TTL = 24 * 60 * 60; // 1 day for negative responses

const INITIAL_RETRY_DELAY = 5000;

const INITIAL_TIMEOUT = 30000; // 30 seconds
const MAX_TIMEOUT = 60000; // 60 seconds
const TIMEOUT_MULTIPLIER = 1.5;

const MAX_RETRIES = 150;

const axiosInstance = axios.create({
  timeout: 5000,
  maxContentLength: 500000,
});

// Create a mock Redis client that implements the same interface but does nothing
const createMockRedisClient = (): RedisClientType => {
  const mockClient = {
    isReady: false,
    isOpen: false,
    connect: async () => mockClient,
    disconnect: async () => void 0,
    quit: async () => void 0,
    get: async () => null,
    set: async () => "OK",
    on: () => mockClient,
    off: () => mockClient,
    // Add other required methods with no-op implementations
    sendCommand: async () => null,
    multi: () => ({ exec: async () => [] }),
    QUIT: async () => "OK",
    SELECT: async () => "OK",
    ping: async () => "PONG",
  };
  return mockClient as unknown as RedisClientType;
};

// Initialize Redis client only if REDIS_URL is defined
const redisClient = process.env.REDIS_URL
  ? createClient({
      url: process.env.REDIS_URL,
    })
  : createMockRedisClient();

// Only attempt to connect if we're using a real Redis client
if (process.env.REDIS_URL) {
  redisClient.connect().catch((error) => {
    console.warn(
      "[Redis] Failed to connect to Redis, caching will be disabled:",
      {
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
  });
} else {
  console.debug("[Redis] Redis URL not configured, caching will be disabled");
}

export const getChainName = (contractName: string) => {
  return contractName
    .replace("Registry", "")
    .replace("Staking", "")
    .toLowerCase();
};

export const getChainNameFromId = (chainId: number): string => {
  return chainId === 8453 ? "base" : chainId === 100 ? "gnosis" : "mainnet";
};

export const createChainScopedId = (
  chain: string,
  serviceId: string
): string => {
  const cleanId = serviceId
    .replace(/^service-/g, "")
    .replace(new RegExp(`^${chain}-`, "i"), "");

  return `${chain}-${cleanId}`;
};

export const REGISTER_NAMES = [
  "MainnetRegisterInstance",
  "GnosisRegisterInstance",
  "BaseRegisterInstance",
] as const;

export const CONTRACT_NAMES = [
  "MainnetStaking",
  "GnosisRegistry",
  "BaseRegistry",
  "OptimismRegistry",
  "ArbitrumRegistry",
  "PolygonRegistry",
] as const;

export const getChainId = (chain: string): number => {
  switch (chain.toLowerCase()) {
    case "mainnet":
      return 1;
    case "polygon":
      return 137;
    case "gnosis":
      return 100;
    case "arbitrum":
      return 42161;
    case "optimism":
      return 10;
    case "base":
      return 8453;
    default:
      return 1;
  }
};

export async function fetchMetadata(
  hash: string,
  id: string,
  type: "component" | "service" | "agent"
): Promise<any> {
  if (!hash) {
    console.warn(`No hash provided for ${type} ${id}`);
    return getDefaultMetadata(type, id);
  }

  try {
    const metadata = await fetchAndTransformMetadata(hash, 2, { type, id });
    return metadata || getDefaultMetadata(type, id);
  } catch (error) {
    console.error(
      `Metadata fetch failed for ${type} ${id} with hash ${hash}:`,
      {
        error: error instanceof Error ? error.message : "Unknown error",
      }
    );
    return getDefaultMetadata(type, id);
  }
}

function getDefaultMetadata(
  type: "component" | "service" | "agent",
  id: string
) {
  return {
    name: null,
    description: null,
    image: null,
    codeUri: null,
    packageHash: null,
    metadataURI: null,
  };
}

export async function fetchAndEmbedMetadataWrapper(
  hash: string,
  componentId: string
) {
  try {
    return await fetchAndEmbedMetadata(hash, 2, componentId);
  } catch (error) {
    console.error(`Metadata embed failed for component ${componentId}:`, error);
    return null;
  }
}

export const fetchAndEmbedMetadata = async (
  configHash: string,
  maxRetries = 2,
  componentId: string
) => {
  const configInfo = {
    type: "component" as const,
    id: componentId,
  };

  return await fetchAndTransformMetadata(configHash, maxRetries, configInfo);
};

interface ProxyImplementation {
  address: string;
  abi: any;
}

type ProxyPattern = {
  name: string;
  slot: `0x${string}`;
};

const PROXY_PATTERNS: Record<string, ProxyPattern> = {
  EIP1967: {
    name: "EIP-1967 Proxy",
    slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
  },
  EIP1967_BEACON: {
    name: "EIP-1967 Beacon",
    slot: "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
  },
  SIMPLE_PROXY: {
    name: "Simple Proxy",
    slot: "0x0000000000000000000000000000000000000000000000000000000000000000",
  },
  GNOSIS_SAFE: {
    name: "Gnosis Safe Proxy",
    slot: "0xa619486e6a192c629d6e5c69ba3efd8478c19a6022185a277f24bc5b6e1060f9",
  },
  OPENZEPPELIN: {
    name: "OpenZeppelin Proxy",
    slot: "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
  },
} as const;

const isValidAddress = (address: string): boolean => {
  return Boolean(
    address &&
      address !== "0x" &&
      address.toLowerCase() !== "0x0000000000000000000000000000000000000000" &&
      /^0x[a-fA-F0-9]{40}$/.test(address.toLowerCase())
  );
};

const cleanImplementationAddress = (
  rawAddress: string | null | undefined
): string | null => {
  if (!rawAddress || typeof rawAddress !== "string") {
    return null;
  }

  // Ensure the address has at least 40 characters (20 bytes) to slice
  if (rawAddress.length < 40) {
    return null;
  }

  const cleanAddress = "0x" + rawAddress.slice(-40);
  return isValidAddress(cleanAddress) ? cleanAddress : null;
};

const isBasicProxy = (abi: any[]): boolean => {
  return (
    abi.length <= 2 &&
    abi.some(
      (item) =>
        item.type === "constructor" &&
        item.inputs?.length === 1 &&
        item.inputs[0].type === "address" &&
        (item.inputs[0].name === "_singleton" ||
          item.inputs[0].name === "singleton")
    ) &&
    abi.some((item) => item.type === "fallback")
  );
};

const hasCustomProxyFunction = (abi: any[]): boolean => {
  return abi.some(
    (item) =>
      item.type === "function" &&
      item.name.endsWith("_PROXY") &&
      item.outputs?.length === 1 &&
      item.outputs[0].type === "bytes32" &&
      item.stateMutability === "view"
  );
};

const findCustomProxyFunctions = (abi: any[]) => {
  return abi.filter(
    (item) =>
      item.type === "function" &&
      item.name.endsWith("_PROXY") &&
      item.outputs?.length === 1 &&
      item.outputs[0].type === "bytes32" &&
      item.stateMutability === "view"
  );
};

async function tryGetImplementationFromSlot(
  context: any,
  formattedAddress: string,
  slot: `0x${string}`,
  blockNumber: bigint,
  chainId: number,
  slotDescription: string
): Promise<ProxyImplementation | null> {
  try {
    const implementationAddress = await context.client
      .getStorageAt({
        address: formattedAddress as `0x${string}`,
        slot,
        blockNumber,
      })
      .catch(() => null); // Catch RPC errors and return null

    if (!implementationAddress) {
      return null;
    }

    const cleanAddress = cleanImplementationAddress(implementationAddress);
    if (!cleanAddress) {
      return null;
    }

    const implementationAbi = await checkAndStoreAbi(
      cleanAddress,
      chainId,
      context,
      blockNumber,
      false
    ).catch(() => null); // Catch any ABI fetching errors

    return implementationAbi
      ? { address: cleanAddress, abi: implementationAbi }
      : null;
  } catch (error) {
    // Log the error but don't throw
    console.debug(`[IMP] Error reading from ${slotDescription}:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      slot,
      formattedAddress,
      slotDescription,
    });
    return null;
  }
}

async function tryGetImplementationFromCustomProxy(
  context: any,
  formattedAddress: string,
  proxyFunction: any,
  blockNumber: bigint,
  chainId: number
): Promise<ProxyImplementation | null> {
  try {
    console.log(
      `[IMP] Found proxy storage position function: ${proxyFunction.name}`
    );

    const storageSlot = await context.client.readContract({
      address: formattedAddress as `0x${string}`,
      abi: [proxyFunction],
      functionName: proxyFunction.name,
      blockNumber,
    });

    if (!storageSlot) return null;

    console.log(
      `[IMP] Got storage slot from ${proxyFunction.name}: ${storageSlot}`
    );
    return await tryGetImplementationFromSlot(
      context,
      formattedAddress,
      storageSlot as `0x${string}`,
      blockNumber,
      chainId,
      `custom slot (${proxyFunction.name})`
    );
  } catch (error) {
    console.log(`[IMP] Error reading ${proxyFunction.name}:`, error);
    return null;
  }
}

export function isProxyContract(abi: any): boolean {
  try {
    const abiObj = typeof abi === "string" ? JSON.parse(abi) : abi;

    if (!Array.isArray(abiObj)) {
      console.log("[ABI] Invalid ABI format - not an array");
      return false;
    }

    if (isBasicProxy(abiObj as any[])) {
      return true;
    }

    if (hasCustomProxyFunction(abiObj as any[])) {
      console.log("[ABI] Detected Custom Proxy Pattern with *_PROXY constant");
      return true;
    }

    // Additional proxy checks...
    const isUUPSProxy = abiObj.some(
      (item) =>
        item.type === "function" &&
        item.name === "upgradeTo" &&
        item.inputs?.length === 1 &&
        item.inputs[0].type === "address"
    );

    if (isUUPSProxy) {
      console.log("[ABI] Detected UUPS Proxy Pattern");
      return true;
    }

    const hasGetImplementation = abiObj.some(
      (item) =>
        item.type === "function" &&
        item.name === "getImplementation" &&
        item.outputs?.length === 1 &&
        item.outputs[0].type === "address"
    );

    if (hasGetImplementation) {
      console.log("[ABI] Detected getImplementation Pattern");
      return true;
    }

    return false;
  } catch (error) {
    console.error("[ABI] Error checking proxy status:", error);
    return false;
  }
}

export async function getImplementationAddress(
  contractAddress: string,
  chainId: number,
  context: any,
  blockNumber: bigint
): Promise<ProxyImplementation | null> {
  try {
    if (!isValidAddress(contractAddress)) {
      console.log(`[IMP] Invalid address: ${contractAddress}`);
      return null;
    }

    const formattedAddress = contractAddress.toLowerCase();
    const contractAbi = await checkAndStoreAbi(
      formattedAddress,
      chainId,
      context,
      blockNumber,
      false
    ).catch(() => null);

    if (!contractAbi) {
      console.log(`[IMP] No ABI found for ${formattedAddress}`);
      return null;
    }

    const parsedAbi =
      typeof contractAbi === "string" ? JSON.parse(contractAbi) : contractAbi;

    if (isBasicProxy(parsedAbi)) {
      const implementation = await tryGetImplementationFromSlot(
        context,
        formattedAddress,
        PROXY_PATTERNS.SIMPLE_PROXY?.slot as `0x${string}`,
        blockNumber,
        chainId,
        "slot 0 (basic proxy)"
      );
      if (implementation) return implementation;
    }

    // Check custom proxy functions silently
    const proxyFunctions = findCustomProxyFunctions(parsedAbi);
    for (const proxyFunction of proxyFunctions) {
      try {
        const implementation = await tryGetImplementationFromCustomProxy(
          context,
          formattedAddress,
          proxyFunction,
          blockNumber,
          chainId
        );
        if (implementation) return implementation;
      } catch (error) {
        console.debug(`[IMP] Custom proxy function check failed:`, {
          function: proxyFunction.name,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Check standard proxy patterns silently
    for (const [, pattern] of Object.entries(PROXY_PATTERNS)) {
      const implementation = await tryGetImplementationFromSlot(
        context,
        formattedAddress,
        pattern.slot,
        blockNumber,
        chainId,
        `${pattern.name} slot`
      );
      if (implementation) return implementation;
    }

    // Try getImplementation as last resort
    try {
      const GET_IMPLEMENTATION_ABI = [
        {
          inputs: [],
          name: "getImplementation",
          outputs: [{ type: "address", name: "implementation" }],
          stateMutability: "view",
          type: "function",
        },
      ] as const;

      const implementationAddress = await context.client.readContract({
        address: formattedAddress as `0x${string}`,
        abi: GET_IMPLEMENTATION_ABI,
        functionName: "getImplementation",
        blockNumber,
      });

      if (isValidAddress(implementationAddress)) {
        console.log(
          `[IMP] Found implementation via getImplementation() for ${formattedAddress}: ${implementationAddress}`
        );

        const implementationAbi = await checkAndStoreAbi(
          implementationAddress,
          chainId,
          context,
          blockNumber,
          false
        );

        if (implementationAbi) {
          return { address: implementationAddress, abi: implementationAbi };
        }
      }
    } catch (error) {
      console.log("[IMP] No getImplementation function found");
    }

    console.log(`[IMP] No valid implementation found for ${formattedAddress}`);
    return null;
  } catch (error) {
    console.error(`[IMP] Error getting implementation address:`, error);
    return null;
  }
}

export async function checkAndStoreAbi(
  contractAddress: string,
  chainId: number,
  context: any,
  blockNumber: bigint,
  isImplementation = true
) {
  const formattedAddress = contractAddress.toLowerCase();
  const addressAndChain = `${formattedAddress}-${getChainNameFromId(chainId)}`;

  try {
    if (
      !contractAddress ||
      contractAddress === "0x" ||
      contractAddress.toLowerCase() ===
        "0x0000000000000000000000000000000000000000"
    ) {
      console.log(`[ABI] Invalid contract address: ${contractAddress}`);
      return null;
    }

    if (!formattedAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      console.log(`[ABI] Invalid address format: ${contractAddress}`);
      return null;
    }

    const checkQuery = `
      SELECT content as abi_text
      FROM context_embeddings 
      WHERE id = $1 
      AND type = 'abi'
      LIMIT 1;
    `;

    const existingAbi = await pool.query(checkQuery, [addressAndChain]);

    if (existingAbi.rows.length > 0) {
      const abiText = existingAbi.rows[0].abi_text;
      if (typeof abiText === "string") {
        try {
          const parsedAbi = JSON.parse(abiText);
          if (isImplementation && isProxyContract(parsedAbi)) {
            const implementation = await getImplementationAddress(
              formattedAddress,
              chainId,
              context,
              blockNumber
            );
            if (implementation?.address && implementation?.abi) {
              return implementation.abi;
            }
          }
          return parsedAbi;
        } catch (e) {
          console.error(
            `[ABI] Invalid ABI format in database for ${addressAndChain}`
          );
        }
      }
    }

    const network = getChainNameFromId(chainId);

    if (!network) {
      console.error(
        `[ABI] Unsupported chain ID: ${chainId} for ${formattedAddress}`
      );
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const abidataRedisKey = getAbidataRedisKey(formattedAddress, network);

    try {
      // Only attempt to use Redis cache if REDIS_URL is configured
      if (process.env.REDIS_URL && redisClient.isReady) {
        const cachedAbidataResponse = await redisClient.get(abidataRedisKey);
        if (cachedAbidataResponse) {
          try {
            const parsedResponse = JSON.parse(cachedAbidataResponse);

            if (parsedResponse === null) {
              console.debug(
                `[ABI] Using cached negative response for ${formattedAddress}`
              );
              return null;
            }

            if (Array.isArray(parsedResponse)) {
              const content = JSON.stringify(parsedResponse);

              return await processAbiResponse(
                content,
                formattedAddress,
                chainId,
                context,
                blockNumber,
                isImplementation
              );
            }
          } catch (e) {
            console.warn(
              `[ABI] Invalid cached ABI format for ${formattedAddress}, proceeding without cache`
            );
          }
        }
      }
    } catch (redisError) {
      console.warn(
        `[ABI] Redis cache unavailable for ${formattedAddress}, proceeding without cache:`,
        {
          error:
            redisError instanceof Error ? redisError.message : "Unknown error",
        }
      );
    }

    const url =
      `https://abidata.net/${contractAddress}?network=${network}`.trim();
    console.log(`[ABI] Fetching ABI from: ${url}`);

    try {
      const response = await fetchWithRetry(url, MAX_RETRIES, INITIAL_TIMEOUT);

      if (!response.data?.ok || !response.data.abi) {
        try {
          // Only attempt to cache if REDIS_URL is configured
          if (process.env.REDIS_URL && redisClient.isReady) {
            void redisClient.set(abidataRedisKey, JSON.stringify(null), {
              EX: NEGATIVE_RESPONSE_TTL,
              NX: true,
            });
            console.debug(
              `[ABI] Cached negative response for ${formattedAddress} with ${NEGATIVE_RESPONSE_TTL}s TTL`
            );
          }
        } catch (redisCacheError) {
          console.warn(
            `[ABI] Failed to cache negative response for ${formattedAddress}:`,
            {
              error:
                redisCacheError instanceof Error
                  ? redisCacheError.message
                  : "Unknown error",
            }
          );
        }

        throw new Error("No ABI found in response");
      }

      const processedAbi = JSON.stringify(response.data.abi);

      try {
        // Only attempt to cache if REDIS_URL is configured
        if (process.env.REDIS_URL && redisClient.isReady) {
          void redisClient.set(abidataRedisKey, processedAbi, {
            EX: TTL,
            NX: true,
          });
          console.debug(
            `[ABI] Cached ABI for ${formattedAddress} with ${TTL}s TTL`
          );
        }
      } catch (redisCacheError) {
        console.warn(
          `[ABI] Failed to cache ABI in Redis for ${formattedAddress}, continuing without caching:`,
          {
            error:
              redisCacheError instanceof Error
                ? redisCacheError.message
                : "Unknown error",
          }
        );
      }

      return await processAbiResponse(
        processedAbi,
        formattedAddress,
        chainId,
        context,
        blockNumber,
        isImplementation
      );
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 400) {
        console.log(
          `[ABI] ${formattedAddress} is invalid: ${
            error.response?.data?.message || error.message
          }`
        );
        return null;
      }

      handleFetchError(error, url, formattedAddress);
      return null;
    }
  } catch (error) {
    console.error(`[ABI] Error processing ABI for ${formattedAddress}:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  }
}

function handleFetchError(error: any, url: string, formattedAddress: string) {
  if (isTimeoutError(error)) {
    console.error(`[ABI] Final timeout for ${url} after all retries`);
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const headers = error.response?.headers;

    console.error(`[ABI] HTTP error fetching ABI for ${formattedAddress}:`, {
      status,
      headers: {
        "retry-after": headers?.["retry-after"],
        "ratelimit-reset": headers?.["ratelimit-reset"],
        "ratelimit-remaining": headers?.["ratelimit-remaining"],
      },
      message: error.message,
      url: error.config?.url,
    });

    if (status === 429) {
      console.error(
        `[ABI] Rate limit exceeded for ${formattedAddress} after all retries`
      );
    }
  } else {
    console.error(`[ABI] Error fetching ABI for ${formattedAddress}:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

function getChainExplorerUrl(chainId: number, contractAddress: string): string {
  switch (chainId) {
    case 8453:
      return `https://basescan.org/address/${contractAddress}`;
    case 100:
      return `https://gnosisscan.io/address/${contractAddress}`;
    case 1:
    default:
      return `https://etherscan.io/address/${contractAddress}`;
  }
}

async function processAbiResponse(
  abi: any,
  formattedAddress: string,
  chainId: number,
  context: any,
  blockNumber: bigint,
  isImplementation: boolean
) {
  if (!abi) {
    console.error(`[ABI] No ABI provided for ${formattedAddress}`);
    return null;
  }

  let parsedAbi;
  try {
    parsedAbi = typeof abi === "string" ? JSON.parse(abi) : abi;
  } catch (e) {
    console.error(`[ABI] Failed to parse ABI for ${formattedAddress}:`, e);
    return null;
  }

  const chainName = getChainNameFromId(chainId);
  const location = getChainExplorerUrl(chainId, formattedAddress);
  const id = `${formattedAddress}-${chainName}`;

  const existingEntry = await executeQuery(async (client: any) => {
    const result = await client.query(
      `SELECT id FROM context_embeddings WHERE lower(id) LIKE $1 AND type = 'abi' LIMIT 1`,
      [`${id.toLowerCase()}%`]
    );
    return result.rows.length > 0;
  });

  if (existingEntry) {
    console.log(`[ABI] Entry already exists for ${id}, skipping processing`);
    return parsedAbi;
  }

  if (isImplementation && isProxyContract(parsedAbi)) {
    const implementation = await getImplementationAddress(
      formattedAddress,
      chainId,
      context,
      blockNumber
    );

    if (implementation?.address && implementation?.abi) {
      const content =
        typeof implementation.abi === "string"
          ? implementation.abi
          : JSON.stringify(implementation.abi);

      const embeddings = await generateEmbeddingWithRetry(content);

      await storeAbiInDatabase({
        id,
        location,
        content,
        embeddings,
        implementationAddress: implementation.address,
      });

      return implementation.abi;
    }
  }

  const content =
    typeof parsedAbi === "string" ? parsedAbi : JSON.stringify(parsedAbi);
  const embeddings = await generateEmbeddingWithRetry(content);

  await storeAbiInDatabase({
    id,
    location,
    content,
    embeddings,
    implementationAddress: null,
  });

  return parsedAbi;
}

async function storeAbiInDatabase({
  id,
  location,
  content,
  embeddings,
  implementationAddress = null as string | null,
}: {
  id: string;
  location: string;
  content: string;
  embeddings: string | string[];
  implementationAddress: string | null;
}) {
  try {
    if (Array.isArray(embeddings)) {
      const results = await Promise.all(
        embeddings.map(async (embedding, index) => {
          const existingChunk = await executeQuery(async (client: any) => {
            const result = await client.query(
              `SELECT id FROM context_embeddings WHERE id = $1 AND type = 'abi' AND location = $2 LIMIT 1`,
              [`${id}-${index}`, location]
            );
            return result.rows.length > 0;
          });

          if (existingChunk) {
            console.log(
              `[ABI] Chunk ${index} already exists for ${id}, skipping insert`
            );
            return true;
          }

          const result = await executeQuery(async (client: any) => {
            const queryResult = await client.query(
              `INSERT INTO context_embeddings (
                id,
                company_id,
                type,
                location,
                original_location,
                content,
                name,
                embedding,
                is_chunk,
                created_at,
                updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())  
              ON CONFLICT (id, type, location) DO UPDATE SET
                content = EXCLUDED.content,
                embedding = EXCLUDED.embedding,
                updated_at = NOW()
              RETURNING id`,
              [
                `${id}-${index}`,
                "olas",
                "abi",
                location,
                implementationAddress
                  ? getChainExplorerUrl(
                      getChainId(id.split("-")[1] || "mainnet"),
                      implementationAddress
                    )
                  : null,
                content,
                id.split("-")[0],
                embedding,
                true,
              ]
            );

            return queryResult;
          });
          return result.rows.length > 0;
        })
      );
      return results.every(Boolean);
    } else {
      const result = await executeQuery(async (client: any) => {
        const queryResult = await client.query(
          `INSERT INTO context_embeddings (
            id,
            company_id,
            type,
            location,
            original_location,
            content,
            name,
            embedding,
            is_chunk,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())  
          ON CONFLICT (id, type, location) DO UPDATE SET
            content = EXCLUDED.content,
            embedding = EXCLUDED.embedding,
            updated_at = NOW()
          RETURNING id`,
          [
            id,
            "olas",
            "abi",
            location,
            implementationAddress
              ? getChainExplorerUrl(
                  getChainId(id.split("-")[1] || "mainnet"),
                  implementationAddress
                )
              : null,
            content,
            id.split("-")[0],
            embeddings,
            false,
          ]
        );

        return queryResult;
      });
      return result.rows.length > 0;
    }
  } catch (error) {
    console.error(`[ABI] Database error storing ABI for ${id}:`, {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
      details: {
        id,
        type: "abi",
        location,
        isChunked: Array.isArray(embeddings),
        chunksCount: Array.isArray(embeddings) ? embeddings.length : 0,
      },
    });
    throw error;
  }
}

export const fetchAndTransformMetadata = async (
  configHash: string,
  maxRetries = 2,
  configInfo: ConfigInfo
): Promise<MetadataJson | null> => {
  const metadataPrefix = "f01701220";
  const finishedConfigHash = configHash.slice(2);
  const ipfsURL = "https://gateway.autonolas.tech/ipfs/";
  const metadataURI = `${ipfsURL}${metadataPrefix}${finishedConfigHash}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { data } = await axiosInstance.get<any>(metadataURI);

      let codeUri = data?.code_uri || data?.codeUri || null;
      let image = data?.image || null;

      if (codeUri && codeUri.startsWith("ipfs://")) {
        codeUri = transformIpfsUrl(codeUri);
      }

      if (image && image.startsWith("ipfs://")) {
        image = transformIpfsUrl(image);
      }

      const metadataJson = {
        name: data.name || null,
        description: data.description || null,
        image: data.image || null,
        codeUri: data.code_uri || data.codeUri || null,
        packageHash: extractPackageHash(
          data.codeUri || data.code_uri || undefined,
          data.packageHash
        ),
        metadataURI,
      };
      try {
        // if (metadataJson.packageHash && configInfo.type === "agent") {
        //   void processPackageDownload(metadataJson.packageHash, configInfo.id);
        // }
      } catch (error) {
        console.error(
          `[Metadata] Error processing package hash for ${configInfo.id}:`,
          {
            error: error instanceof Error ? error.message : "Unknown error",
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
      }

      return metadataJson;
    } catch (error) {
      if (attempt === maxRetries - 1) {
        console.error(`Failed to fetch metadata after ${maxRetries} attempts`);
        return null;
      }
      await delay(Math.min(1000 * (attempt + 1), 2000));
    }
  }

  if (global.gc) {
    global.gc();
  }

  return null;
};

function extractPackageHash(
  codeUri?: string,
  existingHash?: string | null
): string | null {
  if (codeUri) {
    if (codeUri.includes("ipfs://")) {
      return codeUri.split("ipfs://")[1]?.trim().replace(/\/$/, "") || null;
    }
    if (codeUri.includes("/ipfs/")) {
      return codeUri.split("/ipfs/")[1]?.trim().replace(/\/$/, "") || null;
    }
    return codeUri.trim().replace(/\/$/, "");
  }
  return existingHash?.trim().replace(/\/$/, "") || null;
}

export function transformIpfsUrl(
  url: string | null | undefined
): string | null {
  if (!url) return null;
  const gatewayUrl = "https://gateway.autonolas.tech/ipfs/";
  return url.startsWith("ipfs://") ? url.replace("ipfs://", gatewayUrl) : url;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function convertBigIntsToStrings(obj: any): any {
  return replaceBigInts(obj, (v) => String(v));
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getRetryDelay(error: any, attempt: number = 0): number {
  const BASE_DELAY = 12000;
  const MAX_DELAY = 60000;

  if (axios.isAxiosError(error) && error.response?.headers) {
    const headers = error.response.headers;

    if (headers["retry-after"]) {
      const retryAfter = headers["retry-after"];

      if (isNaN(retryAfter as any)) {
        const retryDate = new Date(retryAfter);
        if (!isNaN(retryDate.getTime())) {
          const delay = Math.max(0, retryDate.getTime() - Date.now());
          console.log(
            `[ABI] Retry-After (date): ${new Date(
              retryDate
            ).toISOString()}, delay: ${delay}ms`
          );
          return delay * 1.25;
        }
      }

      const secondsDelay = parseInt(retryAfter) * 1000;
      if (!isNaN(secondsDelay)) {
        console.log(`[ABI] Retry-After (seconds): ${secondsDelay}ms`);
        return secondsDelay * 1.25;
      }
    }

    if (headers["ratelimit-reset"]) {
      const resetTimestamp = parseInt(headers["ratelimit-reset"]) * 1000;
      const delay = Math.max(0, resetTimestamp - Date.now());
      console.log(`[ABI] Rate limit reset delay: ${delay}ms`);
      return delay * 1.25;
    }

    if (error.response.status === 429) {
      const exponentialDelay = Math.min(
        MAX_DELAY,
        BASE_DELAY * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5)
      );
      console.log(
        `[ABI] Rate limit exponential backoff delay: ${exponentialDelay}ms`
      );
      return exponentialDelay * 1.25;
    }
  }

  // Default exponential backoff for other errors
  const defaultDelay = Math.min(MAX_DELAY, BASE_DELAY * Math.pow(1.5, attempt));
  console.log(`[ABI] Default delay: ${defaultDelay}ms`);
  return defaultDelay;
}

function isTimeoutError(error: any): boolean {
  return (
    axios.isAxiosError(error) &&
    (error.code === "ECONNABORTED" || error.message.includes("timeout"))
  );
}

async function fetchWithRetry(
  url: string,
  retries = MAX_RETRIES,
  timeout = INITIAL_TIMEOUT
): Promise<any> {
  let lastError: any;
  let currentTimeout = timeout;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, {
        timeout: currentTimeout,
        headers: {
          Accept: "application/json",
        },
      });
      return response;
    } catch (error) {
      lastError = error;

      if (axios.isAxiosError(error)) {
        if (error.response?.status === 400) {
          throw error;
        }

        const status = error.response?.status;
        const headers = error.response?.headers;

        const isTimeout =
          error.code === "ECONNABORTED" || error.message.includes("timeout");
        const isRateLimit = status === 429;

        console.error(`[ABI] HTTP error fetching ABI from ${url}:`, {
          status,
          headers: {
            "retry-after": headers?.["retry-after"],
            "ratelimit-reset": headers?.["ratelimit-reset"],
            "ratelimit-remaining": headers?.["ratelimit-remaining"],
          },
          message: error.message,
          code: error.code,
          url: error.config?.url,
        });

        if (!isTimeout && !isRateLimit) {
          throw error;
        }

        const waitTime = isRateLimit
          ? getRetryDelay(error, i)
          : isTimeout
          ? Math.min(currentTimeout * TIMEOUT_MULTIPLIER, MAX_TIMEOUT) -
            currentTimeout
          : INITIAL_RETRY_DELAY;

        const remainingAttempts = retries - i - 1;

        if (isTimeout) {
          console.log(
            `[ABI] Timeout fetching ABI from ${url}. ` +
              `Attempt ${i + 1}/${retries}. ` +
              `Increasing timeout from ${currentTimeout}ms to ${Math.min(
                currentTimeout * TIMEOUT_MULTIPLIER,
                MAX_TIMEOUT
              )}ms. ` +
              `(${remainingAttempts} attempts remaining)`
          );
          currentTimeout = Math.min(
            currentTimeout * TIMEOUT_MULTIPLIER,
            MAX_TIMEOUT
          );
        } else if (isRateLimit) {
          console.log(
            `[ABI] Rate limited by abidata.net. Attempt ${i + 1}/${retries}. ` +
              `Waiting ${Math.round(waitTime / 1000)}s... ` +
              `(${remainingAttempts} attempts remaining)`
          );
        } else {
          console.log(
            `[ABI] Error fetching ABI from ${url}. ` +
              `Attempt ${i + 1}/${retries}. ` +
              `Status: ${status}. Error: ${error.message}. ` +
              `Waiting ${Math.round(waitTime / 1000)}s... ` +
              `(${remainingAttempts} attempts remaining)`
          );
        }

        await wait(waitTime);
        continue;
      } else {
        // Non-Axios error
        console.error(`[ABI] Non-HTTP error fetching ABI from ${url}:`, {
          error:
            error instanceof Error
              ? {
                  message: error.message,
                  stack: error.stack,
                  name: error.name,
                }
              : "Unknown error type",
          type: typeof error,
        });
      }
    }
  }

  const errorDetails =
    lastError instanceof Error
      ? {
          message: lastError.message,
          stack: lastError.stack,
          name: lastError.name,
          type: typeof lastError,
          isAxiosError: axios.isAxiosError(lastError),
          status: axios.isAxiosError(lastError)
            ? lastError.response?.status
            : undefined,
          code: axios.isAxiosError(lastError) ? lastError.code : undefined,
        }
      : {
          error: lastError,
        };

  console.error(
    `[ABI] Failed after ${retries} retries for ${url}. Error details:`,
    errorDetails
  );

  throw new Error(
    `Failed after ${retries} retries. Error: ${
      lastError instanceof Error
        ? lastError.message
        : JSON.stringify(errorDetails)
    }`
  );
}

export const formatTransactionLogs = (
  hash: string,
  decodedLogs: any[]
): void => {
  const logNames = decodedLogs.map((log) => {
    const eventName =
      log.decoded?.decoded?.name || log.decoded?.name || "Unknown";
    const contractAddress = log.address?.toLowerCase();
    const signature = log.decoded?.eventSignature || log.topics?.[0];

    if (eventName === "Unknown") {
      return `Unknown(contract: ${contractAddress}, signature: ${signature})`;
    }
    return eventName;
  });

  console.log(`Log Names for ${hash}: ${logNames.join(", ")}`);
};
