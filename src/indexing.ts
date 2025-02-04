import { ponder } from "ponder:registry";
import {
  Service,
  Agent,
  ServiceAgent,
  ComponentAgent,
  AgentInstance,
  Component,
  StakingInstance,
  StakingPosition,
} from "ponder:schema";
import {
  CONTRACT_NAMES,
  createChainScopedId,
  fetchMetadata,
  getChainId,
  getChainName,
  transformIpfsUrl,
} from "../utils";
import { and, eq } from "ponder";

const createDefaultService = (
  serviceId: string,
  chain: string,
  blockNumber: number,
  timestamp: number,
  configHash?: string | null,
  tokenId?: number
) => ({
  id: serviceId,
  chain,
  tokenId,
  securityDeposit: 0n,
  multisig: "0x" as `0x${string}`,
  configHash,
  threshold: 0,
  maxNumAgentInstances: 0,
  numAgentInstances: 0,
  state: "UNREGISTERED" as const,
  blockNumber,
  chainId: getChainId(chain),
  name: null,
  description: null,
  image: null,
  codeUri: null,
  metadataURI: null,
  packageHash: null,
  metadataHash: configHash,
  timestamp,
  owner: null,
});

const retryOperation = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 5,
  delay: number = 1000
): Promise<T> => {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Check if it's the "too many clients" error
      if (
        error instanceof Error &&
        error.message.includes("too many clients")
      ) {
        if (attempt === maxRetries) {
          console.error(
            `Final retry attempt failed after ${maxRetries} attempts:`,
            error
          );
          throw error;
        }

        console.warn(
          `Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay * attempt)); // Exponential backoff
        continue;
      }

      // If it's not a "too many clients" error, throw immediately
      throw error;
    }
  }

  throw lastError;
};

ponder.on(`MainnetAgentRegistry:UpdateUnitHash`, async ({ event, context }) => {
  const agentId = event.args.unitId.toString();

  const metadataJson = await fetchMetadata(
    event.args.unitHash,
    agentId,
    "agent"
  );

  if (!metadataJson) {
    console.warn(`No metadata found for agent ${agentId}`);
    return;
  }

  const updateData = {
    id: agentId,
    tokenId: Number(agentId),
    name: metadataJson.name,
    description: metadataJson.description,
    image: metadataJson.image ? transformIpfsUrl(metadataJson.image) : null,
    codeUri: metadataJson.codeUri
      ? transformIpfsUrl(metadataJson.codeUri)
      : null,
    blockNumber: Number(event.block.number),
    timestamp: Number(event.block.timestamp),
    packageHash: metadataJson.packageHash,
    metadataHash: metadataJson.metadataHash,
    metadataURI: metadataJson.metadataURI,
  };

  try {
    await retryOperation(async () => {
      await context.db.update(Agent, { id: agentId }).set(updateData);
    });
  } catch (e) {
    console.error("Error updating agent:", e);
    try {
      await retryOperation(async () => {
        await context.db.insert(Agent).values(updateData).onConflictDoUpdate({
          tokenId: updateData.tokenId,
        });
      });
    } catch (e) {
      console.error("Error inserting new agent:", e);
    }
  }

  try {
    const { client } = context;
    const { MainnetAgentRegistry } = context.contracts;
    const dependencies = await client.readContract({
      abi: MainnetAgentRegistry.abi,
      address: MainnetAgentRegistry.address,
      functionName: "getDependencies",
      args: [event.args.unitId],
    });

    if (dependencies?.[1]?.length > 0) {
      const validDependencies = dependencies[1]
        .map((dep) => dep.toString())
        .filter((dep) => dep !== "")
        .map((dependency) => ({
          id: `${agentId}-${dependency}`,
          agentId,
          componentId: dependency,
        }));

      if (validDependencies.length > 0) {
        console.log(`Inserting dependencies for agent ${agentId}`);
        try {
          await retryOperation(async () => {
            await context.db.insert(ComponentAgent).values(validDependencies);
          });
        } catch (e) {
          console.error("Error inserting component agent:", e);
        }
      }
    }
  } catch (error) {
    console.error(
      `Failed to process dependencies for agent ${agentId}:`,
      error
    );
  }

  console.log(
    `Handling MainnetAgentRegistry:UpdateUnitHash for agent ${agentId}`
  );
});

ponder.on(
  "MainnetComponentRegistry:UpdateUnitHash",
  async ({ event, context }) => {
    const componentId = event.args.unitId.toString();
    console.log(
      `Handling MainnetComponentRegistry:UpdateUnitHash for component ${componentId}`
    );

    const metadataJson = await fetchMetadata(
      event.args.unitHash,
      componentId,
      "component"
    );

    if (!metadataJson) {
      console.warn(`No metadata found for component ${componentId}`);
      return;
    }

    const updateData = {
      id: componentId,
      tokenId: Number(componentId),
      name: metadataJson.name,
      description: metadataJson.description,
      image: metadataJson.image ? transformIpfsUrl(metadataJson.image) : null,
      codeUri: metadataJson.codeUri
        ? transformIpfsUrl(metadataJson.codeUri)
        : null,
      blockNumber: Number(event.block.number),
      timestamp: Number(event.block.timestamp),
      packageHash: metadataJson.packageHash,
      metadataHash: metadataJson.metadataHash,
      metadataURI: metadataJson.metadataURI,
    };

    try {
      await retryOperation(async () => {
        await context.db.update(Component, { id: componentId }).set(updateData);
      });
    } catch (e) {
      console.error("Error updating component:", e);
      try {
        await retryOperation(async () => {
          await context.db
            .insert(Component)
            .values(updateData)
            .onConflictDoUpdate({
              tokenId: updateData.tokenId,
            });
        });
      } catch (e) {
        console.error("Error inserting new component:", e);
      }
    }
  }
);

ponder.on(`MainnetAgentRegistry:CreateUnit`, async ({ event, context }) => {
  const agentId = event.args.unitId.toString();
  console.log(`Handling MainnetAgentRegistry:CreateUnit for agent ${agentId}`);
  const [metadataJson] = await Promise.all([
    fetchMetadata(event.args.unitHash, agentId, "agent"),
  ]);

  if (!metadataJson) {
    console.warn(`No metadata found for agent ${agentId}`);
    return;
  }

  const updateData = {
    id: agentId,
    tokenId: Number(agentId),
    name: metadataJson.name,
    description: metadataJson.description,
    image: metadataJson.image ? transformIpfsUrl(metadataJson.image) : null,
    codeUri: metadataJson.codeUri
      ? transformIpfsUrl(metadataJson.codeUri)
      : null,
    blockNumber: Number(event.block.number),
    timestamp: Number(event.block.timestamp),
    packageHash: metadataJson.packageHash,
    metadataHash: metadataJson.metadataHash,
    metadataURI: metadataJson.metadataURI,
  };

  await context.db
    .insert(Agent)
    .values(updateData)
    .onConflictDoUpdate({
      tokenId: updateData.tokenId,
      name: updateData.name,
      description: updateData.description,
      image: updateData.image ? transformIpfsUrl(updateData?.image) : null,
      codeUri: updateData.codeUri
        ? transformIpfsUrl(updateData?.codeUri)
        : null,
      metadataURI: updateData.metadataURI,
      packageHash: updateData.packageHash,
      metadataHash: updateData.metadataHash,
    });
  console.log("Inserted agent:", updateData);

  try {
    const { client } = context;
    const { MainnetAgentRegistry } = context.contracts;
    const dependencies = await client.readContract({
      abi: MainnetAgentRegistry.abi,
      address: MainnetAgentRegistry.address,
      functionName: "getDependencies",
      args: [event.args.unitId],
    });

    if (dependencies?.[1]?.length > 0) {
      const validDependencies = dependencies[1]
        .map((dep) => dep.toString())
        .filter((dep) => dep !== "")
        .map((dependency) => ({
          id: `${agentId}-${dependency}`,
          agentId,
          componentId: dependency,
        }));

      if (validDependencies.length > 0) {
        console.log(`Inserting dependencies for agent ${agentId}`);
        await context.db.insert(ComponentAgent).values(validDependencies);
      }
    }
  } catch (error) {
    console.error(
      `Failed to process dependencies for agent ${agentId}:`,
      error
    );
  }
});

ponder.on(`MainnetAgentRegistry:Transfer`, async ({ event, context }) => {
  const agentId = event.args.id.toString();
  console.log(`Handling MainnetAgentRegistry:Transfer for agent ${agentId}`);

  try {
    await context.db
      .update(Agent, { id: agentId })
      .set({ operator: event.args.to.toString() });
  } catch (e) {
    console.error("Error in AgentRegistry:Transfer:", e);
    try {
      await retryOperation(async () => {
        await context.db
          .insert(Agent)
          .values({
            id: agentId,
            tokenId: Number(agentId),
            operator: event.args.to.toString(),
            name: null,
            description: null,
            image: null,
            codeUri: null,
            blockNumber: Number(event.block.number),
            timestamp: Number(event.block.timestamp),
            packageHash: null,
            metadataHash: null,
            metadataURI: null,
          })
          .onConflictDoUpdate({
            operator: event.args.to.toString(),
            tokenId: Number(agentId),
          });
      });
      console.log("Inserted agent after failed update");
    } catch (e) {
      console.error("Error inserting new agent:", e);
    }
  }
});

ponder.on(`MainnetComponentRegistry:CreateUnit`, async ({ event, context }) => {
  const componentId = event.args.unitId.toString();
  console.log(
    `Handling MainnetComponentRegistry:CreateUnit for component ${componentId}`
  );
  const [metadataJson] = await Promise.all([
    fetchMetadata(event.args.unitHash, componentId, "component"),
  ]);

  if (!metadataJson) {
    console.warn(`No metadata found for component ${componentId}`);
    return;
  }

  const updateData = {
    id: componentId,
    tokenId: Number(componentId),
    name: metadataJson.name,
    description: metadataJson.description,
    image: metadataJson.image ? transformIpfsUrl(metadataJson.image) : null,
    codeUri: metadataJson.codeUri
      ? transformIpfsUrl(metadataJson.codeUri)
      : null,
    blockNumber: Number(event.block.number),
    timestamp: Number(event.block.timestamp),
    packageHash: metadataJson.packageHash,
    metadataHash: metadataJson.metadataHash,
    metadataURI: metadataJson.metadataURI,
  };

  try {
    await retryOperation(async () => {
      await context.db
        .insert(Component)
        .values(updateData)
        .onConflictDoUpdate({
          tokenId: updateData.tokenId,
          name: updateData.name,
          description: updateData.description,
          image: updateData.image ? transformIpfsUrl(updateData?.image) : null,
          codeUri: updateData.codeUri
            ? transformIpfsUrl(updateData?.codeUri)
            : null,
          metadataHash: updateData.metadataHash,
          metadataURI: updateData.metadataURI,
          packageHash: updateData.packageHash,
        });
    });
    console.log("Inserted component:", updateData);
  } catch (e) {
    console.error("Error inserting component:", e);
  }
});

ponder.on(`MainnetComponentRegistry:Transfer`, async ({ event, context }) => {
  const componentId = event.args.id.toString();
  console.log(
    `Handling MainnetComponentRegistry:Transfer for component ${componentId}`
  );

  try {
    await retryOperation(async () => {
      await context.db
        .update(Component, { id: componentId })
        .set({ operator: event.args.to.toString() });
    });
    console.log("Updated component:", {
      id: componentId,
      operator: event.args.to.toString(),
    });
  } catch (e) {
    console.error("Error in ComponentRegistry:Transfer:", e);
    try {
      await retryOperation(async () => {
        await context.db
          .insert(Component)
          .values({
            id: componentId,
            tokenId: Number(componentId),
            operator: event.args.to.toString(),
            name: null,
            description: null,
            image: null,
            codeUri: null,
            blockNumber: Number(event.block.number),
            timestamp: Number(event.block.timestamp),
            packageHash: null,
            metadataHash: null,
            metadataURI: null,
          })
          .onConflictDoUpdate({
            operator: event.args.to.toString(),
            tokenId: Number(componentId),
          });
      });
      console.log("Inserted component after failed update");
    } catch (e) {
      console.error("Error inserting new component:", e);
    }
  }
});

CONTRACT_NAMES.forEach((contractName) => {
  ponder.on(`${contractName}:RegisterInstance`, async ({ event, context }) => {
    const chain = getChainName(contractName);
    const serviceId = createChainScopedId(
      chain,
      event.args.serviceId.toString().toLowerCase()
    );
    const agentId = event.args.agentId.toString();
    const agentInstanceId = event.args.agentInstance.toLowerCase();

    //first insert the agent instance if it doesn't exist
    try {
      await retryOperation(async () => {
        await context.db
          .insert(Agent)
          .values({
            id: agentId,
            name: null,
            description: null,
            image: null,
            codeUri: null,
            blockNumber: Number(event.block.number),
            timestamp: Number(event.block.timestamp),
            metadataHash: null,
            metadataURI: null,
            packageHash: null,
            operator: null,
          })
          .onConflictDoNothing();
      });
    } catch (e) {
      console.error("Error inserting agent:", e);
    }
    try {
      await retryOperation(async () => {
        await context.db
          .insert(AgentInstance)
          .values({
            id: agentInstanceId,
            agentId,
            blockNumber: Number(event.block.number),
            timestamp: Number(event.block.timestamp),
          })
          .onConflictDoUpdate({
            blockNumber: Number(event.block.number),
            timestamp: Number(event.block.timestamp),
          });

        try {
          await retryOperation(async () => {
            await context.db
              .update(Service, { id: serviceId })
              .set({ state: "REGISTERED" });
          });
        } catch (e) {
          console.error("Error updating service state:", e);
        }

        try {
          await retryOperation(async () => {
            await context.db
              .insert(ServiceAgent)
              .values({
                id: `${serviceId}-${agentInstanceId}`,
                serviceId,
                agentInstanceId,
              })
              .onConflictDoUpdate({
                serviceId,
                agentInstanceId,
              });
          });
        } catch (e) {
          console.error("Error inserting service agent connection:", e);
          try {
            const defaultService = createDefaultService(
              serviceId,
              chain,
              Number(event.block.number),
              Number(event.block.timestamp),
              null,
              Number(event.args.serviceId)
            );
            await retryOperation(async () => {
              await context.db
                .insert(Service)
                .values({ ...defaultService, state: "REGISTERED" })
                .onConflictDoUpdate({
                  state: "REGISTERED",
                  tokenId: defaultService.tokenId,
                });
            });
          } catch (insertError) {
            console.error(
              "Error in RegisterInstance fallback handler:",
              insertError
            );
          }
        }
      });
    } catch (e) {
      console.error("Error in RegisterInstance handler:", e);
    }
  });

  ponder.on(`${contractName}:CreateService`, async ({ event, context }) => {
    const chain = context?.network.name;

    const serviceId = createChainScopedId(
      chain,
      event.args.serviceId.toString().toLowerCase()
    );

    const metadataJson = await fetchMetadata(
      event.args.configHash,
      serviceId,
      "service"
    );
    const packageHash = metadataJson?.packageHash;

    const serviceData = {
      id: serviceId,
      tokenId: Number(event.args.serviceId),
      chain,
      securityDeposit: 0n,
      multisig: "0x",
      configHash: event.args.configHash,
      threshold: 0,
      maxNumAgentInstances: 0,
      numAgentInstances: 0,
      state: "UNREGISTERED" as const,
      blockNumber: Number(event.block.number),
      chainId: getChainId(chain),
      name: metadataJson?.name,
      description: metadataJson?.description,
      image: metadataJson?.image ? transformIpfsUrl(metadataJson?.image) : null,
      codeUri: metadataJson?.codeUri
        ? transformIpfsUrl(metadataJson?.codeUri)
        : null,
      metadataURI: metadataJson?.metadataURI,
      packageHash: metadataJson?.packageHash,
      metadataHash: event.args.configHash,
      timestamp: Number(event.block.timestamp),
    };
    try {
      await context.db
        .insert(Service)
        .values({
          ...serviceData,
          multisig: serviceData.multisig as `0x${string}`,
        })
        .onConflictDoUpdate({
          multisig: serviceData.multisig as `0x${string}`,
        });
    } catch (e) {
      console.error(
        `Error inserting service ${serviceId}, attempting update`,
        e
      );
      await context.db.update(Service, { id: serviceId }).set({
        ...serviceData,
        multisig: serviceData.multisig as `0x${string}`,
      });
    }
  });

  ponder.on(`${contractName}:DeployService`, async ({ event, context }) => {
    const chain = getChainName(contractName);
    const serviceId = createChainScopedId(
      chain,
      event.args.serviceId.toString().toLowerCase()
    );

    try {
      await context.db
        .update(Service, { id: serviceId })
        .set({ state: "DEPLOYED" });
    } catch (e) {
      console.error("Error updating service, attempting creation:", e);
      try {
        const defaultService = createDefaultService(
          serviceId,
          chain,
          Number(event.block.number),
          Number(event.block.timestamp),
          null,
          Number(event.args.serviceId)
        );
        await retryOperation(async () => {
          await context.db
            .insert(Service)
            .values({ ...defaultService, state: "DEPLOYED" })
            .onConflictDoUpdate({
              state: "DEPLOYED",
              tokenId: defaultService.tokenId,
            });
        });
      } catch (insertError) {
        console.error("Error in DeployService fallback handler:", insertError);
      }
    }
  });

  ponder.on(
    `${contractName}:CreateMultisigWithAgents`,
    async ({ event, context }) => {
      const chain = getChainName(contractName);
      const serviceId = createChainScopedId(
        chain,
        event.args.serviceId.toString().toLowerCase()
      );

      try {
        await retryOperation(async () => {
          await context.db
            .update(Service, { id: serviceId })
            .set({ multisig: event.args.multisig });
        });
      } catch (e) {
        console.error("Error updating service, attempting creation:", e);
        try {
          const defaultService = createDefaultService(
            serviceId,
            chain,
            Number(event.block.number),
            Number(event.block.timestamp),
            null,
            Number(event.args.serviceId)
          );
          await retryOperation(async () => {
            await context.db
              .insert(Service)
              .values({ ...defaultService, multisig: event.args.multisig })
              .onConflictDoUpdate({ multisig: event.args.multisig });
          });
        } catch (insertError) {
          console.error(
            "Error in CreateMultisigWithAgents fallback handler:",
            insertError
          );
        }
      }
    }
  );

  ponder.on(`${contractName}:TerminateService`, async ({ event, context }) => {
    const chain = getChainName(contractName);
    const serviceId = createChainScopedId(
      chain,
      event.args.serviceId.toString().toLowerCase()
    );

    try {
      await retryOperation(async () => {
        await context.db
          .update(Service, { id: serviceId })
          .set({ state: "TERMINATED" });
      });
    } catch (e) {
      console.error("Error updating service, attempting creation:", e);
      try {
        const defaultService = createDefaultService(
          serviceId,
          chain,
          Number(event.block.number),
          Number(event.block.timestamp),
          null,
          Number(event.args.serviceId)
        );
        await retryOperation(async () => {
          await context.db
            .insert(Service)
            .values({ ...defaultService, state: "TERMINATED" })
            .onConflictDoUpdate({ state: "TERMINATED" });
        });
      } catch (insertError) {
        console.error(
          "Error in TerminateService fallback handler:",
          insertError
        );
      }
    }
  });

  ponder.on(`${contractName}:UpdateService`, async ({ event, context }) => {
    const chain = getChainName(contractName);
    const serviceId = createChainScopedId(
      chain,
      event.args.serviceId.toString().toLowerCase()
    );
    let metadataJson = null;
    try {
      metadataJson = await fetchMetadata(
        event.args.configHash,
        serviceId,
        "service"
      );
    } catch (e) {
      console.error("Error fetching metadata:", e);
    }

    try {
      await retryOperation(async () => {
        await context.db.update(Service, { id: serviceId }).set({
          name: metadataJson?.name,
          description: metadataJson?.description,
          image: metadataJson?.image
            ? transformIpfsUrl(metadataJson?.image)
            : null,
          codeUri: metadataJson?.codeUri
            ? transformIpfsUrl(metadataJson?.codeUri)
            : null,
          metadataHash: metadataJson?.metadataHash,
          packageHash: metadataJson?.packageHash,
          metadataURI: metadataJson?.metadataURI,
        });
      });
    } catch (e) {
      console.error("Error updating service, attempting creation!!:", e);
      try {
        if (metadataJson) {
          const serviceData = {
            id: serviceId,
            tokenId: Number(event.args.serviceId),
            chain,
            securityDeposit: 0n,
            multisig: "0x",
            configHash: event.args.configHash,
            threshold: 0,
            maxNumAgentInstances: 0,
            numAgentInstances: 0,
            state: "UNREGISTERED" as const,
            blockNumber: Number(event.block.number),
            chainId: getChainId(chain),
            name: metadataJson?.name,
            description: metadataJson?.description,
            image: metadataJson?.image
              ? transformIpfsUrl(metadataJson?.image)
              : null,
            codeUri: metadataJson?.codeUri
              ? transformIpfsUrl(metadataJson?.codeUri)
              : null,
            metadataURI: metadataJson?.metadataURI,
            packageHash: metadataJson?.packageHash,
            metadataHash: event.args.configHash,
            timestamp: Number(event.block.timestamp),
          };
          await retryOperation(async () => {
            await context.db
              .insert(Service)
              .values({
                ...serviceData,
                multisig: serviceData.multisig as `0x${string}`,
              })
              .onConflictDoUpdate({
                multisig: serviceData.multisig as `0x${string}`,
              });
          });
        }
      } catch (insertError) {
        console.error("Error in UpdateService fallback handler:", insertError);
      }
    }
  });

  ponder.on(`${contractName}:Transfer`, async ({ event, context }) => {
    const chain = getChainName(contractName);
    const serviceId = createChainScopedId(
      chain,
      event.args.id.toString().toLowerCase()
    );

    console.log(`Handling ${contractName}:Transfer for service ${serviceId}`);
    console.log(
      `New owner: ${event.args.to}, Previous owner: ${event.args.from}`
    );

    try {
      await retryOperation(async () => {
        await context.db
          .update(Service, { id: serviceId })
          .set({ owner: event.args.to.toLowerCase() });
      });
    } catch (e) {
      console.error(`Error updating service ${serviceId} owner:`, e);
      try {
        const defaultService = createDefaultService(
          serviceId,
          chain,
          Number(event.block.number),
          Number(event.block.timestamp),
          null,
          Number(event.args.id)
        );
        await retryOperation(async () => {
          await context.db
            .insert(Service)
            .values({
              ...defaultService,
              owner: event.args.to.toLowerCase(),
            })
            .onConflictDoUpdate({
              owner: event.args.to.toLowerCase(),
            });
        });
      } catch (insertError) {
        console.error("Error in Transfer fallback handler:", insertError);
      }
    }
  });
});

// Update APY calculation to account for number of services
const calculateRawApy = (
  rewardsPerSecond: bigint,
  totalStaked: bigint,
  epochLength: bigint,
  numActiveServices: number
): number => {
  // Early return if essential values are missing or zero
  if (totalStaked === 0n || rewardsPerSecond === 0n || epochLength === 0n) {
    return 0;
  }

  // Use max of 1 for numActiveServices to avoid division by zero
  const effectiveNumServices = Math.max(1, numActiveServices);

  const SECONDS_PER_YEAR = 31536000n;
  const PRECISION = 10000n;

  const epochsPerYear = SECONDS_PER_YEAR / epochLength;
  const annualRewards = (rewardsPerSecond * epochsPerYear * PRECISION) / 1n;
  const rewardsPerService = annualRewards / BigInt(effectiveNumServices);
  const apy =
    Number((rewardsPerService * 100n) / totalStaked) / Number(PRECISION);

  return Math.max(0, Math.round(apy * 100) / 100);
};

// Handle deposits
ponder.on("StakingContracts:Deposit", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();
  const depositorAddress = event.args.sender.toLowerCase();
  const positionId = `${instanceAddress}-${depositorAddress}`;

  try {
    const instance = await retryOperation(async () =>
      context.db.find(StakingInstance, { id: instanceAddress })
    );

    if (instance) {
      await retryOperation(async () => {
        await context.db.update(StakingInstance, { id: instanceAddress }).set({
          totalStaked: event.args.balance,
          rawApy: calculateRawApy(
            instance.rewardsPerSecond ?? 0n,
            event.args.balance,
            instance.epochLength ?? 0n,
            instance.numActiveServices ?? 0
          ),
          lastApyUpdate: Number(event.block.timestamp),
        });
      });
    }

    const existingPosition = await retryOperation(async () =>
      context.db.sql
        .select()
        .from(StakingPosition)
        .where(eq(StakingPosition.id, positionId))
    );

    if (!existingPosition) {
      console.warn(
        `No staking position found for ${positionId}, skipping deposit`
      );
      return;
    }

    try {
      await retryOperation(async () => {
        await context.db.update(StakingPosition, { id: positionId }).set({
          amount: (existingPosition[0]?.amount ?? 0n) + event.args.amount,
          lastUpdateTimestamp: Number(event.block.timestamp),
        });
      });
    } catch (e) {
      console.error(`Error updating deposit for ${instanceAddress}:`, e);
    }
  } catch (e) {
    console.error(`Error updating deposit for ${instanceAddress}:`, e);
  }
});

// Handle service staking
ponder.on("StakingContracts:ServiceStaked", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();
  const instance = await retryOperation(async () =>
    context.db.find(StakingInstance, {
      id: instanceAddress,
    })
  );

  if (instance) {
    const newServiceIds = [
      ...new Set([...(instance.serviceIds || []), event.args.serviceId]),
    ];

    // Update StakingInstance
    await retryOperation(async () => {
      await context.db.update(StakingInstance, { id: instanceAddress }).set({
        serviceIds: newServiceIds.map((id) => id.toString()),
        numActiveServices: newServiceIds.length,
        rawApy: calculateRawApy(
          instance.rewardsPerSecond ?? 0n,
          instance.totalStaked ?? 0n,
          instance.epochLength ?? 0n,
          newServiceIds.length
        ),
      });
    });

    const positionId = `${instanceAddress}-${event.args.serviceId}-${event.args.owner}`;
    await retryOperation(async () => {
      await context.db
        .insert(StakingPosition)
        .values({
          id: positionId,
          stakingInstanceId: instanceAddress,
          serviceId: event.args.serviceId.toString(),
          stakerAddress: event.args.owner,
          multisig: event.args.multisig,
          amount: instance?.minStakingDeposit ?? 0n,
          lastStakeTimestamp: Number(event.block.timestamp),
          lastUpdateTimestamp: Number(event.block.timestamp),
          status: "active",
        })
        .onConflictDoUpdate({
          amount: instance?.minStakingDeposit ?? 0n,
          lastStakeTimestamp: Number(event.block.timestamp),
          lastUpdateTimestamp: Number(event.block.timestamp),
          status: "active",
        });
    });
  }
});

// Handle service unstaking
ponder.on("StakingContracts:ServiceUnstaked", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();
  const instance = await context.db.find(StakingInstance, {
    id: instanceAddress,
  });

  if (instance) {
    const newServiceIds = (instance.serviceIds || []).filter(
      (id) => id !== event.args.serviceId.toString()
    );

    // Update StakingInstance
    await retryOperation(async () => {
      await context.db.update(StakingInstance, { id: instanceAddress }).set({
        serviceIds: newServiceIds.map((id) => id.toString()),
        numActiveServices: newServiceIds.length,
        rawApy: calculateRawApy(
          instance.rewardsPerSecond ?? 0n,
          instance.totalStaked ?? 0n,
          instance.epochLength ?? 0n,
          newServiceIds.length
        ),
      });
    });

    // Update StakingPosition
    const positionId = `${instanceAddress}-${event.args.serviceId}-${event.args.owner}`;
    await retryOperation(async () => {
      await context.db.update(StakingPosition, { id: positionId }).set({
        amount: 0n,
        lastUpdateTimestamp: Number(event.block.timestamp),
        status: "UNSTAKED",
      });
    });
  }
});

// Handle withdrawals
ponder.on("StakingContracts:Withdraw", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();
  const withdrawerAddress = event.args.to.toLowerCase();
  const positionId = `${instanceAddress}-${withdrawerAddress}`;

  console.log(`Handling withdrawal for ${instanceAddress}`);
  console.log(`Withdrawer: ${withdrawerAddress}`);
  console.log(`Amount: ${event.args.amount}`);

  try {
    const instance = await retryOperation(async () =>
      context.db.find(StakingInstance, {
        id: instanceAddress,
      })
    );
    const position = await retryOperation(async () =>
      context.db.find(StakingPosition, { id: positionId })
    );

    if (instance && position) {
      const newTotalStaked = (instance.totalStaked ?? 0n) - event.args.amount;
      const newAmount = (position.amount ?? 0n) - event.args.amount;

      // Update staking instance
      await retryOperation(async () => {
        await context.db.update(StakingInstance, { id: instanceAddress }).set({
          totalStaked: newTotalStaked,
          rawApy: calculateRawApy(
            instance.rewardsPerSecond ?? 0n,
            newTotalStaked,
            instance.epochLength ?? 0n,
            instance?.numActiveServices ?? 0
          ),
          lastApyUpdate: Number(event.block.timestamp),
        });
      });

      // Update staking position
      await retryOperation(async () => {
        await context.db.update(StakingPosition, { id: positionId }).set({
          amount: newAmount,

          lastUpdateTimestamp: Number(event.block.timestamp),
          status: newAmount > 0n ? "active" : "inactive",
        });
      });
    }
  } catch (e) {
    console.error(`Error handling withdrawal for ${instanceAddress}:`, e);
  }
});

/**
 * Calculates new rewards for a staking position during checkpoint
 * @param position - The staking position
 * @param instance - The staking instance
 * @param event - The checkpoint event
 * @returns The new rewards amount in wei
 */
const calculateNewRewards = (
  position: {
    amount: bigint | null;
    lastUpdateTimestamp: number;
  },
  instance: any | null,
  event: {
    block: { timestamp: bigint };
  }
): bigint => {
  if (
    !position.amount ||
    !instance?.rewardsPerSecond ||
    !instance?.totalStaked ||
    instance.totalStaked === 0n
  ) {
    return 0n;
  }

  // Calculate time elapsed since last update
  const timeElapsed = BigInt(
    Number(event.block.timestamp) - position.lastUpdateTimestamp
  );

  // Calculate position's share of total stake
  const positionShare = (position.amount * 10n ** 18n) / instance.totalStaked;

  // Calculate rewards for the period
  // (rewardsPerSecond * timeElapsed * positionShare) / 10^18
  const newRewards =
    (instance.rewardsPerSecond * timeElapsed * positionShare) / 10n ** 18n;

  return newRewards;
};

// Update the checkpoint handler to use this calculation
ponder.on("StakingContracts:Checkpoint", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();

  try {
    const instance = await retryOperation(async () =>
      context.db.find(StakingInstance, {
        id: instanceAddress,
      })
    );

    if (instance) {
      const epochLength = event.args.epochLength;

      await retryOperation(async () => {
        await context.db.update(StakingInstance, { id: instanceAddress }).set({
          epochLength,
          rawApy: calculateRawApy(
            instance.rewardsPerSecond ?? 0n,
            instance.totalStaked ?? 0n,
            epochLength,
            instance.numActiveServices ?? 0
          ),
          lastApyUpdate: Number(event.block.timestamp),
        });
      });
    }

    // Get all active positions for this instance
    const positions = await retryOperation(async () =>
      context.db.sql
        .select()
        .from(StakingPosition)
        .where(
          and(
            eq(StakingPosition.stakingInstanceId, instanceAddress),
            eq(StakingPosition.status, "active")
          )
        )
    );

    // Update each position's rewards
    for (const position of positions) {
      const newRewards = calculateNewRewards(position, instance, event);
      await retryOperation(async () => {
        await context.db.update(StakingPosition, { id: position.id }).set({
          rewards: (position.rewards ?? 0n) + newRewards,
          totalRewards: (position.totalRewards ?? 0n) + newRewards,
          lastUpdateTimestamp: Number(event.block.timestamp),
          status: (position.amount ?? 0n) > 0n ? "active" : "inactive",
        });
      });
    }
  } catch (e) {
    console.error(`Error handling checkpoint for ${instanceAddress}:`, e);
  }
});

ponder.on(
  "StakingContracts:ServiceInactivityWarning",
  async ({ event, context }) => {
    const instanceAddress = event.log.address.toLowerCase();

    try {
      await retryOperation(async () => {
        await context.db.update(StakingInstance, { id: instanceAddress }).set({
          lastApyUpdate: Number(event.block.timestamp),
        });
      });
    } catch (e) {
      console.error(
        `Error handling inactivity warning for ${instanceAddress}:`,
        e
      );
    }
  }
);

// Handle service evictions
ponder.on("StakingContracts:ServicesEvicted", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();

  try {
    await retryOperation(async () => {
      await context.db.update(StakingInstance, { id: instanceAddress }).set({
        lastApyUpdate: Number(event.block.timestamp),
      });
    });
  } catch (e) {
    console.error(
      `Error handling services eviction for ${instanceAddress}:`,
      e
    );
  }

  //Update status of staking position
  try {
    const positions = await retryOperation(async () =>
      context.db.sql
        .select()
        .from(StakingPosition)
        .where(eq(StakingPosition.stakingInstanceId, instanceAddress))
    );

    for (const position of positions) {
      await retryOperation(async () => {
        await context.db.update(StakingPosition, { id: position.id }).set({
          status: "inactive",
        });
      });
    }
  } catch (e) {
    console.error(
      `Error handling services eviction for ${instanceAddress}:`,
      e
    );
  }
});

// Handle StakingFactory instance creation
ponder.on(
  "StakingFactoryContracts:InstanceCreated",
  async ({ event, context }) => {
    const instanceAddress = event.args.instance.toLowerCase();

    try {
      const { client } = context;
      const stakingContract = {
        abi: context.contracts.StakingContracts.abi,
        address: instanceAddress as `0x${string}`,
      };

      // Helper function for safe contract reads
      const safeRead = async (functionName: any, fallbackValue: any) => {
        try {
          return await client.readContract({
            ...stakingContract,
            functionName,
          });
        } catch (error) {
          console.warn(
            `Failed to read ${functionName} for ${instanceAddress}:`,
            error
          );
          return fallbackValue;
        }
      };

      // Execute all reads in parallel with safe fallbacks
      const [
        maxNumServices,
        minStakingDeposit,
        configHash,
        multisigThreshold,
        maxInactivityPeriods,
        minStakingPeriods,
        livenessPeriod,
        timeForEmissions,
        rewardsPerSecond,
        stakingToken,
        agentIds,
        numAgentInstances,
        activityCheckerAddress,
      ] = await Promise.all([
        safeRead("maxNumServices", 0n),
        safeRead("minStakingDeposit", 0n),
        safeRead("configHash", "0x"),
        safeRead("threshold", 0n),
        safeRead("maxNumInactivityPeriods", 0n),
        safeRead("minStakingDuration", 0n),
        safeRead("livenessPeriod", 0n),
        safeRead("timeForEmissions", 0n),
        safeRead("rewardsPerSecond", 0n),
        safeRead("stakingToken", "0x0000000000000000000000000000000000000000"),
        safeRead("getAgentIds", []),
        safeRead("numAgentInstances", 0n),
        safeRead(
          "activityChecker",
          "0x0000000000000000000000000000000000000000"
        ),
      ]);

      await retryOperation(async () => {
        await context.db
          .insert(StakingInstance)
          .values({
            id: instanceAddress,
            implementation: event.args.implementation,
            deployer: event.args.sender,
            chain: context?.network.name,
            isActive: true,
            maxNumServices: Number(maxNumServices),
            blockNumber: Number(event.block.number),
            timestamp: Number(event.block.timestamp),
            rewardsPerSecond,
            stakingToken,
            agentIds: Array.isArray(agentIds)
              ? agentIds.map((id) => id.toString())
              : [],
            minStakingDeposit,
            maxInactivityPeriods: Number(maxInactivityPeriods),
            minStakingPeriods: Number(minStakingPeriods),
            livenessPeriod: Number(livenessPeriod),
            timeForEmissions: Number(timeForEmissions),
            numAgentInstances: Number(numAgentInstances),
            multisigThreshold: Number(multisigThreshold),
            activityCheckerAddress,
            configHash,
          })
          .onConflictDoUpdate({
            isActive: true,
          });
      });
    } catch (e) {
      console.error(
        `Error handling instance creation for ${instanceAddress}:`,
        e
      );
    }
  }
);

ponder.on(
  "StakingFactoryContracts:InstanceStatusChanged",
  async ({ event, context }) => {
    const instanceAddress = event.args.instance.toLowerCase();

    try {
      await retryOperation(async () => {
        await context.db.update(StakingInstance, { id: instanceAddress }).set({
          isActive: event.args.isEnabled,
        });
      });
    } catch (e) {
      console.error(
        `Error handling instance status change for ${instanceAddress}:`,
        e
      );
    }
  }
);

ponder.on(
  "StakingFactoryContracts:InstanceRemoved",
  async ({ event, context }) => {
    const instanceAddress = event.args.instance.toLowerCase();

    try {
      await retryOperation(async () => {
        await context.db.update(StakingInstance, { id: instanceAddress }).set({
          isActive: false,
        });
      });
    } catch (e) {
      console.error(
        `Error handling instance removal for ${instanceAddress}:`,
        e
      );
    }
  }
);

ponder.on("StakingContracts:RewardClaimed", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();
  const chainServiceId = createChainScopedId(
    context.network.name,
    event.args.serviceId.toString()
  );
  const positionId = `${instanceAddress}-${chainServiceId}`;

  try {
    const position = await retryOperation(async () =>
      context.db.find(StakingPosition, { id: positionId })
    );

    if (position) {
      await retryOperation(async () => {
        await context.db.update(StakingPosition, { id: positionId }).set({
          rewards: 0n,
          claimedRewards: (position.claimedRewards ?? 0n) + event.args.reward,
          lastUpdateTimestamp: Number(event.block.timestamp),
        });
      });
    }
  } catch (e) {
    console.error(`Error handling reward claim for ${positionId}:`, e);
  }
});
