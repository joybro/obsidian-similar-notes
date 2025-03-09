import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import SimilarNotesSetting from "../SimilarNotesSetting";

describe("SimilarNotesSetting", () => {
    test("renders the reindex button", () => {
        render(<SimilarNotesSetting />);

        expect(screen.getByText("Reindex Notes")).toBeDefined();
        expect(
            screen.getByText("Rebuild the similarity index for all notes")
        ).toBeDefined();
        expect(screen.getByRole("button", { name: "Reindex" })).toBeDefined();
    });

    test("calls onReindex when button is clicked", async () => {
        const onReindex = vi.fn();
        render(<SimilarNotesSetting onReindex={onReindex} />);

        const button = screen.getByRole("button", { name: "Reindex" });
        await userEvent.click(button);

        expect(onReindex).toHaveBeenCalledTimes(1);
    });
});
