import { createRequire } from 'module';
import * as clientMod from '@mysten/sui/client';

const require = createRequire(import.meta.url);

/**
 * Cetus SDK Compatibility Layer
 *
 * Cetus CLMM SDK v5 was compiled expecting CommonJS exports `SuiClient` and `getFullnodeUrl`
 * from `@mysten/sui/client`. Under modern `@mysten/sui` v2 (pure ESM), those were refactored.
 * This hook dynamically provides `CoreClient` as `SuiClient` and `getFullnodeUrl` to the module loader
 * when Cetus is imported, ensuring 100% interoperability without patching node_modules on disk.
 */
let isCompatInitialized = false;

export function ensureCetusCompat(): void {
  if (isCompatInitialized) return;

  try {
    const Module = require('module');
    const origRequire = Module.prototype.require;

    function getFullnodeUrl(network: string): string {
      switch (network) {
        case 'mainnet':
          return 'https://fullnode.mainnet.sui.io:443';
        case 'testnet':
          return 'https://fullnode.testnet.sui.io:443';
        case 'devnet':
          return 'https://fullnode.devnet.sui.io:443';
        case 'localnet':
          return 'http://127.0.0.1:9000';
        default:
          return 'https://fullnode.mainnet.sui.io:443';
      }
    }

    Module.prototype.require = function (id: string) {
      if (id === '@mysten/sui/client') {
        return {
          ...clientMod,
          SuiClient: clientMod.CoreClient,
          getFullnodeUrl,
        };
      }
      return origRequire.apply(this, arguments as unknown as [string]);
    };

    isCompatInitialized = true;
  } catch (err) {
    console.warn('[CetusCompat] Warning: Could not install module hook:', err);
  }
}
