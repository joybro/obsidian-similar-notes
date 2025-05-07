export class SimilarNote {
    constructor(
        public readonly title: string,
        public readonly path: string,
        public readonly similarPart: string,
        public readonly similarity: number
    ) {}
}
