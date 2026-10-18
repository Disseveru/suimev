import { LiquidationOpportunity } from '../config/types.js';
import { MaxHeap } from '../utils/heap.js';

/**
 * Opportunity scheduling queue backed by a max-heap to keep the highest-value
 * liquidation opportunities at the front without sorting the full queue array.
 */
export class OpportunityQueue {
  private heap = new MaxHeap<string>();
  private opportunities = new Map<string, LiquidationOpportunity>();

  public enqueue(opportunity: LiquidationOpportunity): void {
    const obligationId = opportunity.obligation.obligationId;
    const existing = this.opportunities.get(obligationId);
    const priority = Number(opportunity.expectedGrossProfitUsd) || 0;

    if (existing && existing.expectedGrossProfitUsd >= opportunity.expectedGrossProfitUsd) {
      return;
    }

    if (existing) {
      this.heap.remove(obligationId);
    }

    this.heap.push(obligationId, priority);
    this.opportunities.set(obligationId, opportunity);
  }

  public dequeue(): LiquidationOpportunity | undefined {
    const obligationId = this.heap.popMax();
    if (!obligationId) {
      return undefined;
    }

    const opportunity = this.opportunities.get(obligationId);
    this.opportunities.delete(obligationId);
    return opportunity;
  }

  public has(obligationId: string): boolean {
    return this.opportunities.has(obligationId);
  }

  public size(): number {
    return this.opportunities.size;
  }

  public clear(): void {
    this.heap.clear();
    this.opportunities.clear();
  }
}
