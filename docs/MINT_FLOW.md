# Mint Flow for Numbers from Pool

This document describes the complete flow for minting numbers from a pool using `NftCollectionNoDns` and `NftItemNoDnsCheap` contracts.

> 📚 See also: [README](../README.md) | [Test Documentation](./tests.md)

## Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Frontend  │────────▶│   Backend    │────────▶│  Blockchain │
│  (User)     │◀────────│  (API)       │◀────────│  (Contract) │
└─────────────┘         └──────────────┘         └─────────────┘
```

## Important Notes on NFT Item Operations

### NFT Item Contract Activation

The NFT item contract activates only after receiving the first message from the collection. This happens as follows:

1. **During mint**: Collection sends an internal message to NFT item with operation `op::teleitem_msg_deploy`
2. **Activation**: NFT item receives this message and saves state (contract data)
3. **Availability**: Only after activation can get-methods be called on the contract

**In production network:**
- Contract activates synchronously in the same transaction as mint
- Data is available immediately after transaction confirmation

**In sandbox/tests:**
- Additional time may be required for message processing
- It's recommended to use try-catch or check the `init` flag from `get_nft_data()`

**Example of retrieving NFT item data:**

```typescript
const nft = blockchain.openContract(NftItemNoDnsCheap.createFromAddress(nftAddress));

try {
    const nftData = await nft.getNftData();
    
    // Check that contract is activated
    if (nftData.init && nftData.content) {
        // Parse content from Cell
        const parsedContent = parseNftContent(nftData.content);
        console.log('NFT Content:', parsedContent);
    }
} catch (e) {
    // Contract not yet activated - this is normal
    // In production, wait for transaction confirmation
}
```

## Flow Steps

### 1. User Clicks "Get Number"

User goes to the frontend and clicks the "Get Number" button.

### 2. Backend Generates Available Number

Backend checks the pool of available numbers and selects a free number. The number is reserved for the signature validity period.

**Example:**
```typescript
const number = getAvailableNumber(); // "123456"
```

### 3. Backend Forms Payload

Backend creates:
- NFT content (number metadata)
- Auction config (for direct mint without auction)
- Royalty params (royalty parameters)
- Restrictions (sender restrictions, optional)

**Example:**
```typescript
const nftContent = createNumberNftContent(number);
const auctionConfig = createDirectMintAuctionConfig({
    beneficiaryAddress: BENEFICIARY_ADDRESS,
    mintPrice: toNano('0.1'),
});
const royaltyParams = createNoRoyaltyParams(BENEFICIARY_ADDRESS);
const restrictions = createRestrictions({
    forceSenderAddress: userAddress, // Only this user can mint
});
```

### 4. Backend Creates Unsigned Deploy Message

Backend forms unsigned deploy message v2 with parameters:
- `subwalletId` - Collection subwallet ID
- `validSince` - Signature validity start
- `validTill` - Signature validity end
- `tokenName` - Number from pool
- `content` - NFT content
- `auctionConfig` - Auction configuration
- `royaltyParams` - Royalty parameters
- `restrictions` - Restrictions

**Example:**
```typescript
const unsignedMessage = createUnsignedDeployMessageV2({
    subwalletId: 0,
    validSince: now - 60,
    validTill: now + 3600,
    tokenName: number,
    content: nftContent,
    auctionConfig,
    royaltyParams,
    restrictions,
});
```

### 5. Backend Signs Message

Backend signs the hash of the unsigned message with the collection's private key.

**Example:**
```typescript
const signature = signDeployMessage(unsignedMessage, privateKey);
const signedMessage = createSignedDeployMessageV2(unsignedMessage, signature);
```

### 6. Backend Sends Signed Message to User

Backend returns to the user:
- Signed message (hex)
- Number
- Mint price
- Signature validity time

**API Response:**
```json
{
  "signedMessage": "hex...",
  "tokenName": "123456",
  "mintPrice": "100000000",
  "validTill": 1234567890
}
```

### 7. User Sends Transaction

Frontend sends transaction to blockchain:
- Recipient address: collection address
- Amount: mint price
- Body: signed message

**Example:**
```typescript
await wallet.send({
    to: COLLECTION_ADDRESS,
    value: BigInt(mintPrice),
    body: signedMessage,
});
```

### 8. Contract Mints NFT

The `NftCollectionNoDns` contract:
1. Verifies signature
2. Checks validity time window
3. Checks restrictions (if any)
4. Checks that amount >= initial_min_bid
5. Creates NFT item contract
6. Starts auction (which immediately completes, as max_bid = initial_min_bid)
7. Transfers NFT to user

### 9. Mint Confirmation and NFT Data Retrieval

After successful transaction, frontend sends confirmation to backend, which marks the number as minted.

**Important:** NFT item contract activates in the same transaction as mint. After transaction confirmation, NFT data can be retrieved through contract get-methods.

**Example of retrieving NFT data after mint:**

```typescript
// After mint transaction confirmation
import { parseNftContent } from './helpers/nftContent';

const itemIndex = await stringHash(tokenName);
const nftAddress = await collection.getNftAddressByIndex(itemIndex);
const nft = client.open(NftItemNoDnsCheap.createFromAddress(nftAddress));

// Get NFT data
try {
    const nftData = await nft.getNftData();
    
    // Check that contract is activated
    if (nftData.init && nftData.content) {
        // Parse content from Cell
        const parsedContent = parseNftContent(nftData.content);
        console.log('NFT Number:', parsedContent.number);
        console.log('NFT Name:', parsedContent.name);
        
        // Get token name directly
        const tokenName = await nft.getTelemintTokenName();
        console.log('Token Name:', tokenName);
    } else {
        // Contract not yet activated - wait for transaction confirmation
        console.log('NFT item not yet initialized');
    }
} catch (e) {
    // In sandbox, contract may not be activated yet
    // In production, wait for transaction confirmation and retry
    console.log('NFT item not yet activated');
}
```

**Recommendations:**
1. Wait for mint transaction confirmation (usually 1-2 seconds)
2. Check the `init` flag from `get_nft_data()` before using data
3. Use try-catch to handle cases when contract is not yet activated
4. In production, you can use transaction events to track activation

## Using Helper Functions

### Creating Auction Config for Direct Mint

```typescript
import { createDirectMintAuctionConfig } from './helpers/auctionConfig';
import { Address, toNano } from '@ton/core';

const auctionConfig = createDirectMintAuctionConfig({
    beneficiaryAddress: Address.parse('EQ...'),
    mintPrice: toNano('0.1'), // 0.1 TON
});
```

### Creating NFT Content

```typescript
import { createNumberNftContent } from './helpers/nftContent';

const nftContent = createNumberNftContent('123456', {
    customField: 'value',
});
```

### Creating Signed Message

```typescript
import {
    createUnsignedDeployMessageV2,
    signDeployMessage,
    createSignedDeployMessageV2,
} from './helpers/signMessage';

const unsignedMessage = createUnsignedDeployMessageV2({
    subwalletId: 0,
    validSince: Math.floor(Date.now() / 1000) - 60,
    validTill: Math.floor(Date.now() / 1000) + 3600,
    tokenName: '123456',
    content: nftContent,
    auctionConfig,
    royaltyParams,
    restrictions,
});

const signature = signDeployMessage(unsignedMessage, privateKey);
const signedMessage = createSignedDeployMessageV2(unsignedMessage, signature);
```

## Security

### Important Points:

1. **Private key** must be stored in a secure location (env variables, secrets manager)
2. **Signature validity** should be time-limited (recommended: 1 hour)
3. **Restrictions** allow limiting who can use the signature
4. **Number pool** should be checked for duplicates
5. **Mint confirmation** should only occur after verifying the transaction on blockchain

## Code Examples

Full code examples are located in:
- `../func/examples/backend-api.example.ts` - backend API example
- `../func/examples/frontend-mint.example.ts` - frontend code example

For more details on tests, see [test documentation](./tests.md).

## Contract Configuration

To deploy the collection, use:

```typescript
import { NftCollectionNoDns } from './wrappers/NftCollectionNoDns';
import { compile } from '@ton/blueprint';

const collectionCode = await compile('NftCollectionNoDns');
const itemCode = await compile('NftItemNoDnsCheap');

const collection = NftCollectionNoDns.createFromConfig({
    touched: false,
    subwalletId: 0,
    publicKey: publicKey,
    collectionContent: collectionContentCell,
    nftItemCode: itemCode,
    fullDomain: 'yourdomain.ton',
    royaltyParams: royaltyParamsCell,
}, collectionCode);
```

## Minimum Mint Price

For `NftItemNoDnsCheap`, minimum mint price:
- `cheap_min_tons_for_storage = 0.03 TON`
- `cheap_minting_price = 0.03 TON`
- **Total minimum: 0.06 TON** (recommended 0.1 TON for fees)

## Troubleshooting

### Error "invalid signature"
- Check that the correct private key is used
- Check that signature is created for the correct message

### Error "expired signature"
- Check that `validTill` > current time
- Increase signature validity window

### Error "not_enough_funds"
- Check that transaction amount >= `initial_min_bid`
- Account for network fees

### Error "invalid_sender_address"
- Check restrictions - possibly `forceSenderAddress` is specified
- Ensure transaction is sent from the correct address
