export class SimilarNote {
    constructor(
        public readonly title: string,
        public readonly path: string,
        public readonly similarity: number,
        public readonly similarChunk: string,
        public readonly sourceChunk: string
    ) {}
}
