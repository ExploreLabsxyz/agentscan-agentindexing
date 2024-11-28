import { onchainTable, onchainEnum, index, relations } from "@ponder/core";

export const ServiceState = onchainEnum("state", [
  "UNREGISTERED",
  "REGISTERED",
  "DEPLOYED",
  "AGENT_INSTANCES",
  "ACTIVE",
  "TERMINATED",
]);

export const Service = onchainTable(
  "service",
  (t) => ({
    id: t.text().primaryKey(),
    chain: t.text().notNull(),
    securityDeposit: t.bigint(),
    multisig: t.hex(),
    threshold: t.integer(),
    maxNumAgentInstances: t.integer(),
    numAgentInstances: t.integer(),
    state: ServiceState("state"),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    name: t.text(),
    description: t.text(),
    image: t.text(),
    codeUri: t.text(),
    chainId: t.integer(),

    metadataHash: t.text(),
    metadataURI: t.text(),
  }),
  (table) => ({
    idx: index().on(table.id),
    chainIdx: index().on(table.chain),

    metadataHashIdx: index().on(table.metadataHash),
    timestampIdx: index().on(table.timestamp),
    blockNumberIdx: index().on(table.blockNumber),
    nameIdx: index().on(table.name),
    descriptionIdx: index().on(table.description),
    imageIdx: index().on(table.image),
    codeUriIdx: index().on(table.codeUri),
  })
);

export const Agent = onchainTable(
  "agent",
  (t) => ({
    id: t.text().primaryKey(),
    name: t.text(),
    description: t.text(),
    image: t.text(),
    codeUri: t.text(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    metadataHash: t.text(),
    metadataURI: t.text(),

    operator: t.text(),
  }),
  (table) => ({
    idx: index().on(table.id),

    metadataHashIdx: index().on(table.metadataHash),
    timestampIdx: index().on(table.timestamp),
    blockNumberIdx: index().on(table.blockNumber),
    operatorIdx: index().on(table.operator),
    nameIdx: index().on(table.name),
    descriptionIdx: index().on(table.description),
    imageIdx: index().on(table.image),
    codeUriIdx: index().on(table.codeUri),
  })
);

export const AgentInstance = onchainTable(
  "agent_instance",
  (t) => ({
    id: t.text().primaryKey(),
    agentId: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    idx: index().on(table.id),
    agentIdx: index().on(table.agentId),
    timestampIdx: index().on(table.timestamp),
    blockNumberIdx: index().on(table.blockNumber),
  })
);

export const Component = onchainTable(
  "component",
  (t) => ({
    id: t.text().primaryKey(),
    instance: t.text().notNull(),
    name: t.text(),
    description: t.text(),
    image: t.text(),
    codeUri: t.text(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    metadataHash: t.text(),
    metadataURI: t.text(),
  }),
  (table) => ({
    idx: index().on(table.id),
    instanceIdx: index().on(table.instance),

    metadataHashIdx: index().on(table.metadataHash),
    timestampIdx: index().on(table.timestamp),
    blockNumberIdx: index().on(table.blockNumber),
    nameIdx: index().on(table.name),
    descriptionIdx: index().on(table.description),
    imageIdx: index().on(table.image),
    codeUriIdx: index().on(table.codeUri),
  })
);

// Relations

export const ServiceAgent = onchainTable("service_agent", (t) => ({
  id: t.text().primaryKey(),
  serviceId: t.text().notNull(),
  agentInstanceId: t.text().notNull(),
}));

export const ServiceAgentRelations = relations(ServiceAgent, ({ one }) => ({
  service: one(Service, {
    fields: [ServiceAgent.serviceId],
    references: [Service.id],
  }),
  agentInstance: one(AgentInstance, {
    fields: [ServiceAgent.agentInstanceId],
    references: [AgentInstance.id],
  }),
}));

// Add these relations for Service and Agent
export const ServiceRelations = relations(Service, ({ many }) => ({
  serviceAgents: many(ServiceAgent),
}));

export const AgentRelations = relations(Agent, ({ many }) => ({
  instances: many(AgentInstance),
}));

export const ComponentAgent = onchainTable("component_agent", (t) => ({
  id: t.text().primaryKey(),
  componentId: t.text().notNull(),
  agentId: t.text().notNull(),
}));

export const ComponentDependency = onchainTable(
  "component_dependency",
  (t) => ({
    id: t.text().primaryKey(),
    componentId: t.text().notNull(),
    dependencyId: t.text().notNull(),
  }),
  (table) => ({
    idx: index().on(table.id),
    componentIdx: index().on(table.componentId),
    dependencyIdx: index().on(table.dependencyId),
  })
);

export const ComponentDependencyRelations = relations(
  ComponentDependency,
  ({ one }) => ({
    component: one(Component, {
      fields: [ComponentDependency.componentId],
      references: [Component.id],
    }),
    dependency: one(Component, {
      fields: [ComponentDependency.dependencyId],
      references: [Component.id],
    }),
  })
);

export const ComponentRelations = relations(Component, ({ many }) => ({
  agentComponents: many(ComponentAgent),
  dependencies: many(ComponentDependency, { relationName: "component" }),
  dependents: many(ComponentDependency, { relationName: "dependency" }),
}));

export const AgentComponentRelations = relations(Agent, ({ many }) => ({
  componentAgents: many(ComponentAgent),
}));

export const ComponentAgentRelations = relations(ComponentAgent, ({ one }) => ({
  component: one(Component, {
    fields: [ComponentAgent.componentId],
    references: [Component.id],
  }),
  agent: one(Agent, {
    fields: [ComponentAgent.agentId],
    references: [Agent.id],
  }),
}));

export const AgentInstanceRelations = relations(AgentInstance, ({ one }) => ({
  agent: one(Agent, {
    fields: [AgentInstance.agentId],
    references: [Agent.id],
  }),
}));
