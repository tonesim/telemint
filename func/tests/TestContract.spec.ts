import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { Cell, toNano } from '@ton/core';
import { TestContract } from '../wrappers/TestContract';
import '@ton/test-utils';
import { compile } from '@ton/blueprint';

describe('TestContract', () => {
    let code: Cell;

    beforeAll(async () => {
        code = await compile('TestContract');
    });

    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let testContract: SandboxContract<TestContract>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        testContract = blockchain.openContract(TestContract.createFromConfig({}, code));

        deployer = await blockchain.treasury('deployer');

        const deployResult = await testContract.sendDeploy(deployer.getSender(), toNano('0.05'));

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: testContract.address,
            deploy: true,
            success: true,
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and testContract are ready to use
    });
});
