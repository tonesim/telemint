#!/usr/bin/env node
/**
 * Complete Production Verification Script
 * 
 * This script runs all verification checks:
 * 1. Basic production checks
 * 2. Full suite verification
 * 3. Contract deployment verification
 * 4. NFT minting verification
 * 
 * Usage:
 *   npm run verify:all
 *   or
 *   ts-node scripts/verifyAll.ts
 */

// Load environment variables from .env file
try {
    require('dotenv').config();
} catch (e) {
    // dotenv is optional, continue without it
}

import { spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message: string) {
    log(`✓ ${message}`, 'green');
}

function logError(message: string) {
    log(`✗ ${message}`, 'red');
}

function logInfo(message: string) {
    log(`ℹ ${message}`, 'blue');
}

function logSection(title: string) {
    log(`\n${'='.repeat(60)}`, 'cyan');
    log(`  ${title}`, 'cyan');
    log(`${'='.repeat(60)}\n`, 'cyan');
}

function runScript(scriptPath: string, args: string[] = []): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
        const scriptsDir = path.join(__dirname);
        const scriptFullPath = path.join(scriptsDir, scriptPath);
        
        // Check if script exists
        if (!fs.existsSync(scriptFullPath)) {
            resolve({ success: false, output: `Script not found: ${scriptPath}` });
            return;
        }

        logInfo(`Running: ${scriptPath} ${args.join(' ')}`);
        
        const child = spawn('npx', ['ts-node', scriptFullPath, ...args], {
            cwd: path.join(__dirname, '..'),
            stdio: ['inherit', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        let output = '';
        let errorOutput = '';

        child.stdout?.on('data', (data) => {
            const text = data.toString();
            output += text;
            process.stdout.write(text);
        });

        child.stderr?.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            process.stderr.write(text);
        });

        child.on('close', (code) => {
            const success = code === 0;
            resolve({
                success,
                output: output + errorOutput,
            });
        });

        child.on('error', (error) => {
            resolve({
                success: false,
                output: `Error running script: ${error.message}`,
            });
        });
    });
}

async function main() {
    log('\n' + '='.repeat(60), 'cyan');
    log('  COMPLETE PRODUCTION VERIFICATION', 'cyan');
    log('='.repeat(60) + '\n', 'cyan');

    const results: { name: string; success: boolean; output?: string }[] = [];

    // Check 1: Basic Production Verification
    logSection('1. Basic Production Verification');
    const basicCheck = await runScript('checkProduction.ts');
    results.push({
        name: 'Basic Production Check',
        success: basicCheck.success,
        output: basicCheck.output,
    });

    // Small delay between checks
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check 2: Full Suite Verification
    logSection('2. Full Suite Verification');
    const fullSuiteCheck = await runScript('checkFullSuite.ts');
    results.push({
        name: 'Full Suite Check',
        success: fullSuiteCheck.success,
        output: fullSuiteCheck.output,
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check 3: Contract Deployment Verification
    logSection('3. Contract Deployment Verification');
    const deploymentCheck = await runScript('checkDeployment.ts');
    results.push({
        name: 'Deployment Check',
        success: deploymentCheck.success,
        output: deploymentCheck.output,
    });

    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check 4: NFT Minting Verification
    logSection('4. NFT Minting Verification');
    const mintingCheck = await runScript('verifyMinting.ts');
    results.push({
        name: 'Minting Verification',
        success: mintingCheck.success,
        output: mintingCheck.output,
    });

    // Final Summary
    logSection('FINAL SUMMARY');
    
    const passed = results.filter(r => r.success).length;
    const total = results.length;
    
    results.forEach((result, index) => {
        log(`\n${index + 1}. ${result.name}:`, 'cyan');
        if (result.success) {
            logSuccess('  PASSED');
        } else {
            logError('  FAILED');
            if (result.output) {
                const errorLines = result.output.split('\n').filter(line => 
                    line.includes('✗') || line.includes('FAILED') || line.includes('Error')
                ).slice(0, 3);
                if (errorLines.length > 0) {
                    logError(`  ${errorLines.join('\n  ')}`);
                }
            }
        }
    });
    
    log(`\n${'='.repeat(60)}`, 'cyan');
    log(`Total: ${passed}/${total} checks passed`, passed === total ? 'green' : 'yellow');
    log('='.repeat(60) + '\n', 'cyan');
    
    if (passed === total) {
        logSuccess('✓ All verification checks passed! Production is ready.');
        log('\nNext steps:', 'cyan');
        log('  1. Your contracts are deployed and working correctly', 'blue');
        log('  2. All helper functions work as expected', 'blue');
        log('  3. Minting payload can be created and validated', 'blue');
        log('  4. NFT data can be read after minting', 'blue');
        log('\nYou can now proceed with minting NFTs in production!', 'green');
        process.exit(0);
    } else {
        logError('✗ Some verification checks failed.');
        log('\nPlease review the errors above and fix any issues.', 'yellow');
        process.exit(1);
    }
}

main().catch(error => {
    logError(`Unexpected error: ${error.message}`);
    console.error(error);
    process.exit(1);
});

