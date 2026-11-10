const MAX_STEPS = 200;

/** Undo and redo over immutable snapshots. */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private value: T) {}

  get current(): T {
    return this.value;
  }

  /** Records a new state that can be undone. */
  commit(next: T): void {
    this.past.push(this.value);
    if (this.past.length > MAX_STEPS) this.past.shift();
    this.future = [];
    this.value = next;
  }

  /** Changes the current state in place, as part of the last recorded step. */
  replace(next: T): void {
    this.value = next;
  }

  undo(): boolean {
    const previous = this.past.pop();
    if (previous === undefined) return false;
    this.future.push(this.value);
    this.value = previous;
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.value);
    this.value = next;
    return true;
  }
}
