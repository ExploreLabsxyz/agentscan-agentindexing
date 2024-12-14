import axios from "axios";
import { pool } from "./postgres";
import { generateEmbeddingWithRetry } from "./openai";
import { replaceBigInts } from "ponder";
import { createClient } from "redis";
import { TokenTransferData } from "../src/types";

const TTL = 7 * 24 * 60 * 60;

const axiosInstance = axios.create({
  timeout: 5000,
  maxContentLength: 500000,
});

const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

redisClient.connect().catch(console.error);

const SIGNATURES = {
  TRANSFER: "0xa9059cbb", // transfer(address,uint256)
  TRANSFER_FROM: "0x23b872dd", // transferFrom(address,address,uint256)
  // ERC721
  TRANSFER_721: "0x42842e0e", // safeTransferFrom(address,address,uint256)
  TRANSFER_721_DATA: "0xb88d4fde", // safeTransferFrom(address,address,uint256,bytes)
  // ERC1155
  TRANSFER_SINGLE: "0xf242432a", // safeTransferFrom(address,address,uint256,uint256,bytes)
  TRANSFER_BATCH: "0x2eb2c2d6", // safeBatchTransferFrom(address,address,uint256[],uint256[],bytes)
  PROXY_FUNCTION: "0x4f1ef286",
  DELEGATE_CALL: "0x5c60da1b",
};

export const getChainName = (contractName: string) => {
  return contractName
    .replace("Registry", "")
    .replace("Staking", "")
    .toLowerCase();
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

interface ConfigInfo {
  type: "component" | "service" | "agent";
  id: string;
}

interface MetadataJson {
  name?: string | null;
  description?: string | null;
  image?: string | null;
  codeUri?: string | null;
  packageHash?: string | null;
  metadataURI?: string;
}

export async function getImplementationAddress(
  contractAddress: string,
  chainId: number,
  context: any,
  blockNumber: bigint
): Promise<ImplementationResult | null> {
  try {
    if (
      !contractAddress ||
      contractAddress === "0x" ||
      contractAddress.toLowerCase() ===
        "0x0000000000000000000000000000000000000000"
    ) {
      console.log("Invalid or zero contract address provided");
      return null;
    }

    const formattedAddress = contractAddress.toLowerCase();
    if (!formattedAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      console.log(`Invalid address format: ${contractAddress}`);
      return null;
    }

    const GET_IMPLEMENTATION_ABI = [
      {
        inputs: [],
        name: "getImplementation",
        outputs: [{ type: "address", name: "implementation" }],
        stateMutability: "view",
        type: "function",
      },
    ] as const;

    try {
      const implementationAddress = await context.client.readContract({
        address: formattedAddress as `0x${string}`,
        abi: GET_IMPLEMENTATION_ABI,
        functionName: "getImplementation",
        blockNumber: blockNumber,
      });

      if (
        implementationAddress &&
        implementationAddress !== "0x0000000000000000000000000000000000000000"
      ) {
        console.log(
          `Found implementation via getImplementation() for ${formattedAddress}: ${implementationAddress}`
        );

        const implementationAbi = await checkAndStoreAbi(
          implementationAddress,
          chainId,
          context,
          blockNumber
        );

        if (implementationAbi) {
          return {
            address: implementationAddress,
            abi: implementationAbi,
          };
        }
      }
    } catch (error) {
      console.log(
        "No getImplementation function found, trying storage slots..."
      );
    }

    const PROXY_IMPLEMENTATION_SLOTS = {
      EIP1967:
        "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
      EIP1967_BEACON:
        "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
      SIMPLE_PROXY:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      GNOSIS_SAFE_PROXY:
        "0xa619486e6a192c629d6e5c69ba3efd8478c19a6022185a277f24bc5b6e1060f9",
      OPENZEPPELIN_PROXY:
        "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
      KARMA_PROXY:
        "0x7e644d79422f17c01e4894b5f4f588d331ebfa28653d42ae832dc59e38c9798f",
    } as const;

    for (const [slotType, slot] of Object.entries(PROXY_IMPLEMENTATION_SLOTS)) {
      const implementationAddress = await context.client.getStorageAt({
        address: formattedAddress as `0x${string}`,
        slot: slot as `0x${string}`,
        blockNumber: blockNumber,
      });

      if (
        implementationAddress &&
        implementationAddress !== "0x" &&
        implementationAddress !== "0x0000000000000000000000000000000000000000"
      ) {
        const cleanAddress = "0x" + implementationAddress.slice(-40);

        if (
          cleanAddress.match(/^0x[a-fA-F0-9]{40}$/) &&
          cleanAddress.toLowerCase() !==
            "0x0000000000000000000000000000000000000000"
        ) {
          console.log(
            `Found implementation at ${slotType} slot for ${formattedAddress}: ${cleanAddress}`
          );

          const implementationAbi = await checkAndStoreAbi(
            cleanAddress,
            chainId,
            context,
            blockNumber
          );

          if (implementationAbi) {
            return {
              address: cleanAddress,
              abi: implementationAbi,
            };
          }
        }
      }
    }

    console.log(`No valid implementation found for ${formattedAddress}`);
    return null;
  } catch (error) {
    console.error(`Error getting implementation address:`, error);
    return null;
  }
}

interface ImplementationResult {
  address: string;
  abi: string | null;
}

export async function checkAndStoreAbi(
  contractAddress: string,
  chainId: number,
  context: any,
  blockNumber: bigint
) {
  const formattedAddress = contractAddress.toLowerCase();
  const redisKey = `abi:${formattedAddress}:${chainId}`;

  try {
    try {
      const cachedAbi = await redisClient.get(redisKey);
      if (cachedAbi === "null") {
        console.log(`[ABI] Cached null ABI found for ${formattedAddress}`);
        return null;
      }
      if (cachedAbi) {
        return cachedAbi;
      }
    } catch (redisError) {
      console.error(`[ABI] Redis error for ${formattedAddress}:`, {
        error:
          redisError instanceof Error ? redisError.message : "Unknown error",
        stack: redisError instanceof Error ? redisError.stack : undefined,
      });
    }

    if (
      !contractAddress ||
      contractAddress === "0x" ||
      contractAddress.toLowerCase() ===
        "0x0000000000000000000000000000000000000000"
    ) {
      console.warn(`[ABI] Invalid contract address: ${contractAddress}`);
      return null;
    }

    if (!formattedAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
      console.warn(`[ABI] Invalid address format: ${contractAddress}`);
      return null;
    }

    try {
      const checkQuery = `
        SELECT abi_text FROM contract_abis 
        WHERE address = $1 AND chain_id = $2
      `;
      const existingAbi = await pool.query(checkQuery, [
        formattedAddress,
        chainId,
      ]);

      if (existingAbi.rows.length > 0) {
        return existingAbi.rows[0].abi_text;
      }
    } catch (dbError) {
      console.error(`[ABI] Database query error for ${formattedAddress}:`, {
        error: dbError instanceof Error ? dbError.message : "Unknown error",
        code: (dbError as any)?.code,
        stack: dbError instanceof Error ? dbError.stack : undefined,
      });
    }

    const network =
      chainId === 8453 ? "base" : chainId === 100 ? "gnosis" : null;
    if (!network) {
      console.error(
        `[ABI] Unsupported chain ID: ${chainId} for ${formattedAddress}`
      );
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const url = `https://abidata.net/${contractAddress}?network=${network}`;
    console.log(`[ABI] Fetching ABI from: ${url}`);

    try {
      const response = await fetchWithRetry(url);

      if (!response.data?.ok || !response.data.abi) {
        console.error(
          `[ABI] Invalid response from ABI service for ${formattedAddress}:`,
          {
            status: response.status,
            statusText: response.statusText,
            data: response.data,
          }
        );
        throw new Error("No ABI found in response");
      }

      const abi_text = JSON.stringify(response.data.abi);
      console.log(`[ABI] Successfully fetched ABI for ${formattedAddress}`);

      let embedding;
      try {
        embedding = await generateEmbeddingWithRetry(abi_text);
        console.log(`[ABI] Generated embedding for ${formattedAddress}`);
      } catch (embeddingError) {
        console.error(
          `[ABI] Embedding generation failed for ${formattedAddress}:`,
          {
            error:
              embeddingError instanceof Error
                ? embeddingError.message
                : "Unknown error",
            stack:
              embeddingError instanceof Error
                ? embeddingError.stack
                : undefined,
          }
        );
        throw embeddingError;
      }

      const isProxy = isProxyContract(abi_text);
      if (isProxy) {
        console.log(`[ABI] Detected proxy contract at ${formattedAddress}`);
        const implementation = await getImplementationAddress(
          contractAddress,
          chainId,
          context,
          BigInt(blockNumber)
        );

        if (implementation?.abi) {
          console.log(
            `[ABI] Found implementation at ${implementation.address} for ${formattedAddress}`
          );

          try {
            const embedding = await generateEmbeddingWithRetry(
              implementation.abi
            );

            const insertQuery = `
              INSERT INTO contract_abis (
                address,
                chain_id,
                abi_text,
                abi_embedding,
                implementation_address
              ) VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (address, chain_id) 
              DO UPDATE SET 
                abi_text = $3,
                abi_embedding = $4,
                implementation_address = $5,
                updated_at = CURRENT_TIMESTAMP
              RETURNING *
            `;

            await pool.query(insertQuery, [
              formattedAddress,
              chainId,
              implementation.abi,
              embedding,
              implementation.address,
            ]);

            await redisClient.set(redisKey, implementation.abi, {
              EX: TTL,
            });

            return implementation.abi;
          } catch (embeddingError) {
            console.error(
              `[ABI] Embedding generation failed for ${formattedAddress}:`,
              {
                error:
                  embeddingError instanceof Error
                    ? embeddingError.message
                    : "Unknown error",
                stack:
                  embeddingError instanceof Error
                    ? embeddingError.stack
                    : undefined,
              }
            );
            throw embeddingError;
          }
        }
      }

      const insertQuery = `
        INSERT INTO contract_abis (
          address,
          chain_id,
          abi_text,
          abi_embedding
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (address, chain_id) 
        DO UPDATE SET 
          abi_text = $3,
          abi_embedding = $4,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `;

      const result = await pool.query(insertQuery, [
        formattedAddress,
        chainId,
        abi_text,
        embedding,
      ]);

      await redisClient.set(redisKey, abi_text, {
        EX: TTL,
      });

      console.log(`DB Insert Result: ${result.rowCount} rows affected`);
      return abi_text;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const headers = error.response?.headers;

        console.error(
          `[ABI] HTTP error fetching ABI for ${formattedAddress}:`,
          {
            status,
            headers: {
              "retry-after": headers?.["retry-after"],
              "ratelimit-reset": headers?.["ratelimit-reset"],
              "ratelimit-remaining": headers?.["ratelimit-remaining"],
            },
            message: error.message,
            url: error.config?.url,
          }
        );

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

      try {
        await redisClient.set(redisKey, "null", {
          EX: Math.floor(TTL / 2),
        });
      } catch (redisError) {
        console.error(`[ABI] Redis error caching failed request:`, redisError);
      }

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
      const { data } = await axiosInstance.get<MetadataJson>(metadataURI);

      return {
        name: data.name || null,
        description: data.description || null,
        image: transformIpfsUrl(data.image),
        codeUri: transformIpfsUrl(data.codeUri || undefined),
        packageHash: extractPackageHash(
          data.codeUri || undefined,
          data.packageHash
        ),
        metadataURI,
      };
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

function transformIpfsUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const gatewayUrl = "https://gateway.autonolas.tech/ipfs/";
  return url.startsWith("ipfs://") ? url.replace("ipfs://", gatewayUrl) : url;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function isSafeTransaction(
  address: string,
  chainId: number,
  context: any
): Promise<boolean> {
  try {
    const checkQuery = `
      SELECT abi_text FROM contract_abis 
      WHERE address = $1 AND chain_id = $2
    `;
    const result = await pool.query(checkQuery, [
      address.toLowerCase(),
      chainId,
    ]);

    if (!result.rows.length) return false;

    const abi = JSON.parse(result.rows[0].abi_text);

    return abi.some(
      (item: any) =>
        item.type === "function" &&
        item.name === "execTransaction" &&
        item.inputs?.length === 10 &&
        item.inputs.some((input: any) => input.name === "signatures")
    );
  } catch (error) {
    console.error("Error checking Safe status:", error);
    return false;
  }
}

export function decodeTokenTransfer(data: string): TokenTransferData | null {
  if (!data || data === "0x") return null;

  const methodId = data.slice(0, 10).toLowerCase();
  const params = data.slice(10);

  try {
    switch (methodId) {
      case SIGNATURES.TRANSFER: {
        // ERC20 transfer(address,uint256)
        return {
          type: "ERC20",
          to: "0x" + params.slice(24, 64),
          amount: BigInt("0x" + params.slice(64)).toString(),
        };
      }
      case SIGNATURES.TRANSFER_FROM: {
        // ERC20/ERC721 transferFrom(address,address,uint256)
        return {
          type: "ERC20", // We'll refine this later with contract checks
          from: "0x" + params.slice(24, 64),
          to: "0x" + params.slice(88, 128),
          amount: BigInt("0x" + params.slice(128)).toString(),
        };
      }
      case SIGNATURES.TRANSFER_721:
      case SIGNATURES.TRANSFER_721_DATA: {
        // ERC721 safeTransferFrom
        return {
          type: "ERC721",
          from: "0x" + params.slice(24, 64),
          to: "0x" + params.slice(88, 128),
          tokenId: BigInt("0x" + params.slice(128, 192)).toString(),
          data:
            methodId === SIGNATURES.TRANSFER_721_DATA
              ? "0x" + params.slice(192)
              : undefined,
        };
      }
      case SIGNATURES.TRANSFER_SINGLE: {
        // ERC1155 single transfer
        return {
          type: "ERC1155",
          from: "0x" + params.slice(24, 64),
          to: "0x" + params.slice(88, 128),
          tokenId: BigInt("0x" + params.slice(128, 192)).toString(),
          amount: BigInt("0x" + params.slice(192, 256)).toString(),
          data: "0x" + params.slice(256),
        };
      }
      case SIGNATURES.TRANSFER_BATCH: {
        // ERC1155 batch transfer
        return {
          type: "ERC1155",
          from: "0x" + params.slice(24, 64),
          to: "0x" + params.slice(88, 128),
          data: "0x" + params.slice(128), // Further decode arrays if needed
        };
      }
      default:
        return null;
    }
  } catch (error) {
    console.error("Error decoding token transfer:", error);
    return null;
  }
}

export function convertBigIntsToStrings(obj: any): any {
  return replaceBigInts(obj, (v) => String(v));
}

export function isProxyContract(abi: string): boolean {
  try {
    const abiObj = JSON.parse(abi);

    const isProxy =
      Array.isArray(abiObj) &&
      ((abiObj.length === 2 &&
        abiObj[0]?.type === "constructor" &&
        abiObj[0]?.inputs?.[0]?.name === "_singleton" &&
        abiObj[1]?.type === "fallback") ||
        abiObj.some(
          (item: any) =>
            item.type === "function" &&
            item.name === "getImplementation" &&
            item.outputs?.length === 1 &&
            item.outputs[0].type === "address"
        ) ||
        (abiObj.some(
          (item: any) =>
            item.type === "constructor" &&
            item.inputs?.length === 2 &&
            item.inputs[0]?.type === "address" &&
            item.inputs[0]?.name === "implementation" &&
            item.inputs[1]?.type === "bytes" &&
            item.inputs[1]?.name === "karmaData"
        ) &&
          abiObj.some((item: any) => item.type === "fallback")));

    return isProxy;
  } catch (error) {
    console.error("Error checking proxy status:", error);
    return false;
  }
}

const INITIAL_RETRY_DELAY = 5000;
const MAX_RETRY_DELAY = 32000;
const MAX_RETRIES = 5;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getRetryDelay(error: any, attempt: number): number {
  if (axios.isAxiosError(error) && error.response) {
    const retryAfter = error.response.headers["retry-after"];
    if (retryAfter) {
      if (isNaN(retryAfter as any)) {
        const retryDate = new Date(retryAfter);
        if (!isNaN(retryDate.getTime())) {
          return Math.max(0, retryDate.getTime() - Date.now());
        }
      } else {
        return parseInt(retryAfter) * 1000;
      }
    }

    const rateLimitReset = error.response.headers["ratelimit-reset"];
    if (rateLimitReset) {
      const resetTime = parseInt(rateLimitReset) * 1000;
      return Math.max(0, resetTime - Date.now());
    }
  }

  const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
  const jitter = Math.random() * 1000;
  return Math.min(delay + jitter, MAX_RETRY_DELAY);
}

async function fetchWithRetry(
  url: string,
  retries = MAX_RETRIES
): Promise<any> {
  let lastError: any;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url, {
        timeout: 25000,
        headers: {
          Accept: "application/json",
        },
      });
      return response;
    } catch (error) {
      lastError = error;

      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const waitTime = getRetryDelay(error, i);

        console.log(
          `[ABI] Rate limited by abidata.net. Retry ${i + 1}/${retries}.`,
          `Waiting ${Math.round(waitTime / 1000)}s...`,
          error.response.headers["retry-after"]
            ? `(Based on Retry-After header)`
            : `(Using exponential backoff)`
        );
        if (error?.response?.data) {
          console.log("[ABI] Error response data:", error.response.data);
        }

        await wait(waitTime);

        if (i === retries - 1) {
          throw new Error(
            `Failed after ${retries} retries due to rate limiting. ` +
              `Last error: ${error.message}`
          );
        }
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}
