import type { SettingsService, UsageStats } from "@/application/SettingsService";
import { Notice, type TextComponent, type ButtonComponent } from "obsidian";
import { localDateKey } from "@/utils/localDate";
import type { SettingRowGroup } from "./settingDefinitions";

interface UsageStatsSectionProps {
    settingsService: SettingsService;
    onRender: () => void;
}

export class UsageStatsSection {
    private usageDescElement?: HTMLElement;
    private priceInputComponent?: TextComponent;

    constructor(private props: UsageStatsSectionProps) {}

    /**
     * Update just the usage statistics text without rebuilding the entire section
     */
    updateStats(stats: UsageStats, currentPrice?: number): void {
        if (!this.usageDescElement) return;

        const todayKey = getTodayKey();
        const todayUsage = stats.daily[todayKey] ?? { tokens: 0, requestCount: 0 };
        const totalUsage = stats.total;

        // Build usage description with cost if available
        let usageDesc = `Today: ${formatTokens(todayUsage.tokens)} tokens`;
        if (currentPrice && currentPrice > 0) {
            const todayCost = estimateCost(todayUsage.tokens, currentPrice);
            if (todayCost) usageDesc += ` (${todayCost})`;
        }
        usageDesc += `\nTotal: ${formatTokens(totalUsage.tokens)} tokens`;
        if (currentPrice && currentPrice > 0) {
            const totalCost = estimateCost(totalUsage.tokens, currentPrice);
            if (totalCost) usageDesc += ` (${totalCost})`;
        }
        if (totalUsage.firstUseDate) {
            usageDesc += ` since ${totalUsage.firstUseDate}`;
        }

        this.usageDescElement.setText(usageDesc);
    }

    /**
     * The "API usage" group as setting definitions (settings-search spec).
     */
    getDefinitionGroup(): SettingRowGroup {
        const { settingsService, onRender } = this.props;
        const settings = settingsService.get();
        const stats = settings.usageStats ?? createEmptyStats();
        const currentPrice = settings.openaiPricePerMillionTokens;

        return {
            type: "group",
            heading: "API usage",
            items: [
                { name: "Token usage", render: (setting) => {
                    setting.setName("Token usage");
                    this.usageDescElement = setting.descEl;

                    // Set initial description
                    const todayKey = getTodayKey();
                    const todayUsage = stats.daily[todayKey] ?? { tokens: 0, requestCount: 0 };
                    const totalUsage = stats.total;

                    let usageDesc = `Today: ${formatTokens(todayUsage.tokens)} tokens`;
                    if (currentPrice && currentPrice > 0) {
                        const todayCost = estimateCost(todayUsage.tokens, currentPrice);
                        if (todayCost) usageDesc += ` (${todayCost})`;
                    }
                    usageDesc += `\nTotal: ${formatTokens(totalUsage.tokens)} tokens`;
                    if (currentPrice && currentPrice > 0) {
                        const totalCost = estimateCost(totalUsage.tokens, currentPrice);
                        if (totalCost) usageDesc += ` (${totalCost})`;
                    }
                    if (totalUsage.firstUseDate) {
                        usageDesc += ` since ${totalUsage.firstUseDate}`;
                    }

                    setting.setDesc(usageDesc);
                } },
                { name: "Price per 1M tokens", render: (setting) => {
                    setting
                        .setName("Price per 1M tokens")
                        .setDesc("Enter price to calculate estimated costs")
                        .addText((text: TextComponent) => {
                            this.priceInputComponent = text;
                            text.setPlaceholder("e.g., 0.02")
                                .setValue(currentPrice?.toString() ?? "")
                                .onChange(async (value: string) => {
                                // Allow intermediate input states like "0." or "0.0"
                                    if (value === "" || value === "." || value.endsWith(".") || /^0\.0*$/.test(value)) {
                                        if (value === "") {
                                            await settingsService.update({ openaiPricePerMillionTokens: undefined });
                                        }
                                        return;
                                    }

                                    const price = parseFloat(value);
                                    if (!isNaN(price) && price >= 0) {
                                        await settingsService.update({ openaiPricePerMillionTokens: price });
                                    }
                                });
                            text.inputEl.addEventListener("blur", () => {
                            // Refresh the cost estimate in place; a full tab
                            // re-render here would take focus from the field
                            // the user moved to.
                                const latest = settingsService.get();
                                this.updateStats(
                                    latest.usageStats ?? createEmptyStats(),
                                    latest.openaiPricePerMillionTokens
                                );
                            });
                            text.inputEl.addClass("similar-notes-input-w100");
                        });
                } },
                { name: "Reset statistics", render: (setting) => {
                    setting
                        .setName("Reset statistics")
                        .setDesc("Clear all token usage history")
                        .addButton((button: ButtonComponent) => {
                            button.setButtonText("Reset").onClick(async () => {
                                await settingsService.update({ usageStats: createEmptyStats() });
                                new Notice("Usage statistics have been reset");
                                onRender();
                            });
                        });
                } },
            ],
        };
    }
}

/**
 * Format token count with commas for readability
 */
function formatTokens(tokens: number): string {
    return tokens.toLocaleString();
}

/**
 * Calculate estimated cost based on token count and price
 */
function estimateCost(tokens: number, pricePerMillion?: number): string | null {
    if (!pricePerMillion || pricePerMillion <= 0) {
        return null;
    }

    const cost = (tokens / 1_000_000) * pricePerMillion;
    return `~$${cost.toFixed(4)}`;
}

/**
 * Get today's date key in YYYY-MM-DD format
 */
function getTodayKey(): string {
    const now = new Date();
    return localDateKey(now);
}

/**
 * Create empty usage stats structure
 */
function createEmptyStats(): UsageStats {
    return {
        daily: {},
        total: {
            tokens: 0,
            requestCount: 0,
            firstUseDate: "",
        },
    };
}

