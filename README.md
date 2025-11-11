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
- `func/scripts/` - utility scripts:
  - `checkProduction.ts` - basic production verification script
  - `checkFullSuite.ts` - comprehensive verification script (all functionality)
- `func/tests/` - contract tests (see [test documentation](./docs/tests.md))
- `docs/` - project documentation:
  - [MINT_FLOW.md](./docs/MINT_FLOW.md) - detailed mint flow description
  - [tests.md](./docs/tests.md) - test documentation
  - [PRODUCTION_VERIFICATION.md](./docs/PRODUCTION_VERIFICATION.md) - production verification guide

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

### Production Verification

**Quick verification (all checks):**
```bash
cd func
npm run verify
```

This single command runs all verification checks:
- Basic production verification
- Full suite verification (all helper functions)
- Contract deployment verification
- NFT minting verification

**Individual checks:**
```bash
# Basic verification
npx ts-node scripts/checkProduction.ts

# Comprehensive verification
npx ts-node scripts/checkFullSuite.ts

# Deployment verification
npx ts-node scripts/checkDeployment.ts

# Minting verification
npx ts-node scripts/verifyMinting.ts [tokenName]
```

For detailed instructions, see [Production Verification Guide](./docs/PRODUCTION_VERIFICATION.md).

### Production Minting

**Minting NFT in Production:**

Before minting, make sure you have:
1. Collection contract deployed and verified
2. All environment variables configured in `.env` file
3. Sufficient wallet balance (mint price + gas fees)

**Required Environment Variables:**

```bash
# TON Network
TON_ENDPOINT=https://toncenter.com/api/v2/jsonRPC
TON_API_KEY=your_api_key_here  # Optional but recommended

# Collection Configuration
COLLECTION_ADDRESS=EQ...  # Your collection address
COLLECTION_PUBLIC_KEY=hex_public_key
COLLECTION_PRIVATE_KEY=hex_private_key

# Minting Configuration
BENEFICIARY_ADDRESS=EQ...  # Address to receive mint proceeds
MINT_PRICE=0.1  # Mint price in TON
SUBWALLET_ID=0  # Collection subwallet ID (usually 0)

# Wallet (for sending transactions)
MNEMONIC="word1 word2 ... word24"  # 24-word mnemonic phrase
```

**Minting NFT:**

```bash
cd func

# Mint with auto-generated token name
npx ts-node scripts/mintNft.ts

# Mint with custom token name
npx ts-node scripts/mintNft.ts my_custom_token_name
```

**What the script does:**

1. **Creates minting payload** - Generates NFT content, auction config, royalty params, and restrictions
2. **Signs the message** - Signs the deploy message with collection private key
3. **Sends transaction** - Uses `sendDeployMessageV2` method from wrapper (correct format, fixes exit code 9)
4. **Waits for confirmation** - Monitors wallet seqno to confirm transaction
5. **Verifies NFT** - Checks that NFT was created and activated correctly

**Transaction Format:**

The script uses `sendDeployMessageV2` from the collection wrapper, which formats the message correctly:
- Op code: `0x4637289b` (telemint_msg_deploy_v2)
- Signature: 64 bytes
- Subwallet ID
- Valid since/till timestamps
- Command as slice (not ref)

This ensures compatibility with the contract and prevents exit code 9 errors.

**Verification:**

After minting, the script automatically verifies:
- NFT contract is deployed and active
- NFT index matches expected value
- Collection address is correct
- Owner address is set
- Token name matches
- Auction config is accessible
- Royalty params are accessible

**Troubleshooting:**

- **Rate limit errors**: If you see 429 errors, wait a few minutes and try again. Consider using an API key for higher limits.
- **Insufficient balance**: Make sure wallet has enough TON (mint price + ~0.05 TON for fees)
- **Transaction timeout**: If confirmation times out, check the transaction manually on blockchain explorer
- **Exit code 9**: This should not happen with the updated script. If it does, verify you're using the latest version.

**Example Output:**

```
=== E2E NFT Minting in Mainnet ===

✓ Configuration loaded
ℹ Collection address: EQCeTZFtmvZIruJBIi4E0H1oh9w2zrcLDMVd_6bwVah2mPN4
ℹ Token name: test_mint_1234567890

=== Creating Minting Payload ===
✓ Minting payload created
ℹ NFT address: EQChuHK-D8YALPXllxblxkURchqtz8JCdEvBA_aPPvdcTb_x

=== Sending Mint Transaction ===
✓ Balance is sufficient
ℹ Current seqno: 38
✓ Transaction sent! Waiting for confirmation...
✓ Transaction confirmed! New seqno: 39

=== Verifying NFT After Mint ===
✓ NFT contract is deployed (state: active)
✓ NFT is activated
✓ Index matches
✓ Collection address matches
✓ Owner: EQCgSOFgNrUF3ynr_-TppXlFPAcWSG3OlDHG2LvdgwHk2M1S
✓ Token name: test_mint_1234567890
✓ Token name matches
✓ Auction config retrieved
✓ Royalty params retrieved

✓ NFT minted successfully and verified!
ℹ NFT address: EQChuHK-D8YALPXllxblxkURchqtz8JCdEvBA_aPPvdcTb_x
ℹ Token name: test_mint_1234567890
```

### Usage Examples

Code examples are located in `func/examples/`:
- `backend-api.example.ts` - how to create a backend API for generating signed messages
- `frontend-mint.example.ts` - how to send a mint transaction from the frontend

For detailed flow description, see [docs/MINT_FLOW.md](./docs/MINT_FLOW.md).

## Documentation

- [Mint Flow](./docs/MINT_FLOW.md) - detailed description of the number minting process from the pool
- [Tests](./docs/tests.md) - test description and functionality coverage
- [Production Verification](./docs/PRODUCTION_VERIFICATION.md) - guide for verifying production deployment

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
