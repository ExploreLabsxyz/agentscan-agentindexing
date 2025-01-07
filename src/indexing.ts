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
import { StakingTokenAbi } from "../abis/StakingToken";

const createDefaultService = (
  serviceId: string,
  chain: string,
  blockNumber: number,
  timestamp: number,
  configHash?: string | null
) => ({
  id: serviceId,
  chain,
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
    name: metadataJson.name,
    description: metadataJson.description,
    image: metadataJson.image ? transformIpfsUrl(metadataJson.image) : null,
    codeUri: metadataJson.codeUri
      ? transformIpfsUrl(metadataJson.codeUri)
      : null,
    blockNumber: Number(event.block.number),
    timestamp: Number(event.block.timestamp),
    packageHash: metadataJson.packageHash,
    metadataHash: event.args.unitHash,
    metadataURI: metadataJson.metadataURI,
  };

  await context.db
    .insert(Agent)
    .values(updateData)
    .onConflictDoUpdate({
      name: updateData.name,
      description: updateData.description,
      image: updateData.image ? transformIpfsUrl(updateData?.image) : null,
      codeUri: updateData.codeUri
        ? transformIpfsUrl(updateData?.codeUri)
        : null,
    });

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
      await context.db
        .insert(Agent)
        .values({
          id: agentId,
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
        .onConflictDoUpdate({ operator: event.args.to.toString() });
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
    name: metadataJson.name,
    description: metadataJson.description,
    image: metadataJson.image ? transformIpfsUrl(metadataJson.image) : null,
    codeUri: metadataJson.codeUri
      ? transformIpfsUrl(metadataJson.codeUri)
      : null,
    blockNumber: Number(event.block.number),
    timestamp: Number(event.block.timestamp),
    packageHash: metadataJson.packageHash,
    metadataHash: event.args.unitHash,
    metadataURI: metadataJson.metadataURI,
  };

  await context.db
    .insert(Component)
    .values(updateData)
    .onConflictDoUpdate({
      name: updateData.name,
      description: updateData.description,
      image: updateData.image ? transformIpfsUrl(updateData?.image) : null,
      codeUri: updateData.codeUri
        ? transformIpfsUrl(updateData?.codeUri)
        : null,
    });
});

ponder.on(`MainnetComponentRegistry:Transfer`, async ({ event, context }) => {
  const componentId = event.args.id.toString();
  console.log(
    `Handling MainnetComponentRegistry:Transfer for component ${componentId}`
  );

  try {
    await context.db
      .update(Component, { id: componentId })
      .set({ operator: event.args.to.toString() });
  } catch (e) {
    console.error("Error in ComponentRegistry:Transfer:", e);
    try {
      await context.db
        .insert(Component)
        .values({
          id: componentId,
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
        .onConflictDoUpdate({ operator: event.args.to.toString() });
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
    } catch (e) {
      console.error("Error inserting agent:", e);
    }
    try {
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
        await context.db
          .update(Service, { id: serviceId })
          .set({ state: "REGISTERED" });
      } catch (e) {
        console.error("Error updating service state:", e);
      }

      try {
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
      } catch (e) {
        console.error("Error inserting service agent connection:", e);
        try {
          const defaultService = createDefaultService(
            serviceId,
            chain,
            Number(event.block.number),
            Number(event.block.timestamp)
          );
          await context.db
            .insert(Service)
            .values({ ...defaultService, state: "REGISTERED" })
            .onConflictDoUpdate({
              state: "REGISTERED",
            });
        } catch (insertError) {
          console.error(
            "Error in RegisterInstance fallback handler:",
            insertError
          );
        }
      }
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
      packageHash,
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
          Number(event.block.timestamp)
        );
        await context.db
          .insert(Service)
          .values({ ...defaultService, state: "DEPLOYED" })
          .onConflictDoUpdate({ state: "DEPLOYED" });
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
        await context.db
          .update(Service, { id: serviceId })
          .set({ multisig: event.args.multisig });
      } catch (e) {
        console.error("Error updating service, attempting creation:", e);
        try {
          const defaultService = createDefaultService(
            serviceId,
            chain,
            Number(event.block.number),
            Number(event.block.timestamp)
          );
          await context.db
            .insert(Service)
            .values({ ...defaultService, multisig: event.args.multisig })
            .onConflictDoUpdate({ multisig: event.args.multisig });
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
      await context.db
        .update(Service, { id: serviceId })
        .set({ state: "TERMINATED" });
    } catch (e) {
      console.error("Error updating service, attempting creation:", e);
      try {
        const defaultService = createDefaultService(
          serviceId,
          chain,
          Number(event.block.number),
          Number(event.block.timestamp)
        );
        await context.db
          .insert(Service)
          .values({ ...defaultService, state: "TERMINATED" })
          .onConflictDoUpdate({ state: "TERMINATED" });
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

    try {
      const metadataJson = await fetchMetadata(
        event.args.configHash,
        serviceId,
        "service"
      );
      const packageHash = metadataJson?.packageHash;
      await context.db.update(Service, { id: serviceId }).set({
        metadataURI: metadataJson?.metadataURI,
        packageHash,
        metadataHash: event.args.configHash,
        name: metadataJson?.name,
        description: metadataJson?.description,
        image: metadataJson?.image
          ? transformIpfsUrl(metadataJson?.image)
          : null,
        codeUri: metadataJson?.codeUri
          ? transformIpfsUrl(metadataJson?.codeUri)
          : null,
      });
    } catch (e) {
      console.error("Error updating service, attempting creation!!:", e);
      try {
        const defaultService = createDefaultService(
          serviceId,
          chain,
          Number(event.block.number),
          Number(event.block.timestamp),
          event.args.configHash
        );
        await context.db
          .insert(Service)
          .values({
            ...defaultService,
          })
          .onConflictDoUpdate({
            metadataHash: event.args.configHash,
          });
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
      await context.db
        .update(Service, { id: serviceId })
        .set({ owner: event.args.to.toLowerCase() });
    } catch (e) {
      console.error(`Error updating service ${serviceId} owner:`, e);
      try {
        const defaultService = createDefaultService(
          serviceId,
          chain,
          Number(event.block.number),
          Number(event.block.timestamp)
        );
        await context.db
          .insert(Service)
          .values({
            ...defaultService,
            owner: event.args.to.toLowerCase(),
          })
          .onConflictDoUpdate({
            owner: event.args.to.toLowerCase(),
          });
      } catch (insertError) {
        console.error("Error in Transfer fallback handler:", insertError);
      }
    }
  });
});

/**
 * Calculates raw APY for a staking position
 * @param rewardsPerSecond - Rewards in OLAS per second (in wei)
 * @param epochLength - Length of epoch in seconds
 * @param totalStaked - Total amount staked (in wei)
 * @returns APY as a decimal (e.g. 0.15 for 15% APY)
 */
const calculateRawApy = (
  rewardsPerSecond: bigint,
  epochLength: bigint,
  totalStaked: bigint
): number => {
  if (totalStaked === 0n) return 0;

  // Calculate rewards for one epoch
  const rewardsPerEpoch = rewardsPerSecond * epochLength;

  // Calculate rewards for one year
  const SECONDS_PER_YEAR = 31536000n; // 365 * 24 * 60 * 60
  const epochsPerYear = SECONDS_PER_YEAR / epochLength;
  const rewardsPerYear = rewardsPerEpoch * epochsPerYear;

  // Convert to decimal numbers for division
  const annualRewards = Number(rewardsPerYear) / 1e18; // Convert from wei to OLAS
  const stakedAmount = Number(totalStaked) / 1e18; // Convert from wei to OLAS

  // Multiply by 100 to get percentage value
  return (annualRewards / stakedAmount) * 100;
};

// Handle deposits
ponder.on("StakingContracts:Deposit", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();
  const depositorAddress = event.args.sender.toLowerCase();
  const positionId = `${instanceAddress}-${depositorAddress}`;

  console.log(`Handling deposit for ${instanceAddress}`);
  console.log(`Depositor: ${depositorAddress}`);

  try {
    await context.db.update(StakingInstance, { id: instanceAddress }).set({
      totalStaked: event.args.balance,
      lastApyUpdate: Number(event.block.timestamp),
    });

    await context.db
      .insert(StakingPosition)
      .values({
        id: positionId,
        stakingInstanceId: instanceAddress,
        stakerAddress: depositorAddress,
        amount: event.args.amount ?? 0n,
        lastStakeTimestamp: Number(event.block.timestamp),
        lastUpdateTimestamp: Number(event.block.timestamp),
        isActive: true,
      })
      .onConflictDoUpdate((row) => ({
        amount: (row?.amount ?? 0n) + event.args.amount,
        lastUpdateTimestamp: Number(event.block.timestamp),
      }));
  } catch (e) {
    console.error(`Error updating deposit for ${instanceAddress}:`, e);
  }
});

// Handle service staking
ponder.on("StakingContracts:ServiceStaked", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();
  const stakerAddress = event.args.owner.toLowerCase();
  const positionId = `${instanceAddress}-${stakerAddress}`;
  const serviceId = event.args.serviceId.toString();

  console.log(`Handling service staking for ${instanceAddress}`);
  console.log(`Staker: ${stakerAddress}`);
  console.log(`Service: ${serviceId}`);

  try {
    await context.db.update(StakingInstance, { id: instanceAddress }).set({
      isActive: true,
      lastApyUpdate: Number(event.block.timestamp),
    });

    // Update staking position
    const position = await context.db.find(StakingPosition, { id: positionId });

    if (position) {
      const updatedServiceIds = [
        ...new Set([...(position.serviceIds ?? []), serviceId]),
      ];
      await context.db.update(StakingPosition, { id: positionId }).set({
        isActive: true,
        serviceIds: updatedServiceIds,
        lastUpdateTimestamp: Number(event.block.timestamp),
      });
    }
  } catch (e) {
    console.error(`Error handling service staking for ${instanceAddress}:`, e);
  }
});

// Handle service unstaking
ponder.on("StakingContracts:ServiceUnstaked", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();
  const stakerAddress = event.args.owner.toLowerCase();
  const positionId = `${instanceAddress}-${stakerAddress}`;
  const serviceId = event.args.serviceId.toString();
  console.log(`Handling service unstaking for ${instanceAddress}`);
  console.log(`Staker: ${stakerAddress}`);
  console.log(`Service: ${serviceId}`);

  try {
    const instance = await context.db.find(StakingInstance, {
      id: instanceAddress,
    });
    const position = await context.db.find(StakingPosition, { id: positionId });

    if (instance && position) {
      const newTotalStaked = (instance.totalStaked ?? 0n) - event.args.reward;
      const newAmount = (position.amount ?? 0n) - event.args.reward;
      const updatedServiceIds = position.serviceIds?.filter(
        (id) => id !== serviceId
      );

      await context.db.update(StakingInstance, { id: instanceAddress }).set({
        totalStaked: newTotalStaked,
        rawApy: calculateRawApy(
          instance.rewardsPerSecond ?? 0n,
          instance.epochLength ?? 0n,
          newTotalStaked
        ),
        lastApyUpdate: Number(event.block.timestamp),
      });

      // Update staking position
      await context.db.update(StakingPosition, { id: positionId }).set({
        amount: newAmount,
        serviceIds: updatedServiceIds,
        rewards: (position.rewards ?? 0n) + event.args.reward,
        isActive: (updatedServiceIds?.length ?? 0) > 0,
        lastUpdateTimestamp: Number(event.block.timestamp),
      });
    }
  } catch (e) {
    console.error(
      `Error handling service unstaking for ${instanceAddress}:`,
      e
    );
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
    const instance = await context.db.find(StakingInstance, {
      id: instanceAddress,
    });
    const position = await context.db.find(StakingPosition, { id: positionId });

    if (instance && position) {
      const newTotalStaked = (instance.totalStaked ?? 0n) - event.args.amount;
      const newAmount = (position.amount ?? 0n) - event.args.amount;

      // Update staking instance
      await context.db.update(StakingInstance, { id: instanceAddress }).set({
        totalStaked: newTotalStaked,
        rawApy: calculateRawApy(
          instance.rewardsPerSecond ?? 0n,
          instance.epochLength ?? 0n,
          newTotalStaked
        ),
        lastApyUpdate: Number(event.block.timestamp),
      });

      // Update staking position
      await context.db.update(StakingPosition, { id: positionId }).set({
        amount: newAmount,
        isActive: newAmount > 0n,
        lastUpdateTimestamp: Number(event.block.timestamp),
      });
    }
  } catch (e) {
    console.error(`Error handling withdrawal for ${instanceAddress}:`, e);
  }
});

// Handle reward claims
ponder.on("StakingContracts:RewardClaimed", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();
  const claimerAddress = event.args.owner.toLowerCase();
  const positionId = `${instanceAddress}-${claimerAddress}`;

  console.log(`Handling reward claim for ${instanceAddress}`);
  console.log(`Claimer: ${claimerAddress}`);
  console.log(`Reward: ${event.args.reward}`);
  console.log("positionId", positionId);
  try {
    const position = await context.db.find(StakingPosition, { id: positionId });

    if (position) {
      await context.db.update(StakingPosition, { id: positionId }).set({
        rewards: (position.rewards ?? 0n) + event.args.reward,
        lastUpdateTimestamp: Number(event.block.timestamp),
      });
    }

    await context.db.update(StakingInstance, { id: instanceAddress }).set({
      lastApyUpdate: Number(event.block.timestamp),
    });
  } catch (e) {
    console.error(`Error handling reward claim for ${instanceAddress}:`, e);
  }
});

// Handle checkpoints which might update rewards
ponder.on("StakingContracts:Checkpoint", async ({ event, context }) => {
  const instanceAddress = event.log.address.toLowerCase();

  try {
    const instance = await context.db.find(StakingInstance, {
      id: instanceAddress,
    });

    if (instance) {
      await context.db.update(StakingInstance, { id: instanceAddress }).set({
        epochLength: BigInt(event.args.epochLength.toString()),
        rawApy: calculateRawApy(
          instance.rewardsPerSecond ?? 0n,
          event.args.epochLength,
          instance.totalStaked ?? 0n
        ),
        lastApyUpdate: Number(event.block.timestamp),
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
      await context.db.update(StakingInstance, { id: instanceAddress }).set({
        lastApyUpdate: Number(event.block.timestamp),
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
    await context.db.update(StakingInstance, { id: instanceAddress }).set({
      lastApyUpdate: Number(event.block.timestamp),
    });
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
      const { StakingContracts } = context.contracts;

      const [
        rewardsPerSecond,
        stakingTokenAddress,
        agentIds,
        maxNumServices,
        minStakingDeposit,
        maxInactivityPeriods,
        minStakingPeriods,
        livenessPeriod,
        timeForEmissions,
        numAgentInstances,
        multisigThreshold,
        activityCheckerAddress,
        configHash,
      ] = await Promise.all([
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "rewardsPerSecond",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "stakingToken",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "getAgentIds",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "maxNumServices",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "minStakingDeposit",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "maxNumInactivityPeriods",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "minStakingDuration",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "livenessPeriod",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "timeForEmissions",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "numAgentInstances",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "threshold",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "activityChecker",
        }),
        client.readContract({
          abi: StakingContracts.abi,
          address: instanceAddress as `0x${string}`,
          functionName: "configHash",
        }),
      ]);

      await context.db.insert(StakingInstance).values({
        id: instanceAddress,
        implementation: event.args.implementation,
        deployer: event.args.sender,
        chain: context?.network.name,
        isActive: true,
        maxNumServices: Number(maxNumServices),
        blockNumber: Number(event.block.number),
        timestamp: Number(event.block.timestamp),
        rewardsPerSecond: rewardsPerSecond,
        stakingToken: stakingTokenAddress,
        agentIds: agentIds.map((id: any) => id.toString()),
        minStakingDeposit,
        maxInactivityPeriods: Number(maxInactivityPeriods),
        minStakingPeriods: Number(minStakingPeriods),
        livenessPeriod: Number(livenessPeriod),
        timeForEmissions: Number(timeForEmissions),
        numAgentInstances: Number(numAgentInstances),
        multisigThreshold: Number(multisigThreshold),
        activityCheckerAddress,
        configHash,
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
      await context.db.update(StakingInstance, { id: instanceAddress }).set({
        isActive: event.args.isEnabled,
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
      await context.db.update(StakingInstance, { id: instanceAddress }).set({
        isActive: false,
      });
    } catch (e) {
      console.error(
        `Error handling instance removal for ${instanceAddress}:`,
        e
      );
    }
  }
);
