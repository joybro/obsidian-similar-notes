# Phase 3 Part 2: Incremental Indexing (Future Implementation)

> DB 스키마 변경이 필요하여 별도 구현 예정

## Overview

변경된 청크만 재임베딩하여 API 비용 절감:
- 10개 청크 중 1개만 변경 시 90% 토큰 절감

## Files to Modify

- [IndexedDBChunkStorage.ts](../../src/infrastructure/IndexedDBChunkStorage.ts) - 스키마 마이그레이션
- [NoteChunk.ts](../../src/domain/model/NoteChunk.ts) - `contentHash` 필드 추가
- [NoteChunkDTO.ts](../../src/domain/model/NoteChunkDTO.ts) - `contentHash` 필드 추가
- [OramaDatabase.ts](../../src/adapter/orama/OramaDatabase.ts) - 해시 계산 및 저장
- [NoteIndexingService.ts](../../src/application/NoteIndexingService.ts) - 증분 인덱싱 로직

## Implementation Details

### 1. Content Hash Utility

Add to `src/utils/contentComparison.ts`:

```typescript
export async function computeContentHash(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
}
```

### 2. Schema Migration (IndexedDBChunkStorage.ts)

- `NoteChunkInternal`에 `contentHash?: string` 추가
- `version`을 1에서 2로 변경
- 선택적 필드이므로 데이터 마이그레이션 불필요

```typescript
export interface NoteChunkInternal {
    // ... existing fields ...
    contentHash?: string;  // NEW - optional for backward compatibility
}

// version = 2
```

### 3. Incremental Indexing Logic (NoteIndexingService.ts)

```typescript
private async processUpdatedNote(path: string) {
    // ... 기존 노트 조회 및 필터링 ...

    const splitted = await this.noteChunkingService.split(filteredNote);
    const existingChunks = await this.noteChunkRepository.getByPath(path);
    const existingChunkMap = new Map(
        existingChunks.map(chunk => [chunk.chunkIndex, chunk])
    );

    const chunksToEmbed: NoteChunk[] = [];
    const chunksToKeep: NoteChunk[] = [];

    for (const newChunk of splitted) {
        const newContentHash = await computeContentHash(newChunk.content);
        const existingChunk = existingChunkMap.get(newChunk.chunkIndex);

        if (existingChunk?.contentHash === newContentHash && existingChunk.embedding.length > 0) {
            chunksToKeep.push(existingChunk);  // 기존 임베딩 재사용
        } else {
            chunksToEmbed.push(newChunk);  // 새 임베딩 필요
        }
    }

    log.info(`[NoteIndexingService] ${chunksToKeep.length} reused, ${chunksToEmbed.length} to embed`);

    if (chunksToEmbed.length === 0) return;  // 모든 청크 재사용 가능

    // 변경된 청크만 임베딩 생성
    const newEmbeddedChunks = await Promise.all(
        chunksToEmbed.map(async (chunk) => {
            const textToEmbed = chunk.chunkIndex === 0
                ? `${chunk.title}\n\n${chunk.content}`
                : chunk.content;
            return chunk.withEmbedding(await this.embeddingService.embedText(textToEmbed));
        })
    );

    // 합치고 저장
    const allChunks = [...chunksToKeep, ...newEmbeddedChunks]
        .sort((a, b) => a.chunkIndex - b.chunkIndex);

    await this.noteChunkRepository.removeByPath(note.path);
    await this.noteChunkRepository.putMulti(allChunks);
}
```

## Testing

1. 기존 IndexedDB 데이터로 업그레이드 테스트 (v1 → v2)
2. 청크 추가/삭제/수정 시나리오 테스트
3. 로그에서 "X reused, Y to embed" 메시지 확인
