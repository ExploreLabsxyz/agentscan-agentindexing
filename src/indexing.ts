import { ponder } from "@/generated";
import { Service, Agent, AgentInstance, ServiceAgent } from "../ponder.schema";
import {
  CONTRACT_NAMES,
  createChainScopedId,
  fetchMetadata,
  getChainId,
  getChainName,
  withErrorBoundary,
} from "../utils";

ponder.on(`MainnetAgentRegistry:CreateUnit`, async ({ event, context }) => {
  const agentId = event.args.unitId.toString();

  await withErrorBoundary(async () => {
    const [metadataJson, existingAgent] = await Promise.all([
      fetchMetadata(event.args.unitHash, agentId, "agent"),
      context.db.find(Agent, { id: agentId }),
    ]);

    const updateData = {
      name: metadataJson.name,
      description: metadataJson.description,
      image: metadataJson.image,
      codeUri: metadataJson.code_uri,
      blockNumber: Number(event.block.number),
      timestamp: Number(event.block.timestamp),

      metadataHash: event.args.unitHash,
      metadataURI: metadataJson.metadataURI,
    };

    if (existingAgent) {
      await context.db.update(Agent, { id: agentId }).set(updateData);
    } else {
      await context.db.insert(Agent).values({
        id: agentId,
        ...updateData,
      });
    }
  }, `AgentRegistry:CreateUnit for ${agentId}`);
});

ponder.on(`MainnetAgentRegistry:Transfer`, async ({ event, context }) => {
  const agentId = event.args.id.toString();

  try {
    const existingAgent = await context.db.find(Agent, { id: agentId });

    if (existingAgent) {
      await context.db.update(Agent, { id: agentId }).set({
        operator: event.args.to.toString(),
      });
    } else {
      await context.db.insert(Agent).values({
        id: agentId,
        operator: event.args.to.toString(),
        name: "", // Default name
        description: "", // Default description
        image: "", // Default image
        codeUri: "", // Default codeUri
        blockNumber: Number(event.block.number),
        timestamp: Number(event.block.timestamp),

        metadataHash: "", // Default metadataHash
        metadataURI: "", // Default metadataURI
      });
    }
  } catch (e) {
    console.error("Error in AgentRegistry:Transfer:", e);
  }
});

ponder.on(`MainnetAgentRegistry:UpdateUnitHash`, async ({ event, context }) => {
  const agentId = event.args.unitId.toString();
  const metadataJson = await fetchMetadata(
    event.args.unitHash,
    agentId,
    "agent"
  );

  try {
    await context.db.update(Agent, { id: agentId }).set({
      name: metadataJson.name || "",
      description: metadataJson.description || "",
      image: metadataJson.image || "",
      codeUri: metadataJson.code_uri || "",
      blockNumber: Number(event.block.number),
      timestamp: Number(event.block.timestamp),

      metadataHash: event.args.unitHash,
      metadataURI: metadataJson?.metadataURI || "",
    });
  } catch (e) {
    // console.error("Error in UpdateUnitHash handler for Agent:", e);
  }
});

CONTRACT_NAMES.forEach((contractName) => {
  ponder.on(`${contractName}:CreateService`, async ({ event, context }) => {
    const chain = getChainName(contractName);
    const serviceId = event.args.serviceId.toString().toLowerCase();
    const cleanServiceId = serviceId.replace(/^service-/, "");
    const chainScopedId = createChainScopedId(chain, cleanServiceId);

    const metadataJson = await fetchMetadata(
      event.args.configHash,
      chainScopedId,
      "service"
    );

    const serviceData = {
      id: chainScopedId,
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
      name: metadataJson?.name || "",
      description: metadataJson?.description || "",
      image: metadataJson?.image || "",
      codeUri: metadataJson?.code_uri || "",
      metadataURI: metadataJson?.metadataURI || "",

      metadataHash: event.args.configHash,
      timestamp: Number(event.block.timestamp),
    };
    try {
      await context.db.insert(Service).values({
        ...serviceData,
        multisig: serviceData.multisig as `0x${string}`,
      });
    } catch (e) {
      //if the service already exists, update it
      await context.db.update(Service, { id: chainScopedId }).set({
        ...serviceData,
        multisig: serviceData.multisig as `0x${string}`,
      });
    }
  });

  ponder.on(`${contractName}:DeployService`, async ({ event, context }) => {
    const chain = getChainName(contractName);
    const serviceId = event.args.serviceId.toString().toLowerCase();
    const cleanServiceId = serviceId.replace(/^service-/, "");
    const chainScopedId = createChainScopedId(chain, cleanServiceId);

    try {
      const service = await context.db.find(Service, { id: chainScopedId });
      if (service) {
        await context.db
          .update(Service, {
            id: chainScopedId,
          })
          .set({
            state: "DEPLOYED",
          });
      } else {
        console.log("service not found", chainScopedId);
      }
    } catch (e) {
      console.log("error", e);
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
        await context.db.update(Service, { id: serviceId }).set({
          multisig: event.args.multisig,
        });
      } catch (e) {
        console.log("error", e);
      }
    }
  );

  ponder.on(`${contractName}:RegisterInstance`, async ({ event, context }) => {
    const chain = getChainName(contractName);
    const serviceId = createChainScopedId(
      chain,
      event.args.serviceId.toString().toLowerCase()
    );
    const agentId = event.args.agentId.toString();

    try {
      try {
        await context.db.insert(AgentInstance).values({
          id: event.args.agentInstance,
          agentId: agentId,
          serviceId: serviceId,
          blockNumber: Number(event.block.number),
          timestamp: Number(event.block.timestamp),
        });
      } catch (e) {
        console.log("error inserting agent instance", e);
      }

      const service = await context.db.find(Service, { id: serviceId });
      if (service) {
        await context.db.update(Service, { id: serviceId }).set({
          state: "REGISTERED",
        });
      }

      await context.db.insert(ServiceAgent).values({
        id: `${serviceId}-${event.args.agentInstance}`,
        serviceId,
        agentInstanceId: event.args.agentInstance,
        chain,
      });
      ``;
    } catch (e) {
      console.error("Error in RegisterInstance handler:", e);
    }
  });

  ponder.on(`${contractName}:TerminateService`, async ({ event, context }) => {
    const chain = getChainName(contractName);
    const serviceId = createChainScopedId(
      chain,
      event.args.serviceId.toString().toLowerCase()
    );

    try {
      await context.db
        .update(Service, {
          id: createChainScopedId(chain, serviceId),
        })
        .set({
          state: "TERMINATED",
        });
    } catch (e) {
      console.log("error", e);
    }
  });

  ponder.on(`${contractName}:UpdateService`, async ({ event, context }) => {
    const chain = getChainName(contractName);
    const serviceId = createChainScopedId(
      chain,
      event.args.serviceId.toString()
    );
    const metadataJson = await fetchMetadata(
      event.args.configHash,
      serviceId,
      "service"
    );

    if (!metadataJson) {
      console.warn(`No metadata found for service ${serviceId}`);
      return;
    }

    try {
      await context.db.update(Service, { id: serviceId }).set({
        name: metadataJson.name || "",
        description: metadataJson.description || "",
        image: metadataJson.image || "",
        codeUri: metadataJson.code_uri || "",
        metadataURI: metadataJson.metadataURI || "",
        metadataHash: event.args.configHash,
      });
    } catch (e) {
      // console.error("Error in UpdateService handler:", e);
    }
  });
});
