import type { ParamRecord } from '@physforge/sim-sdk';

export interface ParamCommandEntry {
  readonly modelId: string;
  readonly label: string;
  readonly beforeParams: ParamRecord;
  readonly afterParams: ParamRecord;
}

/**
 * 50 步参数与画布直操撤销/重做栈 (Ctrl+Z / Ctrl+Shift+Z)
 */
export class CommandStack {
  private undoStack: ParamCommandEntry[] = [];
  private redoStack: ParamCommandEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 50) {
    this.maxEntries = maxEntries;
  }

  push(entry: ParamCommandEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.maxEntries) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(currentModelId: string): ParamCommandEntry | null {
    while (this.undoStack.length > 0) {
      const top = this.undoStack.pop()!;
      if (top.modelId === currentModelId) {
        this.redoStack.push(top);
        return top;
      }
    }
    return null;
  }

  redo(currentModelId: string): ParamCommandEntry | null {
    while (this.redoStack.length > 0) {
      const top = this.redoStack.pop()!;
      if (top.modelId === currentModelId) {
        this.undoStack.push(top);
        return top;
      }
    }
    return null;
  }

  canUndo(currentModelId: string): boolean {
    return this.undoStack.some((e) => e.modelId === currentModelId);
  }

  canRedo(currentModelId: string): boolean {
    return this.redoStack.some((e) => e.modelId === currentModelId);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
