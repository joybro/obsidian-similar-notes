export interface SimilarNotesHeaderProps {
    collapsed: boolean;
    onToggleCollapse: () => void;
}

/** The "Similar notes" heading that folds the results list. */
export const SimilarNotesHeader: React.FC<SimilarNotesHeaderProps> = ({
    collapsed,
    onToggleCollapse,
}) => {
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            onToggleCollapse();
            e.preventDefault();
        }
    };

    return (
        <div
            className="tree-item-self is-clickable"
            onClick={onToggleCollapse}
            onKeyDown={handleKeyDown}
        >
            <div
                className={`similar-notes-title tree-item-itself is-clickable ${
                    collapsed ? "is-collapsed" : ""
                }`}
            >
                <div className="tree-item-inner">Similar notes</div>
            </div>
        </div>
    );
};
