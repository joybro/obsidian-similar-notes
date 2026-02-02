# OpenAI Embeddings API Integration - Design Document

## Overview

Integrate OpenAI Embeddings API to support external embedding services. This provides an alternative for **mobile users** where the built-in model is too heavy to run effectively.

**Key Goals:**
1. OpenAI API integration
2. Usage tracking (token-based)
3. Internal optimizations to minimize unnecessary embedding generation
4. Automatic support for OpenAI-compatible servers (LM Studio, llama.cpp, etc.)

## Background

### User Needs

1. **Mobile users**: Built-in model (Transformers.js) is too heavy on mobile devices
2. **High-quality embeddings**: Users want to use OpenAI's text-embedding-3 models
3. **Local server users**: Some users run their own servers with LM Studio, llama.cpp, etc.

## UI Design

Maintain current settings UI structure while adding OpenAI options.

### Model Section

```
Model
══════════════════════════════════════════

┌─ Current model ───────────────────────────────┐
│ OpenAI: text-embedding-3-small                │
└───────────────────────────────────────────────┘

┌─ Model provider ──────────────────────────────┐
│ Choose between built-in models, Ollama,       │
│ or OpenAI API                      [OpenAI ▼] │
└───────────────────────────────────────────────┘

┌─ Server URL ──────────────────────────────────┐
│ URL of your OpenAI-compatible server          │
│ (default: https://api.openai.com/v1)          │
│                    [https://api.openai.com/v1]│
└───────────────────────────────────────────────┘

┌─ API Key ─────────────────────────────────────┐
│ Your OpenAI API key              [sk-••••••••]│
└───────────────────────────────────────────────┘

┌─ OpenAI model ────────────────────────────────┐
│ Select an OpenAI model for embeddings         │
│              [text-embedding-3-small ▼]       │
└───────────────────────────────────────────────┘

┌─ Test connection ─────────────────────────────┐
│ Test the connection to server and model       │
│                                        [Test] │
└───────────────────────────────────────────────┘

┌─ Apply model changes ─────────────────────────┐
│ No changes to apply                           │
│                              [Apply Changes]  │
└───────────────────────────────────────────────┘

┌─ API usage ───────────────────────────────────┐
│ Today:     45,678 tokens                      │
│ Total:    123,456 tokens                      │
│                                               │
│ Price per 1M tokens (optional): [$     0.02]  │
│ Estimated cost:                  ~$0.0025     │
│                                               │
│                              [Reset Stats]    │
└───────────────────────────────────────────────┘
```

**Note:** API usage section is only displayed when OpenAI provider is selected. Token tracking only works when API response includes `usage` field.

### Index Section

```
Index
══════════════════════════════════════════

┌─ Index statistics ────────────────────────────┐
│ • Indexed: 2091 notes (1991 chunks)           │
│ • Excluded: 7 files                           │
└───────────────────────────────────────────────┘

┌─ Indexing delay ──────────────────────────────┐
│ Wait time (seconds) after file changes        │
│ before indexing                        [   1] │
└───────────────────────────────────────────────┘

┌─ Reindex notes ───────────────────────────────┐
│ Rebuild the similarity index for all notes    │
│                                     [Reindex] │
└───────────────────────────────────────────────┘

... (existing settings remain)
```

**Indexing delay**: Applies to all providers. Users with paid APIs can increase this value to reduce costs.

## Usage Tracking

### Data Collection

Utilize the `usage` field from OpenAI API responses:

```json
{
  "data": [...],
  "usage": {
    "prompt_tokens": 8,
    "total_tokens": 8
  }
}
```

Track usage when `usage` field is present; skip tracking otherwise (some local servers may not include it).

### Data Structure

```typescript
interface UsageStats {
    // Daily accumulation
    daily: {
        [date: string]: {  // "2026-01-28"
            tokens: number;
            requestCount: number;
        };
    };

    // Total accumulation
    total: {
        tokens: number;
        requestCount: number;
        firstUseDate: string;
    };
}
```

### Cost Calculation

Price is **user-provided** (optional):

```typescript
interface SimilarNotesSettings {
    // ...
    openaiPricePerMillionTokens?: number;  // User input, default: undefined
}

function estimateCost(tokens: number, pricePerMillion?: number): string | null {
    if (!pricePerMillion) return null;

    const cost = (tokens / 1_000_000) * pricePerMillion;
    return `~$${cost.toFixed(4)}`;
}
```

**Rationale:**
- OpenAI pricing can change
- Hardcoding requires plugin updates when prices change
- Users can check actual costs on OpenAI dashboard using token count

## Internal Optimizations

Automatically applied to all providers. No user configuration required.

### 1. Smart Change Detection

Skip re-indexing for insignificant changes:

```typescript
function isSignificantChange(oldContent: string, newContent: string): boolean {
    // Compare after whitespace normalization
    const normalizedOld = oldContent.replace(/\s+/g, ' ').trim();
    const normalizedNew = newContent.replace(/\s+/g, ' ').trim();

    if (normalizedOld === normalizedNew) {
        return false;  // Only whitespace changed
    }

    // Calculate change ratio
    const lengthDiff = Math.abs(oldContent.length - newContent.length);
    const changeRatio = lengthDiff / Math.max(oldContent.length, 1);

    if (changeRatio < 0.02) {  // Less than 2% change
        return false;
    }

    return true;
}
```

**Effect:**
- Whitespace/newline only changes → Skip
- 1-2 character typo fixes → Skip
- Actual content changes → Re-index

### 2. Incremental Indexing

Re-index only changed chunks instead of entire file:

```typescript
interface StoredChunk {
    path: string;
    chunkIndex: number;
    contentHash: string;  // Hash of chunk content
    embedding: number[];
}

async function indexNote(path: string, newContent: string): Promise<void> {
    const newChunks = await this.chunkingService.split(newContent);
    const existingChunks = await this.repository.getByPath(path);

    const chunksToEmbed: Chunk[] = [];
    const chunksToKeep: StoredChunk[] = [];

    for (const newChunk of newChunks) {
        const hash = computeHash(newChunk.content);
        const existing = existingChunks.find(
            e => e.chunkIndex === newChunk.chunkIndex && e.contentHash === hash
        );

        if (existing) {
            chunksToKeep.push(existing);  // Reuse
        } else {
            chunksToEmbed.push(newChunk);  // Needs new embedding
        }
    }

    if (chunksToEmbed.length > 0) {
        const embeddings = await this.embeddingService.embedTexts(
            chunksToEmbed.map(c => c.content)
        );
        // Save...
    }
}
```

**Example Effect:**
```
Scenario: 1 chunk modified in a file with 10 chunks

Before: 10 chunks embedded → ~2000 tokens
After:  1 chunk embedded  → ~200 tokens

Savings: 90%
```

## Architecture

### Component Structure

```
src/
├── adapter/
│   └── openai/
│       ├── OpenAIClient.ts           # HTTP client
│       ├── UsageTracker.ts           # Usage tracking
│       └── index.ts
├── domain/
│   └── service/
│       └── OpenAIEmbeddingProvider.ts
├── application/
│   └── NoteIndexingService.ts        # Smart change detection, incremental indexing
└── components/
    ├── OpenAISettingsSection.tsx
    └── UsageStatsSection.tsx
```

### Settings Structure

```typescript
interface SimilarNotesSettings {
    modelProvider: "builtin" | "ollama" | "openai";

    // OpenAI settings
    openaiUrl?: string;       // Default: "https://api.openai.com/v1"
    openaiModel?: string;     // Default: "text-embedding-3-small"
    openaiApiKey?: string;
    openaiPricePerMillionTokens?: number;  // Optional, for cost calculation

    // Indexing settings (all providers)
    indexingDelaySeconds?: number;  // Default: 1

    // Usage statistics (OpenAI)
    usageStats?: UsageStats;
}
```

## OpenAI-Compatible Servers

Implementing against OpenAI API automatically supports compatible servers:

| Server | URL | usage field |
|--------|-----|-------------|
| OpenAI | `https://api.openai.com/v1` | Yes |
| LM Studio | `http://localhost:1234/v1` | Yes |
| llama.cpp | `http://localhost:8080/v1` | Yes |
| Ollama | `http://localhost:11434/v1` | Yes |

**When using local servers:**
- Token tracking works the same (if usage field is present)
- Cost estimation only shows when price is entered

## Implementation Phases

### Phase 1: Basic Integration
1. Implement OpenAIClient
2. Implement OpenAIEmbeddingProvider
3. Settings UI
4. Connection test

### Phase 2: Usage Tracking
1. Implement UsageTracker
2. Save/load usage stats
3. Usage Statistics UI
4. Price input and cost calculation

### Phase 3: Internal Optimizations
1. Smart change detection
2. Incremental indexing (requires storing chunk hashes)
3. Add indexing delay setting

## References

- [Knowledge: OpenAI Compatible API](../../ai-workspace/knowledge/embeddings/openai-compatible-api.md)
- [OpenAI Embeddings API Reference](https://platform.openai.com/docs/api-reference/embeddings)
- [OpenAI Pricing](https://openai.com/pricing)
