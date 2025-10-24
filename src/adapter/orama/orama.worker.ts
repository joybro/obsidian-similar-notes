/**
 * Orama Worker Entry Point
 *
 * This file serves as a thin wrapper for the OramaWorker class,
 * exposing it via Comlink for use in a Web Worker context.
 *
 * The actual implementation is in OramaWorkerClass.ts, which allows
 * for easier testing without Worker-specific complexities.
 */

import * as comlink from "comlink";
import { OramaWorker } from "./OramaWorkerClass";

// Expose the worker class to Comlink
comlink.expose(OramaWorker);

// Export for tests - no issues since this is a separate entry point
export { OramaWorker };
