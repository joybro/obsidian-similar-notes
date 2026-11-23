# Markdown splitter

## What

Notes are split into chunks by `MarkdownTextSplitter`
(`src/infrastructure/markdownTextSplitter.ts`), called from
`MarkdownNoteChunkingService`. It is a port of the `splitText` path of
LangChain's `RecursiveCharacterTextSplitter.fromLanguage("markdown")` from
`@langchain/textsplitters` 0.1.0 (MIT), which the plugin used before.

Algorithm (unchanged from the library):

1. Pick the first separator present in the text, in this order: `\n## `,
   `\n### `, `\n#### `, `\n##### `, `\n###### `, ` ```\n\n `, `\n\n***\n\n`,
   `\n\n---\n\n`, `\n\n___\n\n`, `\n\n`, `\n`, ` `, and finally `""` (single
   UTF-16 code units).
2. Split before each occurrence, so each piece keeps its separator at its
   start. Drop empty pieces.
3. Pieces shorter than `chunkSize` (measured with the length function, which is
   the embedding model's token count) are packed into chunks of at most
   `chunkSize`, carrying up to `chunkOverlap` of the previous chunk's tail into
   the next. Each chunk is trimmed; blank chunks are dropped.
4. A piece of `chunkSize` or more is split again with the remaining separators.

## Why a local port

The plugin only called `splitText`. The dependency brought `@langchain/core`,
`langsmith` and `zod` into the bundle (about 380 KB of the production
`main.js`) and six of the seven `npm audit --omit=dev` advisories. Upgrading to
`@langchain/textsplitters` 1.x would have kept the bundle weight.

## Invariant: identical chunks

Chunk boundaries decide what is embedded, so the port must produce exactly the
library's chunks; otherwise existing indexes would silently mix two chunkings.
`src/infrastructure/__tests__/markdownTextSplitter.test.ts` checks 200 cases
(40 generated markdown notes x 5 chunk size / overlap / length-function
settings, generator in `__tests__/fixtures/markdownCorpus.ts`) against chunk
counts and SHA-256 hashes recorded from `@langchain/textsplitters` 0.1.0.

Re-recording is needed only if the generator changes. Install
`@langchain/textsplitters@0.1.0` temporarily, run each case through
`RecursiveCharacterTextSplitter.fromLanguage("markdown", options).splitText`,
write the rows to `markdownSplitterExpected.json`, then uninstall it. Changing
the splitter's behavior on purpose is a different decision: it changes what is
indexed and needs a re-index plan, not a re-record.
