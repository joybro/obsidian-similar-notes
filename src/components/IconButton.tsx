import { setIcon, setTooltip } from "obsidian";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";

interface IconButtonProps {
    /** Lucide icon id, drawn with Obsidian's setIcon. */
    icon: string;
    /** Accessible name and tooltip. */
    label: string;
    onClick: () => void;
}

/**
 * A small toolbar icon button in Obsidian's own style
 * (`clickable-icon nav-action-button`, as in the file explorer header).
 * Works with mouse, Enter and Space.
 */
export const IconButton = forwardRef<HTMLDivElement, IconButtonProps>(
    function IconButton({ icon, label, onClick }, ref) {
        const elRef = useRef<HTMLDivElement>(null);
        useImperativeHandle(ref, () => elRef.current as HTMLDivElement);

        useLayoutEffect(() => {
            const el = elRef.current;
            if (!el) return;
            setIcon(el, icon);
        }, [icon]);

        useLayoutEffect(() => {
            const el = elRef.current;
            if (!el) return;
            setTooltip(el, label);
        }, [label]);

        const handleKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
            }
        };

        return (
            <div
                ref={elRef}
                className="clickable-icon nav-action-button"
                role="button"
                tabIndex={0}
                aria-label={label}
                onClick={onClick}
                onKeyDown={handleKeyDown}
            />
        );
    }
);
