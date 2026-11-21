import { fireEvent } from "@testing-library/react";
import { act } from "react";
import type { App } from "obsidian";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TextSearchService } from "@/domain/service/TextSearchService";
import { SemanticSearchModal } from "../SemanticSearchModal";

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
