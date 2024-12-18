# AgentScan indexer

A [Ponder](https://ponder.sh) indexer for tracking agent and service contract events, as well as transactions on top of olas

The indexed data is exposed via a GraphQL API that can be queried to analyze Agent activity

# NOTE: you will need a RPC URL for the following chains for improved indexing speed:
mainnet,gnosis,base

most of these chains you can get from [Alchemy](https://www.alchemy.com/), as an alternative you can use [Quicknode](https://www.quicknode.com/)


### Local Development

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Create a `.env.local` file with your RPC URLs:
```
PONDER_RPC_URL_8453="..."
PONDER_RPC_URL_1="....
PONDER_RPC_URL_10="..."
```

4. Start the development server:
```bash
npm run dev
```

The GraphQL playground will be available at http://localhost:42069/graphql

## Deploy

Check out the ponder [deployment guide](https://ponder.sh/docs/production/deploy) for detailed instructions.

