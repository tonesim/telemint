import { beginCell, Cell, Slice } from '@ton/core';

export type NftContentParams = {
    name?: string;
    description?: string;
    image?: string;
    [key: string]: any; // Additional fields
};

/**
 * Creates NFT content in on-chain format (JSON in Cell)
 */
export function createNftContent(params: NftContentParams): Cell {
    const content = {
        name: params.name || '',
        description: params.description || '',
        image: params.image || '',
        ...params,
    };

    // Serialize JSON to Cell
    const jsonString = JSON.stringify(content);
    return beginCell()
        .storeUint(0, 8) // off-chain content tag
        .storeStringTail(jsonString)
        .endCell();
}

export function createNumberNftContent(number: string, metadata?: Record<string, any>): Cell {
    return createNftContent({
        name: `Number ${number}`,
        description: `Telegram number ${number}`,
        number,
        ...metadata,
    });
}

export function parseNftContent(cell: Cell): NftContentParams {
    const slice = cell.beginParse();

    // Read tag (first byte)
    const tag = slice.loadUint(8);

    // If tag = 0, this is off-chain content (JSON string)
    if (tag === 0) {
        // Read string (JSON)
        const jsonString = slice.loadStringTail();

        try {
            return JSON.parse(jsonString);
        } catch (e) {
            throw new Error(`Failed to parse NFT content JSON: ${e}`);
        }
    } else {
        // For other content types (on-chain) different logic is needed
        throw new Error(`Unsupported NFT content tag: ${tag}`);
    }
}

