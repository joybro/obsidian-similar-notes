/** @jsxImportSource react */
import type { FC } from "react";

interface SimilarNotesSettingProps {
    onReindex?: () => void;
}

const SimilarNotesSetting: FC<SimilarNotesSettingProps> = ({ onReindex }) => {
    return (
        <div className="similar-notes-setting">
            <div className="setting-item">
                <div className="setting-item-info">
                    <div className="setting-item-name">Reindex Notes</div>
                    <div className="setting-item-description">
                        Rebuild the similarity index for all notes
                    </div>
                </div>
                <div className="setting-item-control">
                    <button
                        type="button"
                        className="mod-cta"
                        onClick={onReindex}
                    >
                        Reindex
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SimilarNotesSetting;
