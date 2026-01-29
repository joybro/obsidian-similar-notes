import type { SettingsService, SimilarNotesSettings, UsageStats } from "@/application/SettingsService";
import { Notice, SettingGroup, type TextComponent, type ButtonComponent } from "obsidian";

interface UsageStatsSectionProps {
    sectionContainer: HTMLElement;
    settings: SimilarNotesSettings;
    settingsService: SettingsService;
    onRender: () => void;
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
    return now.toISOString().split("T")[0];
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

export function renderUsageStatsSection(props: UsageStatsSectionProps): void {
    const { sectionContainer, settings, settingsService, onRender } = props;

    const stats = settings.usageStats ?? createEmptyStats();
    const todayKey = getTodayKey();
    const todayUsage = stats.daily[todayKey] ?? { tokens: 0, requestCount: 0 };
    const totalUsage = stats.total;
    const currentPrice = settings.openaiPricePerMillionTokens;

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

    // Create a SettingGroup for API usage
    new SettingGroup(sectionContainer)
        .setHeading("API usage")
        .addSetting((setting) => {
            setting.setName("Token usage").setDesc(usageDesc);
        })
        .addSetting((setting) => {
            setting
                .setName("Price per 1M tokens")
                .setDesc("Enter price to calculate estimated costs")
                .addText((text: TextComponent) => {
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
                        onRender();
                    });
                    text.inputEl.style.width = "100px";
                });
        })
        .addSetting((setting) => {
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
        });
}
