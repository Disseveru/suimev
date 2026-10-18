export class MaxHeap<T extends string> {
  private values: Array<{ key: T; priority: number }> = [];
  private indexMap: Map<T, number> = new Map();

  public push(key: T, priority: number): void {
    if (this.indexMap.has(key)) {
      this.remove(key);
    }

    const node = { key, priority };
    this.values.push(node);
    this.indexMap.set(key, this.values.length - 1);
    this.bubbleUp(this.values.length - 1);
  }

  public remove(key: T): boolean {
    const idx = this.indexMap.get(key);
    if (idx === undefined) return false;

    const last = this.values.pop();
    if (!last) {
      this.indexMap.delete(key);
      return true;
    }

    if (idx < this.values.length) {
      this.values[idx] = last;
      this.indexMap.set(last.key, idx);
      this.bubbleUp(idx);
      this.bubbleDown(idx);
    }

    this.indexMap.delete(key);
    return true;
  }

  public peek(): T | undefined {
    return this.values[0]?.key;
  }

  public peekTopK(k: number): T[] {
    if (k <= 0 || this.values.length === 0) return [];

    const clone = [...this.values].sort((a, b) => b.priority - a.priority);
    return clone.slice(0, Math.min(k, clone.length)).map((entry) => entry.key);
  }

  public popMax(): T | undefined {
    if (this.values.length === 0) return undefined;
    const root = this.values[0];
    const last = this.values.pop();

    if (this.values.length > 0 && last) {
      this.values[0] = last;
      this.indexMap.set(last.key, 0);
      this.bubbleDown(0);
    }

    this.indexMap.delete(root.key);
    return root.key;
  }

  public size(): number {
    return this.values.length;
  }

  public clear(): void {
    this.values = [];
    this.indexMap.clear();
  }

  private bubbleUp(index: number): void {
    let currentIndex = index;
    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      if (this.values[parentIndex].priority >= this.values[currentIndex].priority) break;
      this.swap(parentIndex, currentIndex);
      currentIndex = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    let currentIndex = index;
    while (true) {
      const leftIndex = 2 * currentIndex + 1;
      const rightIndex = 2 * currentIndex + 2;
      let largestIndex = currentIndex;

      if (leftIndex < this.values.length && this.values[leftIndex].priority > this.values[largestIndex].priority) {
        largestIndex = leftIndex;
      }
      if (rightIndex < this.values.length && this.values[rightIndex].priority > this.values[largestIndex].priority) {
        largestIndex = rightIndex;
      }
      if (largestIndex === currentIndex) break;
      this.swap(currentIndex, largestIndex);
      currentIndex = largestIndex;
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.values[i];
    this.values[i] = this.values[j];
    this.values[j] = temp;

    this.indexMap.set(this.values[i].key, i);
    this.indexMap.set(this.values[j].key, j);
  }
}
