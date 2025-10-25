/**
 * Orama Worker Entry Point
 *
 * This file serves as a thin wrapper for the OramaWorker class,
 * exposing it via Comlink for use in a Web Worker context.
 *
 * The actual implementation is in OramaDatabase.ts, which allows
 * for easier testing without Worker-specific complexities.
 */

import * as comlink from "comlink";
import { OramaWorker } from "./OramaDatabase";

// Expose the worker class to Comlink
comlink.expose(OramaWorker);
