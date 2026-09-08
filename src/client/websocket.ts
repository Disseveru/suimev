import WebSocket from 'ws';
import { CONFIG } from '../config/index.js';
import { logger } from '../ui/logger.js';

export type SuiEventHandler = (event: Record<string, unknown>) => void;

/**
 * Sui WebSocket RPC Client for Real-Time Event & Transaction Streaming
 */
export class SuiWebSocketClient {
  private ws: WebSocket | null = null;
  private isConnecting = false;
  private isClosedManually = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private messageId = 1;
  private subscriptions: Map<number, { filter: Record<string, unknown>; handler: SuiEventHandler }> = new Map();
  private pendingRequests: Map<number, (subscriptionId: number) => void> = new Map();
  private serverSubIdToHandler: Map<number, SuiEventHandler> = new Map();

  constructor(private readonly url: string = CONFIG.wsUrl) {}

  public connect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve();
    }

    this.isClosedManually = false;
    this.isConnecting = true;

    return new Promise((resolve) => {
      try {
        logger.info({ wsUrl: this.url }, 'Connecting to Sui WebSocket RPC...');
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          this.isConnecting = false;
          logger.info('Sui WebSocket connection established');
          this.startHeartbeat();
          this.resubscribeAll();
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data.toString());
        });

        this.ws.on('error', (err: Error) => {
          logger.warn({ error: err.message }, 'Sui WebSocket encountered an error');
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
          this.isConnecting = false;
          this.stopHeartbeat();
          this.serverSubIdToHandler.clear();
          logger.warn({ code, reason: reason.toString() }, 'Sui WebSocket closed');
          if (!this.isClosedManually) {
            this.scheduleReconnect();
          }
        });
      } catch (err) {
        this.isConnecting = false;
        logger.error({ error: err }, 'Failed to initiate WebSocket connection');
        this.scheduleReconnect();
        resolve();
      }
    });
  }

  /**
   * Subscribe to Sui events matching a filter
   * @param filter Event filter, e.g. { MoveEventType: '0x...::pool::BorrowEvent' }
   * @param handler Callback invoked when an event is received
   */
  public subscribeEvent(filter: Record<string, unknown>, handler: SuiEventHandler): void {
    const id = this.messageId++;
    this.subscriptions.set(id, { filter, handler });

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendSubscription(id, filter);
    }
  }

  private sendSubscription(internalId: number, filter: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const payload = {
      jsonrpc: '2.0',
      id: internalId,
      method: 'sui_subscribeEvent',
      params: [filter],
    };

    this.pendingRequests.set(internalId, (subId: number) => {
      const sub = this.subscriptions.get(internalId);
      if (sub) {
        this.serverSubIdToHandler.set(subId, sub.handler);
      }
      logger.debug({ internalId, subId, filter }, 'Subscription confirmed by Sui RPC');
    });

    this.ws.send(JSON.stringify(payload));
  }

  private resubscribeAll(): void {
    this.serverSubIdToHandler.clear();
    for (const [id, sub] of this.subscriptions.entries()) {
      this.sendSubscription(id, sub.filter);
    }
  }

  private handleMessage(messageStr: string): void {
    try {
      const msg = JSON.parse(messageStr);

      // Handle subscription confirmation response: { id: 1, result: 12345 }
      if (msg.id && msg.result !== undefined && this.pendingRequests.has(msg.id)) {
        const callback = this.pendingRequests.get(msg.id)!;
        this.pendingRequests.delete(msg.id);
        callback(msg.result);
        return;
      }

      // Handle subscription notification: { method: 'sui_subscribeEvent', params: { subscription: 12345, result: { ... } } }
      if (msg.params && msg.params.result) {
        const eventData = msg.params.result;
        const subId = Number(msg.params.subscription);
        const specificHandler = this.serverSubIdToHandler.get(subId);

        if (specificHandler) {
          specificHandler(eventData);
        } else {
          for (const sub of this.subscriptions.values()) {
            sub.handler(eventData);
          }
        }
      }
    } catch (err) {
      logger.debug({ error: err, raw: messageStr }, 'Error handling WebSocket message');
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 20_000);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout || this.isClosedManually) return;

    const delay = 3000;
    logger.info(`Scheduling WebSocket reconnect in ${delay}ms...`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }

  public disconnect(): void {
    this.isClosedManually = true;
    this.stopHeartbeat();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const suiWsClient = new SuiWebSocketClient();
