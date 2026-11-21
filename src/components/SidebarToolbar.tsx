import { useCallback, useRef, useState } from "react";
import { IconButton } from "./IconButton";

/** Whether result rows show their preview, for every row without an override. */
type RowMode = "collapsed" | "expanded";

/**
 * Row expansion for the results list (docs/sidebar-toolbar-spec.md): one mode
 * for all rows plus per-row overrides keyed by the result note's path.
 * The mode lives as long as the view (it survives note switches and result
 * refreshes); overrides last only while the same source note's results
 * refresh. Keeping the mode across restarts is intentionally not here yet:
 * no workspace state or settings are written.
 */
export function useRowExpansion(resultPaths: readonly string[]) {
    const [mode, setMode] = useState<RowMode>("collapsed");
    const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(
        () => new Map()
    );
    const sourcePathRef = useRef<string | null>(null);

    const isRowCollapsed = (path: string): boolean =>
        overrides.get(path) ?? mode === "collapsed";

    const toggleRow = (path: string) => {
        setOverrides((prev) => {
            const next = new Map(prev);
            next.set(path, !(prev.get(path) ?? mode === "collapsed"));
            return next;
        });
    };

    const anyRowExpanded = resultPaths.some((path) => !isRowCollapsed(path));

    const toggleAllRows = () => {
        setMode(anyRowExpanded ? "collapsed" : "expanded");
        setOverrides(new Map());
    };

    /** Call with each model's source note; a different note drops the overrides. */
    const noteSourceNote = useCallback((sourcePath: string | null) => {
        if (sourcePath !== sourcePathRef.current) {
            sourcePathRef.current = sourcePath;
            setOverrides(new Map());
        }
    }, []);

    return { isRowCollapsed, toggleRow, anyRowExpanded, toggleAllRows, noteSourceNote };
}

interface SidebarToolbarProps {
    showExpandButton: boolean;
    anyRowExpanded: boolean;
    onToggleAllRows: () => void;
    /** `onDismissed` runs when the modal closes without opening a note. */
    onOpenSemanticSearch?: (onDismissed: () => void) => void;
}

/** The sidebar's toolbar row: expand/collapse all and semantic search. */
export const SidebarToolbar: React.FC<SidebarToolbarProps> = ({
    showExpandButton,
    anyRowExpanded,
    onToggleAllRows,
    onOpenSemanticSearch,
}) => {
    const searchButtonRef = useRef<HTMLDivElement>(null);
    const openSemanticSearch = () => {
        onOpenSemanticSearch?.(() => searchButtonRef.current?.focus());
    };

    return (
        <div className="nav-header similar-notes-sidebar-toolbar">
            <div className="nav-buttons-container">
                {showExpandButton && (
                    <IconButton
                        icon={anyRowExpanded ? "chevrons-down-up" : "chevrons-up-down"}
                        label={anyRowExpanded ? "Collapse all" : "Expand all"}
                        onClick={onToggleAllRows}
                    />
                )}
                <IconButton
                    ref={searchButtonRef}
                    icon="text-search"
                    label="Semantic search…"
                    onClick={openSemanticSearch}
                />
            </div>
        </div>
    );
};
