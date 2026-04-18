import type { UsageStorage, UsageData } from '../types/types';

/**
 * Default in-memory storage implementation
 */
export class MemoryUsageStorage implements UsageStorage {
    private data: Map<string, UsageData> = new Map();

    async get(accountModelId: string): Promise<UsageData | null> {
        return this.data.get(accountModelId) || null;
    }

    async set(accountModelId: string, usage: UsageData): Promise<void> {
        this.data.set(accountModelId, usage);
    }

    /**
     * Clear all usage data (useful for testing)
     */
    clear(): void {
        this.data.clear();
    }
}
