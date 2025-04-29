export interface NoteChunkDTO {
    path: string;
    title: string;
    content: string;
    chunkIndex: number;
    totalChunks: number;
    embedding: number[];
}
