import { beginCell, Cell, Slice } from '@ton/core';

export type NftContentParams = {
    uri?: string; // URI pointing to JSON metadata
    [key: string]: any; // Additional fields for backward compatibility
};

/**
 * Creates NFT content in off-chain format according to TEP-64
 * Format: offchain#01 uri:Text
 * This stores a URI pointing to JSON metadata, not the JSON itself
 * 
 * @param uri - URI string pointing to JSON metadata (e.g., "https://example.com/metadata/123.json")
 */
export function createNftContent(uri: string): Cell {
    return beginCell()
        .storeUint(1, 8) // offchain#01 tag
        .storeStringTail(uri) // URI string
        .endCell();
}

/**
 * Creates NFT content for a phone number
 * Generates a URI pointing to metadata JSON
 * 
 * @param number - Phone number
 * @param metadataUri - Optional custom URI. If not provided, generates a default URI
 */
export function createNumberNftContent(number: string, metadataUri?: string): Cell {
    // If URI is provided, use it directly
    if (metadataUri) {
        return createNftContent(metadataUri);
    }
    
    // Otherwise, generate a default URI pattern
    // In production, this should point to your actual metadata server
    const uri = `https://api.example.com/nft/${number}/metadata.json`;
    return createNftContent(uri);
}

/**
 * Parses NFT content according to TEP-64
 * Currently supports off-chain format (tag 0x01)
 * For on-chain format (tag 0x00), returns empty object (backward compatibility)
 * 
 * @param cell - Cell containing NFT content
 * @returns Object with URI field pointing to JSON metadata
 */
export function parseNftContent(cell: Cell): NftContentParams {
    const slice = cell.beginParse();

    // Read tag (first byte)
    const tag = slice.loadUint(8);

    if (tag === 1) {
        // Off-chain content: offchain#01 uri:Text
        const uri = slice.loadStringTail();
        // Return URI - caller should fetch JSON from this URI
        return { uri };
    } else if (tag === 0) {
        // On-chain content: onchain#00 (not supported in current implementation)
        // Return empty object for backward compatibility
        return {};
    } else {
        throw new Error(`Unsupported NFT content tag: ${tag}`);
    }
}

