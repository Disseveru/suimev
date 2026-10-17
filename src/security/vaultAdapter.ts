import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { CONFIG } from '../config/index.js';
import { logger } from '../ui/logger.js';
import type {
  IVaultAdapter,
  CDPCredentials,
  VaultSecretKey,
} from '../types/security.js';

export class SecurityFatalException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityFatalException';
  }
}

export interface EnvVaultAdapterOptions {
  env?: Record<string, string | undefined>;
  failClosed?: boolean;
  isDryRun?: boolean;
}

/**
 * Enterprise Secure Vault Adapter
 *
 * Securely manages CDP credentials (CDP_API_KEY, CDP_API_SECRET, CDP_WALLET_SECRET)
 * and operator private keys with fail-closed validation and memory scrubbing.
 */
export class EnvVaultAdapter implements IVaultAdapter {
  private envMap: Map<string, string>;
  private failClosed: boolean;
  private isDryRun: boolean;
  private isDestroyed = false;

  constructor(options?: EnvVaultAdapterOptions) {
    this.failClosed = options?.failClosed ?? true;
    this.isDryRun = options?.isDryRun ?? CONFIG.dryRun;
    this.envMap = new Map();

    const sourceEnv = options?.env ?? process.env;
    for (const [key, val] of Object.entries(sourceEnv)) {
      if (val !== undefined) {
        this.envMap.set(key, val);
      }
    }
  }

  public async initialize(): Promise<void> {
    this.ensureNotDestroyed();
    if (!this.isDryRun && this.failClosed) {
      this.validateActiveExecutionCredentials();
    }
  }

  public async getSecret(key: VaultSecretKey | string): Promise<string | null> {
    this.ensureNotDestroyed();
    const val = this.envMap.get(key);
    if (!val || !val.trim()) {
      return null;
    }
    return val.trim();
  }

  public async getRequiredSecret(key: VaultSecretKey | string): Promise<string> {
    this.ensureNotDestroyed();
    const secret = await this.getSecret(key);
    if (!secret) {
      throw new SecurityFatalException(
        `CRITICAL SECURITY ERROR: Required vault secret "${key}" is missing or empty in vault environment.`
      );
    }
    return secret;
  }

  public async getCDPCredentials(): Promise<CDPCredentials> {
    this.ensureNotDestroyed();

    const apiKey = (await this.getSecret('CDP_API_KEY')) ?? undefined;
    const apiSecret = (await this.getSecret('CDP_API_SECRET')) ?? undefined;
    const walletSecret = (await this.getSecret('CDP_WALLET_SECRET')) ?? undefined;
    const rawPrivateKey = (await this.getSecret('SUI_PRIVATE_KEY')) ?? undefined;
    const pythApiKey = (await this.getSecret('PYTH_API_KEY')) ?? undefined;
    const sentioApiKey = (await this.getSecret('SENTIO_API_KEY')) ?? undefined;
    const softBundleAuthToken = (await this.getSecret('SOFT_BUNDLE_AUTH_TOKEN')) ?? undefined;

    // Fail-closed validation when active execution is enabled
    if (!this.isDryRun && this.failClosed) {
      if (!rawPrivateKey) {
        throw new SecurityFatalException(
          'CRITICAL SECURITY ERROR: SUI_PRIVATE_KEY is missing from vault while active execution is enabled (DRY_RUN=false)!'
        );
      }
    }

    const keypair = this.resolveOperatorKeypair(rawPrivateKey, this.isDryRun);
    const operatorAddress = keypair ? keypair.toSuiAddress() : CONFIG.operatorAddress;

    return {
      apiKey,
      apiSecret,
      walletSecret,
      operatorKeypair: keypair,
      operatorAddress,
      pythApiKey,
      sentioApiKey,
      softBundleAuthToken,
      rpcUrls: [CONFIG.rpcUrl, ...CONFIG.backupRpcs],
    };
  }

  public validateActiveExecutionCredentials(requireCdp: boolean = false): void {
    const rawPrivateKey = this.envMap.get('SUI_PRIVATE_KEY');
    if (!rawPrivateKey || !rawPrivateKey.trim()) {
      throw new SecurityFatalException(
        'CRITICAL SECURITY ERROR: SUI_PRIVATE_KEY is missing from secure vault while active execution is enabled!'
      );
    }

    if (requireCdp) {
      const cdpApiKey = this.envMap.get('CDP_API_KEY');
      const cdpApiSecret = this.envMap.get('CDP_API_SECRET');
      if (!cdpApiKey || !cdpApiKey.trim() || !cdpApiSecret || !cdpApiSecret.trim()) {
        throw new SecurityFatalException(
          'CRITICAL SECURITY ERROR: CDP_API_KEY or CDP_API_SECRET is missing from secure vault while active execution is enabled!'
        );
      }
    }
  }

  public resolveOperatorKeypair(rawKey?: string, isDryRun: boolean = true): Ed25519Keypair {
    this.ensureNotDestroyed();
    if (!rawKey || !rawKey.trim()) {
      if (!isDryRun) {
        throw new SecurityFatalException(
          'CRITICAL SECURITY ERROR: SUI_PRIVATE_KEY is empty in vault while DRY_RUN=false! Live broadcasting requires a persistent keypair.'
        );
      }
      return new Ed25519Keypair();
    }

    const trimmed = rawKey.trim();

    // 1. Bech32 format (e.g. suiprivkey1...)
    if (trimmed.startsWith('suiprivkey')) {
      try {
        return Ed25519Keypair.fromSecretKey(trimmed);
      } catch (e) {
        if (!isDryRun) throw new SecurityFatalException(`Invalid suiprivkey format in SUI_PRIVATE_KEY: ${e}`);
      }
    }

    // 2. Hex format (with or without 0x prefix)
    const hexCandidate = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
    if (
      /^[0-9a-fA-F]+$/.test(hexCandidate) &&
      (hexCandidate.length === 64 || hexCandidate.length === 66 || hexCandidate.length === 128)
    ) {
      let buf: Buffer | null = null;
      try {
        buf = Buffer.from(hexCandidate, 'hex');
        let keyBytes: Uint8Array;
        if (buf.length === 33 && buf[0] === 0) {
          keyBytes = new Uint8Array(buf.subarray(1));
        } else if (buf.length === 32 || buf.length === 64) {
          keyBytes = new Uint8Array(buf.subarray(0, 32));
        } else {
          keyBytes = new Uint8Array(buf.subarray(0, 32));
        }
        return Ed25519Keypair.fromSecretKey(keyBytes);
      } catch (e) {
        if (!isDryRun) throw new SecurityFatalException(`Failed to parse hex SUI_PRIVATE_KEY: ${e}`);
      } finally {
        if (buf) {
          buf.fill(0); // Memory scrubbing
        }
      }
    }

    // 3. Base64 format
    let buf: Buffer | null = null;
    try {
      buf = Buffer.from(trimmed, 'base64');
      let keyBytes: Uint8Array;
      if (buf.length === 33 && buf[0] === 0) {
        keyBytes = new Uint8Array(buf.subarray(1));
      } else if (buf.length === 32 || buf.length === 64) {
        keyBytes = new Uint8Array(buf.subarray(0, 32));
      } else {
        keyBytes = new Uint8Array(buf.subarray(0, 32));
      }
      return Ed25519Keypair.fromSecretKey(keyBytes);
    } catch (e) {
      if (!isDryRun) throw new SecurityFatalException(`Failed to parse base64 SUI_PRIVATE_KEY: ${e}`);
    } finally {
      if (buf) {
        buf.fill(0); // Memory scrubbing
      }
    }

    if (!isDryRun) {
      throw new SecurityFatalException(
        'CRITICAL CONFIG ERROR: Malformed SUI_PRIVATE_KEY in vault while DRY_RUN=false! Refusing to generate ephemeral key in live mode.'
      );
    }

    return new Ed25519Keypair();
  }

  public async rotateSecret(key: VaultSecretKey | string, newValue: string): Promise<void> {
    this.ensureNotDestroyed();
    this.envMap.set(key, newValue);
    logger.info({ key }, 'Vault secret rotated successfully in memory');
  }

  public async destroy(): Promise<void> {
    for (const key of this.envMap.keys()) {
      this.envMap.set(key, '');
    }
    this.envMap.clear();
    this.isDestroyed = true;
  }

  private ensureNotDestroyed(): void {
    if (this.isDestroyed) {
      throw new SecurityFatalException('VaultAdapter instance has been destroyed');
    }
  }
}

export const envVaultAdapter = new EnvVaultAdapter();
