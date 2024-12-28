import { createConfig, factory, loadBalance } from "ponder";
import { getAbiItem, http, parseAbiItem } from "viem";

import { ServiceRegistryABI } from "./abis/ServiceRegistryABI";
import { AgentRegistryABI } from "./abis/AgentRegistry";
import { ComponentRegistryABI } from "./abis/ComponentRegistry";

export default createConfig({
  networks: {
    mainnet: {
      chainId: 1,
      transport: http(process.env.PONDER_RPC_URL_1),
      pollingInterval: 2_000,
    },
    polygon: {
      chainId: 137,
      transport: http(process.env.PONDER_RPC_URL_137),
      pollingInterval: 2_000,
    },
    gnosis: {
      chainId: 100,
      transport: loadBalance([http(process.env.PONDER_RPC_URL_100)]),
      pollingInterval: 2_000,
    },
    arbitrum: {
      chainId: 42161,
      transport: http(process.env.PONDER_RPC_URL_42161),
      pollingInterval: 2_000,
    },
    optimism: {
      chainId: 10,
      transport: http(process.env.PONDER_RPC_URL_10),
      pollingInterval: 2_000,
    },
    base: {
      chainId: 8453,
      transport: http(process.env.PONDER_RPC_URL_8453),
      pollingInterval: 2_000,
    },
  },

  contracts: {
    MainnetStaking: {
      network: "mainnet",
      abi: ServiceRegistryABI,
      address: "0x48b6af7B12C71f09e2fC8aF4855De4Ff54e775cA",
      startBlock: 15178299,
    },
    PolygonRegistry: {
      network: "polygon",
      abi: ServiceRegistryABI,
      address: "0xE3607b00E75f6405248323A9417ff6b39B244b50",
      startBlock: 41783952,
    },
    GnosisRegistry: {
      network: "gnosis",
      abi: ServiceRegistryABI,
      address: "0x9338b5153AE39BB89f50468E608eD9d764B755fD",
      startBlock: 27871084,
    },
    ArbitrumRegistry: {
      network: "arbitrum",
      abi: ServiceRegistryABI,
      address: "0xE3607b00E75f6405248323A9417ff6b39B244b50",
      startBlock: 174008819,
    },
    OptimismRegistry: {
      network: "optimism",
      abi: ServiceRegistryABI,
      address: "0x3d77596beb0f130a4415df3D2D8232B3d3D31e44",
      startBlock: 116423039,
    },
    BaseRegistry: {
      network: "base",
      abi: ServiceRegistryABI,
      address: "0x3C1fF68f5aa342D296d4DEe4Bb1cACCA912D95fE",
      startBlock: 10827380,
    },
    MainnetAgentRegistry: {
      network: "mainnet",
      abi: AgentRegistryABI,
      address: "0x2F1f7D38e4772884b88f3eCd8B6b9faCdC319112",
      startBlock: 15178299,
    },
    MainnetComponentRegistry: {
      network: "mainnet",
      abi: ComponentRegistryABI,
      address: "0x15bd56669F57192a97dF41A2aa8f4403e9491776",
      startBlock: 15178253,
    },
  },
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
});
