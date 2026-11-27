import { fireEvent } from "@testing-library/react";
import { act } from "react";
import type { App } from "obsidian";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TextSearchService } from "@/domain/service/TextSearchService";
import { SemanticSearchModal } from "../SemanticSearchModal";

const notices = vi.hoisted(() => [] as string[]);
vi.mock("obsidian", async (importOriginal) => {
    const actual = await importOriginal<typeof import("obsidian")>();
    return {
        ...actual,
        Notice: class {
            constructor(message: string) {
                notices.push(message);
            }
        },
    };
});

// Obsidian's element helpers used by the modal, missing from jsdom.
const withObsidianHelpers = (el: HTMLElement) =>
    Object.assign(el, {
        empty: () => el.replaceChildren(),
        addClass: (c: string) => el.classList.add(c),
        removeClass: (c: string) => el.classList.remove(c),
    });

describe("SemanticSearchModal onDismissed", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    const openModal = (onDismissed: () => void) => {
        const modal = new SemanticSearchModal(
            {} as App,
            { search: vi.fn() } as unknown as TextSearchService,
            "title",
            { onDismissed }
        );
        withObsidianHelpers(modal.modalEl);
        withObsidianHelpers(modal.contentEl);
        document.body.appendChild(modal.modalEl);
        modal.close = () => modal.onClose();
        act(() => modal.onOpen());
        return modal;
    };

    test("Esc closes the modal and reports it as dismissed", () => {
        vi.useFakeTimers();
        const onDismissed = vi.fn();
        const modal = openModal(onDismissed);
        const input = modal.modalEl.querySelector("input");
        expect(input).not.toBeNull();
        act(() => {
            fireEvent.keyDown(input!, { key: "Escape" });
        });
        vi.runAllTimers();
        expect(onDismissed).toHaveBeenCalledTimes(1);
    });
});

describe("SemanticSearchModal empty state", () => {
    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    test("says 'No similar notes found' only after the search for the typed query has run", async () => {
        vi.useFakeTimers();
        const findSimilarNotesFromText = vi.fn(async () => ({
            similarNotes: [],
            tokenCount: 0,
            maxTokens: 0,
            isOverLimit: false,
        }));
        const modal = new SemanticSearchModal(
            { vault: { getAbstractFileByPath: () => null } } as unknown as App,
            { findSimilarNotesFromText } as unknown as TextSearchService,
            "title"
        );
        withObsidianHelpers(modal.modalEl);
        withObsidianHelpers(modal.contentEl);
        document.body.appendChild(modal.modalEl);
        act(() => modal.onOpen());
        const input = modal.modalEl.querySelector("input")!;

        act(() => {
            fireEvent.change(input, { target: { value: "city" } });
        });
        // Typed, but the debounced search has not started yet: nothing is known.
        expect(modal.modalEl.textContent).not.toContain("No similar notes found");

        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        expect(findSimilarNotesFromText).toHaveBeenCalledWith("city");
        expect(modal.modalEl.textContent).toContain("No similar notes found");

        // Typing on after an empty answer: the old answer is not about this query.
        act(() => {
            fireEvent.change(input, { target: { value: "city on" } });
        });
        expect(modal.modalEl.textContent).not.toContain("No similar notes found");
    });
    test("a failed search shows a notice, not 'No similar notes found'", async () => {
        vi.useFakeTimers();
        notices.length = 0;
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const findSimilarNotesFromText = vi.fn(async () => {
            throw new Error("provider unavailable");
        });
        const modal = new SemanticSearchModal(
            { vault: { getAbstractFileByPath: () => null } } as unknown as App,
            { findSimilarNotesFromText } as unknown as TextSearchService,
            "title"
        );
        withObsidianHelpers(modal.modalEl);
        withObsidianHelpers(modal.contentEl);
        document.body.appendChild(modal.modalEl);
        act(() => modal.onOpen());
        const input = modal.modalEl.querySelector("input")!;

        act(() => {
            fireEvent.change(input, { target: { value: "city" } });
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        expect(findSimilarNotesFromText).toHaveBeenCalledWith("city");
        expect(modal.modalEl.textContent).not.toContain("No similar notes found");
        expect(notices).toEqual(["Similar Notes: search failed. Check your model settings and try again."]);
        // The modal stays open with the query, so the user can edit it.
        expect(input.value).toBe("city");
        consoleError.mockRestore();
    });

    test("a failed search with a known cause names it in the notice", async () => {
        vi.useFakeTimers();
        notices.length = 0;
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const findSimilarNotesFromText = vi.fn(async () => {
            throw new Error("Failed to generate embedding: 401. unauthorized");
        });
        const modal = new SemanticSearchModal(
            { vault: { getAbstractFileByPath: () => null } } as unknown as App,
            { findSimilarNotesFromText } as unknown as TextSearchService,
            "title"
        );
        withObsidianHelpers(modal.modalEl);
        withObsidianHelpers(modal.contentEl);
        document.body.appendChild(modal.modalEl);
        act(() => modal.onOpen());
        act(() => {
            fireEvent.change(modal.modalEl.querySelector("input")!, { target: { value: "city" } });
        });
        await act(async () => {
            await vi.advanceTimersByTimeAsync(300);
        });
        expect(notices).toEqual([
            "Similar Notes: search failed: the provider couldn't authenticate the request. Check your API key in settings.",
        ]);
        consoleError.mockRestore();
    });

    test("a provider that keeps failing shows one notice per open, again after a search succeeds or on reopen", async () => {
        vi.useFakeTimers();
        notices.length = 0;
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        let failing = true;
        const findSimilarNotesFromText = vi.fn(async () => {
            if (failing) throw new Error("provider unavailable");
            return { similarNotes: [], tokenCount: 0, maxTokens: 0, isOverLimit: false };
        });
        const service = { findSimilarNotesFromText } as unknown as TextSearchService;
        const app = { vault: { getAbstractFileByPath: () => null } } as unknown as App;
        const open = () => {
            const modal = new SemanticSearchModal(app, service, "title");
            withObsidianHelpers(modal.modalEl);
            withObsidianHelpers(modal.contentEl);
            document.body.appendChild(modal.modalEl);
            act(() => modal.onOpen());
            return modal;
        };
        const type = async (input: HTMLInputElement, value: string) => {
            act(() => {
                fireEvent.change(input, { target: { value } });
            });
            await act(async () => {
                await vi.advanceTimersByTimeAsync(300);
            });
        };
        const FAILED = "Similar Notes: search failed. Check your model settings and try again.";

        const modal = open();
        const input = modal.modalEl.querySelector("input")!;
        // Pausing between words runs a search per pause; each one fails.
        await type(input, "city");
        await type(input, "city on");
        await type(input, "city on a hill");
        expect(findSimilarNotesFromText).toHaveBeenCalledTimes(3);
        expect(notices).toEqual([FAILED]);

        // Once a search succeeds, a later failure is news again.
        failing = false;
        await type(input, "city on a hil");
        failing = true;
        await type(input, "city on a hi");
        expect(notices).toEqual([FAILED, FAILED]);

        // Reopening the modal (say, after fixing the settings) can show it again.
        act(() => modal.onClose());
        const reopened = open();
        await type(reopened.modalEl.querySelector("input")!, "river");
        expect(notices).toEqual([FAILED, FAILED, FAILED]);
        consoleError.mockRestore();
    });
});
