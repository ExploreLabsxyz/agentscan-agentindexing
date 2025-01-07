import {
  onchainTable,
  onchainEnum,
  index,
  relations,
  primaryKey,
} from "ponder";

// ============================================================================
// ENUMS
// ============================================================================
export const ServiceState = onchainEnum("state", [
  "UNREGISTERED",
  "REGISTERED",
  "DEPLOYED",
  "AGENT_INSTANCES",
  "ACTIVE",
  "TERMINATED",
]);

// ============================================================================
// CORE TABLES
// ============================================================================
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
    chainId: t.integer().notNull(),
    packageHash: t.text(),
    metadataHash: t.text(),
    metadataURI: t.text(),
    name: t.text(),
    description: t.text(),
    image: t.text(),
    codeUri: t.text(),
    owner: t.text(),
  }),
  (table) => ({
    idx: index().on(table.id),
    chainIdx: index().on(table.chain),
    packageHashIdx: index().on(table.packageHash),
    metadataHashIdx: index().on(table.metadataHash),
    timestampIdx: index().on(table.timestamp),
    blockNumberIdx: index().on(table.blockNumber),
    nameIdx: index().on(table.name),
    descriptionIdx: index().on(table.description),
    imageIdx: index().on(table.image),
    codeUriIdx: index().on(table.codeUri),
    ownerIdx: index().on(table.owner),
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
    packageHash: t.text(),
    operator: t.text(),
  }),
  (table) => ({
    idx: index().on(table.id),
    packageHashIdx: index().on(table.packageHash),
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
    agentIdIdx: index().on(table.agentId),
    timestampIdx: index().on(table.timestamp),
    blockNumberIdx: index().on(table.blockNumber),
  })
);

export const Component = onchainTable(
  "component",
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
    packageHash: t.text(),
    operator: t.text(),
  }),
  (table) => ({
    idx: index().on(table.id),
    packageHashIdx: index().on(table.packageHash),
    metadataHashIdx: index().on(table.metadataHash),
    timestampIdx: index().on(table.timestamp),
    blockNumberIdx: index().on(table.blockNumber),
    nameIdx: index().on(table.name),
    descriptionIdx: index().on(table.description),
    imageIdx: index().on(table.image),
    codeUriIdx: index().on(table.codeUri),
    operatorIdx: index().on(table.operator),
  })
);

export const StakingInstance = onchainTable(
  "staking_instance",
  (t) => ({
    id: t.text().primaryKey(),
    chain: t.text().notNull(),
    implementation: t.text().notNull(),
    deployer: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    totalStaked: t.bigint().default(0n),
    stakingToken: t.text(),
    isActive: t.boolean().default(true),
    rewardsPerSecond: t.bigint().default(0n),
    epochLength: t.bigint().default(0n),
    rawApy: t.real().default(0),
    lastApyUpdate: t.integer().default(0),
    agentIds: t.text().array(),
    maxNumServices: t.integer(),
    minStakingDeposit: t.bigint(),
    maxInactivityPeriods: t.integer(),
    minStakingPeriods: t.integer(),
    livenessPeriod: t.integer(),
    timeForEmissions: t.integer(),
    numAgentInstances: t.integer(),
    multisigThreshold: t.integer(),
    activityCheckerAddress: t.text(),
    configHash: t.text(),
  }),
  (table) => ({
    chainIdx: index().on(table.chain),
    implementationIdx: index().on(table.implementation),
    deployerIdx: index().on(table.deployer),
    timestampIdx: index().on(table.timestamp),
    blockNumberIdx: index().on(table.blockNumber),
    apyIdx: index().on(table.rawApy),
    isActiveIdx: index().on(table.isActive),
  })
);

export const StakingPosition = onchainTable(
  "staking_position",
  (t) => ({
    id: t.text().primaryKey(),
    stakingInstanceId: t.text().notNull(),
    serviceId: t.text().notNull(),
    stakerAddress: t.text().notNull(),
    multisig: t.text().notNull(),
    amount: t.bigint().default(0n),
    lastStakeTimestamp: t.integer().notNull(),
    lastUpdateTimestamp: t.integer().notNull(),

    rewards: t.bigint().default(0n),
    totalRewards: t.bigint().default(0n),
    claimedRewards: t.bigint().default(0n),
    status: t.text(),
  }),
  (table) => ({
    stakingInstanceIdx: index().on(table.stakingInstanceId),
    serviceIdIdx: index().on(table.serviceId),
    stakerAddressIdx: index().on(table.stakerAddress),
    multisigIdx: index().on(table.multisig),
    timestampIdx: index().on(table.lastUpdateTimestamp),

    statusIdx: index().on(table.status),
  })
);

// ============================================================================
// RELATIONSHIP TABLES
// ============================================================================
export const ServiceAgent = onchainTable("service_agent", (t) => ({
  id: t.text().primaryKey(),
  serviceId: t.text().notNull(),
  agentInstanceId: t.text().notNull(),
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

// ============================================================================
// TRANSACTION RELATED TABLES
// ============================================================================
export const Transaction = onchainTable(
  "transaction",
  (t) => ({
    hash: t.text(),
    chain: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    from: t.text().notNull(),
    to: t.text(),
    value: t.text(),
    input: t.text(),
    isMultisend: t.boolean().default(false),
    decodedFunction: t.text(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.hash, table.chain] }),
    hashIdx: index().on(table.hash),
    chainIdx: index().on(table.chain),
    fromIdx: index().on(table.from),
    toIdx: index().on(table.to),
    timestampIdx: index().on(table.timestamp),
    blockNumberIdx: index().on(table.blockNumber),
  })
);

export const Transfer = onchainTable(
  "transfer",
  (t) => ({
    id: t.text().primaryKey(),
    chain: t.text().notNull(),
    hash: t.text().notNull(),
    from: t.text().notNull(),
    to: t.text().notNull(),
    value: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
  }),
  (table) => ({
    hashIdx: index().on(table.hash),
    chainIdx: index().on(table.chain),
    fromIdx: index().on(table.from),
    toIdx: index().on(table.to),
    timestampIdx: index().on(table.timestamp),
    blockNumberIdx: index().on(table.blockNumber),
  })
);

export const Log = onchainTable(
  "log",
  (t) => ({
    id: t.text(),
    chain: t.text().notNull(),
    transactionHash: t.text().notNull(),
    logIndex: t.integer().notNull(),
    address: t.text().notNull(),
    data: t.text().notNull(),
    topics: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    eventName: t.text(),
    decodedData: t.text(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.chain] }),
    txHashIdx: index().on(table.transactionHash),
    chainIdx: index().on(table.chain),
    addressIdx: index().on(table.address),
    blockNumberIdx: index().on(table.blockNumber),
    timestampIdx: index().on(table.timestamp),
    eventNameIdx: index().on(table.eventName),
  })
);

export const AgentTransaction = onchainTable(
  "agent_transaction",
  (t) => ({
    id: t.text().primaryKey(),
    agentId: t.text().notNull(),
    transactionHash: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    chain: t.text().notNull(),
  }),
  (table) => ({
    agentIdx: index().on(table.agentId),
    txHashIdx: index().on(table.transactionHash),
    timestampIdx: index().on(table.timestamp),
    chainIdx: index().on(table.chain),
    blockNumberIdx: index().on(table.blockNumber),
  })
);

export const AgentToTransaction = onchainTable(
  "agent_to_transaction",
  (t) => ({
    id: t.text().primaryKey(),
    agentInstanceId: t.text().notNull(),
    transactionHash: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    chain: t.text().notNull(),
  }),
  (table) => ({
    agentInstanceIdx: index().on(table.agentInstanceId),
    txHashIdx: index().on(table.transactionHash),
    timestampIdx: index().on(table.timestamp),
    chainIdx: index().on(table.chain),
    blockNumberIdx: index().on(table.blockNumber),
  })
);

export const AgentFromTransaction = onchainTable(
  "agent_from_transaction",
  (t) => ({
    id: t.text().primaryKey(),
    agentInstanceId: t.text().notNull(),
    transactionHash: t.text().notNull(),
    blockNumber: t.integer().notNull(),
    timestamp: t.integer().notNull(),
    chain: t.text().notNull(),
  }),
  (table) => ({
    agentInstanceIdx: index().on(table.agentInstanceId),
    txHashIdx: index().on(table.transactionHash),
    timestampIdx: index().on(table.timestamp),
    chainIdx: index().on(table.chain),
    blockNumberIdx: index().on(table.blockNumber),
  })
);

// ============================================================================
// RELATIONS
// ============================================================================

// Service Relations
export const ServiceRelations = relations(Service, ({ many }) => ({
  serviceAgents: many(ServiceAgent),
  stakingPositions: many(StakingPosition),
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

// Component Relations
export const ComponentRelations = relations(Component, ({ many }) => ({
  agentComponents: many(ComponentAgent),
  dependencies: many(ComponentDependency, { relationName: "component" }),
  dependents: many(ComponentDependency, { relationName: "dependency" }),
}));

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

// Transaction Relations
export const TransactionRelations = relations(Transaction, ({ many }) => ({
  logs: many(Log),
  transfers: many(Transfer),
}));

export const AgentTransactionRelations = relations(
  AgentTransaction,
  ({ one }) => ({
    agent: one(Agent, {
      fields: [AgentTransaction.agentId],
      references: [Agent.id],
    }),
    transaction: one(Transaction, {
      fields: [AgentTransaction.transactionHash],
      references: [Transaction.hash],
    }),
  })
);

export const AgentToTransactionRelations = relations(
  AgentToTransaction,
  ({ one }) => ({
    agentInstance: one(AgentInstance, {
      fields: [AgentToTransaction.agentInstanceId],
      references: [AgentInstance.id],
    }),
    transaction: one(Transaction, {
      fields: [AgentToTransaction.transactionHash],
      references: [Transaction.hash],
    }),
  })
);

export const AgentFromTransactionRelations = relations(
  AgentFromTransaction,
  ({ one }) => ({
    agentInstance: one(AgentInstance, {
      fields: [AgentFromTransaction.agentInstanceId],
      references: [AgentInstance.id],
    }),
    transaction: one(Transaction, {
      fields: [AgentFromTransaction.transactionHash],
      references: [Transaction.hash],
    }),
  })
);

export const LogRelations = relations(Log, ({ one }) => ({
  transaction: one(Transaction, {
    fields: [Log.transactionHash],
    references: [Transaction.hash],
  }),
}));

export const TransferRelations = relations(Transfer, ({ one }) => ({
  transaction: one(Transaction, {
    fields: [Transfer.hash],
    references: [Transaction.hash],
  }),
}));

// Add these relations
export const AgentRelations = relations(Agent, ({ many }) => ({
  instances: many(AgentInstance),
}));

export const AgentInstanceRelations = relations(AgentInstance, ({ one }) => ({
  agent: one(Agent, {
    fields: [AgentInstance.agentId],
    references: [Agent.id],
  }),
}));

export const StakingPositionRelations = relations(
  StakingPosition,
  ({ one }) => ({
    stakingInstance: one(StakingInstance, {
      fields: [StakingPosition.stakingInstanceId],
      references: [StakingInstance.id],
    }),
    service: one(Service, {
      fields: [StakingPosition.serviceId],
      references: [Service.id],
    }),
  })
);
