import { createConfig, factory, loadBalance } from "ponder";
import { getAbiItem, http, parseAbiItem } from "viem";

import { ServiceRegistryABI } from "./abis/ServiceRegistryABI";
import { AgentRegistryABI } from "./abis/AgentRegistry";
import { ComponentRegistryABI } from "./abis/ComponentRegistry";
import { StakingFactoryABI } from "./abis/StakingFactoryABI";
import { StakingTokenAbi } from "./abis/StakingToken";

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
    StakingFactoryContracts: {
      abi: StakingFactoryABI,
      network: {
        mainnet: {
          address: "0xEBdde456EA288b49f7D5975E7659bA1Ccf607efc",
          startBlock: 20342524,
        },
        polygon: {
          address: "0x46C0D07F55d4F9B5Eed2Fc9680B5953e5fd7b461",
          startBlock: 59560456,
        },
        gnosis: {
          address: "0xb0228CA253A88Bc8eb4ca70BCAC8f87b381f4700",
          startBlock: 35047282,
        },
        arbitrum: {
          address: "0xEB5638eefE289691EcE01943f768EDBF96258a80",
          startBlock: 233883523,
        },
        optimism: {
          address: "0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8",
          startBlock: 122903952,
        },
        base: {
          address: "0x1cEe30D08943EB58EFF84DD1AB44a6ee6FEff63a",
          startBlock: 17310019,
        },
      },
    },
    StakingContracts: {
      abi: StakingTokenAbi,
      network: {
        mainnet: {
          address: factory({
            address: "0xEBdde456EA288b49f7D5975E7659bA1Ccf607efc",
            event: getAbiItem({
              abi: StakingFactoryABI,
              name: "InstanceCreated",
            }),
            parameter: "instance",
          }),
          startBlock: 20342524,
        },
        polygon: {
          address: factory({
            address: "0x46C0D07F55d4F9B5Eed2Fc9680B5953e5fd7b461",
            event: getAbiItem({
              abi: StakingFactoryABI,
              name: "InstanceCreated",
            }),
            parameter: "instance",
          }),
          startBlock: 59560456,
        },
        gnosis: {
          address: factory({
            address: "0xb0228CA253A88Bc8eb4ca70BCAC8f87b381f4700",
            event: getAbiItem({
              abi: StakingFactoryABI,
              name: "InstanceCreated",
            }),
            parameter: "instance",
          }),
          startBlock: 35047282,
        },
        arbitrum: {
          address: factory({
            address: "0xEB5638eefE289691EcE01943f768EDBF96258a80",
            event: getAbiItem({
              abi: StakingFactoryABI,
              name: "InstanceCreated",
            }),
            parameter: "instance",
          }),
          startBlock: 233883523,
        },
        optimism: {
          address: factory({
            address: "0xa45E64d13A30a51b91ae0eb182e88a40e9b18eD8",
            event: getAbiItem({
              abi: StakingFactoryABI,
              name: "InstanceCreated",
            }),
            parameter: "instance",
          }),
          startBlock: 122903952,
        },
        base: {
          address: factory({
            address: "0x1cEe30D08943EB58EFF84DD1AB44a6ee6FEff63a",
            event: getAbiItem({
              abi: StakingFactoryABI,
              name: "InstanceCreated",
            }),
            parameter: "instance",
          }),
          startBlock: 17310019,
        },
      },
    },
  },
  database: {
    kind: "postgres",
    connectionString: process.env.DATABASE_URL,
  },
});
