/**
 * Protocol Shared Object IDs, Packages, and Addresses on Sui Mainnet
 */

export const SUI_CLOCK_OBJECT_ID = '0x0000000000000000000000000000000000000000000000000000000000000006';
export const SUI_SYSTEM_STATE_OBJECT_ID = '0x0000000000000000000000000000000000000000000000000000000000000005';

// NAVI Protocol Mainnet Configuration
export const NAVI_CONFIG = {
  packageId: '0x512f28261c1a293f49416d8885b8d5d32bde6dd68a99a0be36fe42b248e6833a',
  priceOracle: '0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef',
  storage: '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe',
  incentiveV2: '0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c',
  incentiveV3: '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80',
  flashloanConfig: '0x3672b2bf471a60c30a03325f104f92fb195c9d337ba58072dce764fe2aa5e2dc',
  flashloanSupportedAssets: '0x6c8fc404b4f22443302bbcc50ee593e5b898cc1e6755d72af0a6aab5a7a6f6d3',
};

// Official NAVI Open API Endpoints (per NAVI developer docs)
export const NAVI_API_ENDPOINTS = {
  package: 'https://open-api.naviprotocol.io/api/package',
  pools: 'https://open-api.naviprotocol.io/api/navi/pools',
  contractConfigs: 'https://open-api.naviprotocol.io/api/navi/contract/configs',
  flashloan: 'https://open-api.naviprotocol.io/api/navi/flashloan',
  oracle: 'https://open-api.naviprotocol.io/api/navi/oracle',
} as const;

// Scallop Protocol Mainnet Configuration
export const SCALLOP_CONFIG = {
  addressId: '695fcdc084f790c04eb068dc',
  market: '0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9',
  version: '0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7',
  coinDecimalsRegistry: '0x200abe9bf19751cc566ae35aa58e2b7e4ff688fc1130f8d8909ea09bc137d668',
  xOracle: '0x93d5bf0936b71eb27255941e532fac33b5a5c7759e377b4923af0a1359ad494f',
  protocolPkg: '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805',
  upgradedProtocolPkg: '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805',
  borrowIncentivePkg: '0x74922703605ba0548a55188098d6ebc8fdeb9fe16993986f1b7c9a49036c7c9c',
  borrowIncentiveConfig: '0xdf5d04b4691cc67e82fd4db8394d89ff44823a9de29716c924f74bb4f11cc1f7',
  borrowIncentivePools: '0x6547e143d406b5ccd5f46aae482497de279cc1a68c406f701df70a05f9212ab4',
  borrowIncentiveAccounts: '0xc4701fdbc1c92f9a636d334d66012b3027659e9fb8aff27279a82edfb6b77d02',
  vescaSubsTable: '0x064ae57829a1224b05d209da729ab77647ab70a21a82a933a5070639d15af490',
  vescaSubsWhitelist: '0xaa0a920bf20b43aa1a8c19cf39df457a835ce98b2820a0d1090420a7e5ff66fe',
};

// Authoritative Scallop mainnet shared object initial versions
// IMPORTANT: If Scallop migrates objects, these versions must be updated.
// These are used for zero-RPC PTB construction latency optimization.
export const SCALLOP_SHARED_VERSIONS: Record<string, number> = {
  [SCALLOP_CONFIG.version]: 7765848,
  [SCALLOP_CONFIG.market]: 7765848,
  [SCALLOP_CONFIG.coinDecimalsRegistry]: 7765847,
  [SCALLOP_CONFIG.xOracle]: 7765842,
  [SCALLOP_CONFIG.borrowIncentivePools]: 81234462,
  [SCALLOP_CONFIG.borrowIncentiveAccounts]: 81234462,
};

/**
 * Validates the hardcoded shared object initial versions against on-chain state.
 * Expected to be called during startup to ensure no silent failures if objects migrate.
 */
export async function validateSharedVersions(client: any): Promise<void> {
  const objects = Object.keys(SCALLOP_SHARED_VERSIONS);
  
  const res = await client.multiGetObjects({
    ids: objects,
    options: { showOwner: true }
  });
  
  for (const obj of res) {
    if (obj.data?.owner && typeof obj.data.owner === 'object' && 'Shared' in obj.data.owner) {
      const initial = obj.data.owner.Shared.initial_shared_version;
      const expected = SCALLOP_SHARED_VERSIONS[obj.data.objectId];
      if (initial && expected && Number(initial) !== expected) {
        throw new Error(`Shared object initial version mismatch for ${obj.data.objectId}. Expected ${expected}, got ${initial}`);
      }
    }
  }
}

// Cetus CLMM Mainnet Configuration
export const CETUS_CONFIG = {
  clmmPoolPackageId: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
  activeClmmPackageId: '0x25ebb9a7c50eb17b3fa9c5a30fb8b5ad8f97caaf4928943acbcff7153dfee5e3',
  // Cetus Router / Integrate package (upgraded to v16 on mainnet)
  integratePackageId: '0xae9c208cf58fd5ba36737c9ee5dcfa7f152d0fb5a5a99eebb7c881ebc2fe59e0',
  clmmPackageId: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
  globalConfigId: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f',
  // Canonical high-liquidity Cetus pools (verified on-chain)
  pools: {
    'USDC_SUI': '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105',
    'SUI_USDC': '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105',
    'CETUS_SUI': '0x2e041f3fd93646dcc877f783c1f2b7fa62d30271bdef1f21ef002cebf857bded',
    'DEEP_SUI': '0xe01243f37f712ef87e556afb9b1d03d0fae13f96d324ec912daffc339dfdcbd2',
    'USDC_USDT': '0xb8a67c149fd1bc7f9aca1541c61e51ba13bdded64c273c278e50850ae3bff073',
    'USDC_ETH': '0x9e59de50d9e5979fc03ac5bcacdb581c823dbd27d63a036131e17b391f2fac88',
  }
};

// DeepBook v3 Mainnet Configuration (verified with @mysten/deepbook-v3)
export const DEEPBOOK_CONFIG = {
  packageId: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270',
  v3PackageId: '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748',
  registryId: '0xaf16199a2dff736e9f07a845f23c5da6df6f756eddb631aed9d24a93efc4549d',
  pools: {
    'SUI_USDC': '0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407',
    'DEEP_SUI': '0xb663828d6217467c8a1838a03793da896cbe745b150ebd57d82f814ca579fc22',
    'DEEP_USDC': '0xf948981b806057580f91622417534f491da5f61aeaf33d0ed8e69fd5691c95ce',
    'USDT_USDC': '0xfc28a2fb22579c16d672a1152039cbf671e5f4b9f103feddff4ea06ef3c2bc25',
  }
};

// Pyth Network Mainnet Configuration
export const PYTH_CONFIG = {
  packageId: '0x04442ec1e516bc3c0b16f4b0624d730f7937e238b807f05235fed2904c437e',
  priceInfoObject: '0x2611dff736233a6855e28ae95f8e5f62a6bf80653ddb118bf012fd783d530fa1',
  hermesEndpoints: [
    'https://pyth.dourolabs.app/hermes',
    'https://hermes.pyth.network',
    'https://hermes-beta.pyth.network',
  ]
};
