/** @jsxImportSource react */
import type { FC } from "react";

interface SimilarNotesSettingProps {
    onReindex: () => Promise<void>;
    dbPath: string;
    autoSaveInterval: number;
    onSettingChange: (setting: string, value: string | number) => void;
}

const SimilarNotesSetting: FC<SimilarNotesSettingProps> = ({
    onReindex,
    dbPath,
    autoSaveInterval,
    onSettingChange,
}) => {
    return (
        <div className="similar-notes-setting">
            <div className="setting-item">
                <div className="setting-item-info">
                    <div className="setting-item-name">Database Path</div>
                    <div className="setting-item-description">
                        Path where the similarity database will be stored
                    </div>
                </div>
                <div className="setting-item-control">
                    <input
                        type="text"
                        value={dbPath}
                        onChange={(e) =>
                            onSettingChange("dbPath", e.target.value)
                        }
                    />
                </div>
            </div>

            <div className="setting-item">
                <div className="setting-item-info">
                    <div className="setting-item-name">Auto-save Interval</div>
                    <div className="setting-item-description">
                        How often to save changes to disk (in minutes)
                    </div>
                </div>
                <div className="setting-item-control">
                    <input
                        type="number"
                        min="1"
                        value={autoSaveInterval}
                        onChange={(e) =>
                            onSettingChange(
                                "autoSaveInterval",
                                Number.parseInt(e.target.value, 10)
                            )
                        }
                    />
                </div>
            </div>

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
