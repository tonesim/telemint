# Contract Tests

This document describes tests for the project's smart contracts.

> 📚 See also: [README](../README.md) | [Mint Flow](./MINT_FLOW.md)

## Test Structure

- `../func/tests/NftCollectionNoDns.spec.ts` - tests for NFT collection
- `../func/tests/NftItemNoDnsCheap.spec.ts` - tests for NFT item

## Running Tests

```bash
npm test
```

## Tests for NftCollectionNoDns

- ✅ Collection deployment
- ✅ Collection balance top-up
- ✅ NFT mint with signed message
- ✅ Reject mint with invalid signature
- ✅ Reject mint with insufficient funds
- ✅ Reject mint with expired signature
- ✅ Reject mint with not yet valid signature
- ✅ Reject mint with wrong subwallet_id
- ✅ Mint NFT with restrictions (force_sender_address)
- ✅ Reject mint with restrictions from wrong address
- ✅ Verify that same tokenName returns same address
- ✅ Reject top-up without correct comment
- ✅ Get collection data
- ✅ Get NFT address by index

## Tests for NftItemNoDnsCheap

### Deployment and Data Retrieval
- ✅ Deploy NFT item through collection
- ✅ Return zero address for owner when contract not activated
- ✅ Get NFT data after activation
- ✅ Get token name
- ✅ Get auction config
- ✅ Get royalty params
- ✅ Parse NFT content from Cell

### Auction Operations
- ✅ Get auction state
- ✅ Place bid on auction
- ✅ Reject bid below minimum
- ✅ Outbid previous bidder
- ✅ Owner cancels auction without bids
- ✅ Reject cancel auction by non-owner
- ✅ Reject cancel auction with existing bids
- ✅ Complete auction when max bid is reached

### Transfer Operations
- ✅ Owner transfers NFT
- ✅ Reject transfer by non-owner
- ✅ Reject transfer when auction is active

### Top-up Operations
- ✅ Owner tops up balance
- ✅ Reject top-up by non-owner

### Start Auction Operations
- ✅ Owner starts new auction
- ✅ Reject start auction by non-owner
- ✅ Reject invalid auction config

### Royalty Operations
- ✅ Get royalty params with non-zero values

### Edge Cases
- ✅ Handle bounced messages gracefully
- ✅ Handle empty message body
- ✅ Handle unknown operation code

## Using Helper Functions

Tests use helper functions from `../func/helpers/`:
- `createDirectMintAuctionConfig` - create auction config for direct mint
- `createAuctionConfig` - create auction config with parameters
- `createNumberNftContent` - create NFT content for number
- `parseNftContent` - parse NFT content from Cell
- `createNoRoyaltyParams` - create royalty params without royalty
- `createRoyaltyParams` - create royalty params with specified values
- `createUnsignedDeployMessageV2` - create unsigned deploy message
- `signDeployMessage` - sign deploy message

For more details on helper functions, see [MINT_FLOW.md](./MINT_FLOW.md#using-helper-functions).

## Test Structure

All tests follow principles from `.cursor/rules`:
- **AAA structure** (Arrange-Act-Assert) - each test has a clear structure
- **One purpose per test** - each test checks one specific functionality
- **Determinism** - deterministic keys are used for signing
- **Independence** - each test creates its own blockchain in beforeEach
- **Edge case coverage** - tests check errors, invariants, and boundary conditions
- **Clear names** - all tests follow the format `should <expectation>`
