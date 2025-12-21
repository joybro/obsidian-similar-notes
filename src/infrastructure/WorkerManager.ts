import * as Comlink from "comlink";
import log from "loglevel";

/**
 * Manages the lifecycle of web workers with Comlink integration.
 * Provides a unified interface for creating, managing, and disposing workers.
 */
export class WorkerManager<T> {
    private worker: Comlink.Remote<T> | null = null;
    private workerName: string;

    constructor(workerName: string) {
        this.workerName = workerName;
    }

    /**
     * Initialize a new worker instance
     * @param WorkerConstructor The worker constructor (e.g., InlineWorker)
     * @returns The initialized worker proxy
     */
    async initialize(WorkerConstructor: new () => Worker): Promise<Comlink.Remote<T>> {
        // Clean up existing worker if any
        await this.dispose();

        const WorkerWrapper = Comlink.wrap(new WorkerConstructor());
        // @ts-expect-error - Comlink typing issue with constructor proxy
        this.worker = await new WorkerWrapper();
        
        log.info(`${this.workerName} initialized`, this.worker);
        
        if (!this.worker) {
            throw new Error(`${this.workerName} not initialized`);
        }

        // Set log level if the worker supports it
        const worker = this.worker as unknown as { setLogLevel?: (level: log.LogLevelDesc) => Promise<void> };
        if (worker.setLogLevel && typeof worker.setLogLevel === 'function') {
            await worker.setLogLevel(log.getLevel()).catch((err: unknown) =>
                log.error(`Failed to set log level on ${this.workerName}`, err)
            );
        }

        return this.worker;
    }

    /**
     * Get the current worker instance
     * @throws Error if worker is not initialized
     */
    getWorker(): Comlink.Remote<T> {
        if (!this.worker) {
            throw new Error(`${this.workerName} not initialized`);
        }
        return this.worker;
    }

    /**
     * Check if worker is initialized
     */
    isInitialized(): boolean {
        return this.worker !== null;
    }

    /**
     * Ensure worker is initialized, throw error if not
     */
    ensureInitialized(): void {
        if (!this.worker) {
            throw new Error(`${this.workerName} not initialized`);
        }
    }

    /**
     * Update log level on the worker
     */
    async updateLogLevel(level: log.LogLevelDesc): Promise<void> {
        if (this.worker) {
            const worker = this.worker as unknown as { setLogLevel?: (level: log.LogLevelDesc) => Promise<void> };
            if (worker.setLogLevel && typeof worker.setLogLevel === 'function') {
                await worker.setLogLevel(level).catch((err: unknown) =>
                    log.error(`Failed to set log level on ${this.workerName}`, err)
                );
            }
        }
    }

    /**
     * Dispose the worker and clean up resources
     */
    async dispose(): Promise<void> {
        if (!this.worker) {
            return;
        }

        try {
            // Release the Comlink proxy
            if (this.worker[Comlink.releaseProxy]) {
                this.worker[Comlink.releaseProxy]();
            }
            
            this.worker = null;
            log.info(`${this.workerName} disposed`);
        } catch (error) {
            log.error(`Error disposing ${this.workerName}:`, error);
        }
    }
}