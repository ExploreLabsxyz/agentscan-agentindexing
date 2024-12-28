import { ponder } from "ponder:registry";
import {
  Service,
  Agent,
  ServiceAgent,
  ComponentAgent,
  AgentInstance,
  Component,
} from "ponder:schema";
import {
  CONTRACT_NAMES,
  createChainScopedId,
  fetchMetadata,
  getChainId,
  getChainName,
  transformIpfsUrl,
} from "../utils";

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
    const chain = getChainName(contractName);

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
