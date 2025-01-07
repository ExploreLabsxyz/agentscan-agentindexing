import axios from "axios";

import { replaceBigInts } from "ponder";
import { createClient } from "redis";
import type { RedisClientType } from "redis";
import {
  ConfigInfo,
  ImplementationResult,
  MetadataJson,
  TokenTransferData,
} from "../src/types";

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
