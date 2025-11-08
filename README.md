# Telemint - Mint Numbers from Pool

Smart contracts for minting numbers from a pool on the TON blockchain.

## Description

This project contains a simplified version of Telemint contracts optimized for minting numbers from a predefined pool. DNS-free contracts are used to save gas.

## Project Structure

- `func/contracts/` - smart contract source code:
  - `nft-collection-no-dns.fc` - NFT collection without DNS
  - `nft-item-no-dns-cheap.fc` - cheap NFT item (0.03 TON instead of 1 TON)
  - `imports/` - common dependencies (common.fc, stdlib.fc)
- `func/wrappers/` - TypeScript wrappers for contracts:
  - `NftCollectionNoDns.ts` - collection wrapper
  - `NftItemNoDnsCheap.ts` - NFT item wrapper
- `func/helpers/` - helper functions for working with contracts:
  - `auctionConfig.ts` - auction configuration creation
  - `signMessage.ts` - message creation and signing
  - `nftContent.ts` - NFT content creation
  - `royaltyParams.ts` - royalty parameters creation
  - `restrictions.ts` - sender restrictions creation
- `func/examples/` - usage examples:
  - `backend-api.example.ts` - backend API example
  - `frontend-mint.example.ts` - frontend code example
- `func/tests/` - contract tests (see [test documentation](./docs/tests.md))
- `docs/` - project documentation:
  - [MINT_FLOW.md](./docs/MINT_FLOW.md) - detailed mint flow description
  - [tests.md](./docs/tests.md) - test documentation

## Contracts Used

- **NftCollectionNoDns** - NFT collection without DNS. Used for creating and managing NFT numbers.
- **NftItemNoDnsCheap** - Cheap NFT item without DNS. Requires only 0.03 TON for storage (instead of 1 TON in the standard version).

**Important:** The contract activates only after receiving the first message from the collection (during mint). After activation, data can be retrieved through get-methods:

```typescript
const nftData = await nft.getNftData();
if (nftData.init && nftData.content) {
    const parsedContent = parseNftContent(nftData.content);
    // Use parsedContent
}
```

For more details on contract activation, see [MINT_FLOW.md](./docs/MINT_FLOW.md#nft-item-contract-activation).

## Mint Flow

1. User goes to the backend and clicks "Get Number"
2. Backend generates an available number from the pool
3. Backend forms the payload and signs the message
4. User receives the signed message
5. User sends the transaction to the blockchain
6. Contract mints NFT and sends it to the user

For detailed flow description, see [docs/MINT_FLOW.md](./docs/MINT_FLOW.md).

## Quick Start

### Installing Dependencies

```bash
cd func
npm install
```

### Building Contracts

```bash
npm run build
```

### Testing

```bash
npm test
```

For more details on tests, see [test documentation](./docs/tests.md).

### Usage Examples

Code examples are located in `func/examples/`:
- `backend-api.example.ts` - how to create a backend API for generating signed messages
- `frontend-mint.example.ts` - how to send a mint transaction from the frontend

For detailed flow description, see [docs/MINT_FLOW.md](./docs/MINT_FLOW.md).

## Documentation

- [Mint Flow](./docs/MINT_FLOW.md) - detailed description of the number minting process from the pool
- [Tests](./docs/tests.md) - test description and functionality coverage

## Helper Functions

All helper functions are exported from `func/helpers/index.ts`:

```typescript
import {
    createDirectMintAuctionConfig,
    createNumberNftContent,
    createUnsignedDeployMessageV2,
    signDeployMessage,
    createSignedDeployMessageV2,
} from './helpers';
```

For more details, see documentation in helper function files and [MINT_FLOW.md](./docs/MINT_FLOW.md#using-helper-functions).

## License

See [LICENSE](./LICENSE)
