import type {
    DailyUsage,
    SettingsService,
    TotalUsage,
    UsageStats,
} from "@/application/SettingsService";

/**
 * Tracks OpenAI API usage (tokens and requests)
 */
export class UsageTracker {
    constructor(private settingsService: SettingsService) {}

    /**
     * Get current usage stats from settings
     */
    getStats(): UsageStats {
        const settings = this.settingsService.get();
        return settings.usageStats ?? this.createEmptyStats();
    }

    /**
     * Get today's usage
     */
    getTodayUsage(): DailyUsage {
        const stats = this.getStats();
        const today = this.getTodayKey();
        return stats.daily[today] ?? { tokens: 0, requestCount: 0 };
    }

    /**
     * Get total usage
     */
    getTotalUsage(): TotalUsage {
        return this.getStats().total;
    }

    /**
     * Track usage from API response
     */
    async trackUsage(promptTokens: number, totalTokens: number): Promise<void> {
        const stats = this.getStats();
        const today = this.getTodayKey();

        // Update daily stats
        if (!stats.daily[today]) {
            stats.daily[today] = { tokens: 0, requestCount: 0 };
        }
        stats.daily[today].tokens += totalTokens;
        stats.daily[today].requestCount += 1;

        // Update total stats
        stats.total.tokens += totalTokens;
        stats.total.requestCount += 1;
        if (!stats.total.firstUseDate) {
            stats.total.firstUseDate = today;
        }

        // Clean up old daily entries (keep last 30 days)
        this.cleanupOldEntries(stats);

        // Save to settings
        await this.settingsService.update({ usageStats: stats });
    }

    /**
     * Reset all usage statistics
     */
    async resetStats(): Promise<void> {
        await this.settingsService.update({ usageStats: this.createEmptyStats() });
    }

    /**
     * Calculate estimated cost based on token count and price
     */
    estimateCost(tokens: number, pricePerMillion?: number): string | null {
        if (!pricePerMillion || pricePerMillion <= 0) {
            return null;
        }

        const cost = (tokens / 1_000_000) * pricePerMillion;
        return `~$${cost.toFixed(4)}`;
    }

    /**
     * Get today's date key in YYYY-MM-DD format
     */
    private getTodayKey(): string {
        const now = new Date();
        return now.toISOString().split("T")[0];
    }

    /**
     * Create empty usage stats structure
     */
    private createEmptyStats(): UsageStats {
        return {
            daily: {},
            total: {
                tokens: 0,
                requestCount: 0,
                firstUseDate: "",
            },
        };
    }

    /**
     * Remove daily entries older than 30 days
     */
    private cleanupOldEntries(stats: UsageStats): void {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 30);
        const cutoffKey = cutoffDate.toISOString().split("T")[0];

        for (const dateKey of Object.keys(stats.daily)) {
            if (dateKey < cutoffKey) {
                delete stats.daily[dateKey];
            }
        }
    }
}
