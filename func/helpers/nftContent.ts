import { beginCell, Cell, Slice } from '@ton/core';

export type NftContentParams = {
    uri?: string;
    [key: string]: any;
};

export function createNftContent(uri: string): Cell {
    return beginCell()
        .storeUint(1, 8)
        .storeStringTail(uri)
        .endCell();
}

export function createNumberNftContent(number: string, metadataUri?: string): Cell {
    if (metadataUri) {
        return createNftContent(metadataUri);
    }
    
    const uri = `https://api.example.com/nft/${number}/metadata.json`;
    return createNftContent(uri);
}

export function parseNftContent(cell: Cell): NftContentParams {
    const slice = cell.beginParse();
    const tag = slice.loadUint(8);

    if (tag === 1) {
        const uri = slice.loadStringTail();
        return { uri };
    } else if (tag === 0) {
        return {};
    } else {
        throw new Error(`Unsupported NFT content tag: ${tag}`);
    }
}