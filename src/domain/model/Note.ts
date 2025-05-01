export class Note {
    constructor(
        public readonly path: string,
        public readonly title: string,
        public readonly content: string,
        public readonly links: string[] // other note ids
    ) {}
}
