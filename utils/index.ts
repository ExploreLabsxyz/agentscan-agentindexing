import axios from "axios";

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

// List all contract names
export const CONTRACT_NAMES = [
  "MainnetStaking",
  "PolygonRegistry",
  "GnosisRegistry",
  "ArbitrumRegistry",
  "OptimismRegistry",
  "BaseRegistry",
  // "CeloRegistry",
  // "ModeRegistry",
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

interface MetadataJson {
  name: string;
  description: string;
  image: string;
  code_uri: string;
  metadataURI: string;
}

const DEFAULT_METADATA: MetadataJson = {
  name: "",
  description: "",
  image: "",
  code_uri: "",
  metadataURI: "",
};

export async function fetchMetadata(
  hash: string,
  id: string,
  type: "component" | "service" | "agent"
): Promise<MetadataJson> {
  try {
    const result = await fetchAndTransformMetadata(hash, 3, { type, id });
    return result || DEFAULT_METADATA;
  } catch (error) {
    console.error(`Metadata fetch failed for ${type} ${id}:`, error);
    return DEFAULT_METADATA;
  }
}

export async function withErrorBoundary<T>(
  operation: () => Promise<T>,
  errorContext: string
): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    console.error(`Error in ${errorContext}:`, error);
    return null;
  }
}

interface ConfigInfo {
  type: "component" | "service" | "agent";
  id: string;
}

export const fetchAndTransformMetadata = async (
  configHash: string,
  maxRetries = 3,
  configInfo: ConfigInfo
): Promise<MetadataJson> => {
  const metadataPrefix = "f01701220";
  const finishedConfigHash = configHash.slice(2);
  const ipfsURL = "https://gateway.autonolas.tech/ipfs/";
  const metadataURI = `${ipfsURL}${metadataPrefix}${finishedConfigHash}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const { data } = await axios.get<any>(metadataURI, {
        timeout: 5000,
      });

      // Validate the response data
      if (!data || typeof data !== "object") {
        throw new Error("Invalid metadata format");
      }

      const metadataJson: MetadataJson = {
        name: typeof data.name === "string" ? data.name : "",
        description:
          typeof data.description === "string" ? data.description : "",
        image: typeof data.image === "string" ? data.image : "",
        code_uri: typeof data.code_uri === "string" ? data.code_uri : "",

        metadataURI: metadataURI,
      };

      // Transform IPFS URLs
      return transformIpfsUrls(metadataJson, metadataURI);
    } catch (error) {
      if (attempt === maxRetries - 1) {
        console.error(
          `Failed to fetch metadata after ${maxRetries} attempts:`,
          error
        );
        return DEFAULT_METADATA;
      }
      await handleRetry(attempt, metadataURI);
    }
  }
  return DEFAULT_METADATA;
};

// Helper functions for better code organization
function extractPackageHash(codeUri?: string, existingHash?: string): string {
  if (codeUri) {
    if (codeUri.includes("ipfs://")) {
      return codeUri.split("ipfs://")[1]?.trim().replace(/\/$/, "") || "";
    }
    if (codeUri.includes("/ipfs/")) {
      return codeUri.split("/ipfs/")[1]?.trim().replace(/\/$/, "") || "";
    }
    return codeUri.trim().replace(/\/$/, "");
  }
  return existingHash?.trim().replace(/\/$/, "") || "";
}

function transformIpfsUrls(
  metadata: MetadataJson,
  metadataURI: string
): MetadataJson {
  const gatewayUrl = "https://gateway.autonolas.tech/ipfs/";

  return {
    ...metadata,
    image: metadata.image?.startsWith("ipfs://")
      ? metadata.image.replace("ipfs://", gatewayUrl)
      : metadata.image || "",
    code_uri: metadata.code_uri?.startsWith("ipfs://")
      ? metadata.code_uri.replace("ipfs://", gatewayUrl)
      : metadata.code_uri || "",
    metadataURI: metadataURI || "",
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function handleRetry(attempt: number, metadataURI: string) {
  const backoffTime = Math.min(500 * (attempt + 1), 1500);
  console.log(
    `Attempt ${attempt + 1} failed for ${metadataURI}, retrying in ${
      backoffTime / 1000
    }s...`
  );
  await delay(backoffTime);
}
