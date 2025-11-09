# Similar Notes for Obsidian

Find semantically similar notes using AI, directly on your device. Works on both desktop and mobile without external servers.

![Demo](images/demo.gif)

## Features

-   **Mobile & Desktop**: Works on iOS, Android, and all desktop platforms
-   **100% Private**: All processing happens locally on your device
-   **Built-in Models**: Uses Hugging Face models, no setup required
-   **Ollama Support**: Connect to custom models via Ollama (desktop only)
-   **No API Keys**: No ChatGPT, Claude, or cloud services needed

## How It Works

The plugin understands the meaning behind your content, not just keywords. As you write, it shows the 5 most similar notes at the bottom of your current note, excluding already-linked notes.

## Getting Started

1. Install the plugin
2. The default model will download automatically (one-time, ~30MB)
3. Your notes will be indexed in the background
4. Similar notes will appear at the bottom of your current note

Progress appears in the status bar.

## Model Options

### Built-in Models (Mobile & Desktop)

-   **Default**: `all-MiniLM-L6-v2` (English)
-   **Multilingual**: `paraphrase-multilingual-MiniLM-L12-v2`
-   **Custom**: Any Sentence Transformer model from Hugging Face

### Ollama (Desktop Only)

Connect to any Ollama embedding model on `localhost:11434`

> Changing models triggers re-indexing.

#### Known Issues with Ollama

**Ollama v0.12.5+ has known stability issues** that may cause embedding failures with error messages like:

- `500 Internal Server Error`
- `EOF` errors in Ollama logs
- Random failures even with small payloads

This is a [known bug in Ollama](https://github.com/ollama/ollama/issues/12585) affecting the llama.cpp backend. The plugin automatically detects safe payload sizes, but failures may still occur randomly.

**Workaround**: If you experience frequent failures, consider:
- Using the built-in Transformers.js models instead (more stable)
- Waiting for an Ollama update that fixes this issue
- Using an older Ollama version (< v0.12.5) if possible

The plugin will automatically use larger chunk sizes once Ollama releases a fix.

## Technical Details

-   **Transformers.js**: Runs Hugging Face models directly in Obsidian
-   **WebGPU**: GPU acceleration on desktop, automatic CPU fallback
-   **Orama**: Built-in vector database for fast search
-   **Web Workers**: All processing runs in background threads

## Multi-Device Usage

This plugin stores all data locally in IndexedDB, which is device-specific storage that **does not sync** across devices.

**What this means:**

-   Each device maintains its own independent index
-   Obsidian Sync, iCloud, Syncthing, or any other file sync tool will **not sync the plugin's data**
-   When you open your vault on a new device, the plugin will automatically index your notes from scratch

This is by design - IndexedDB provides fast, reliable local storage that doesn't interfere with vault syncing.

## License

[MIT](LICENSE)
