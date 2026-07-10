/**
 * Coordinates ordinary async operations with exclusive lifecycle transitions.
 * Operations admitted before a transition are drained; later operations wait
 * until the transition completes.
 */
export class AsyncOperationGate {
    private readonly activeOperations = new Set<Promise<unknown>>();
    private transitionTail: Promise<void> = Promise.resolve();
    private closedError?: Error;

    async run<T>(operation: () => Promise<T>): Promise<T> {
        if (this.closedError) throw this.closedError;
        const admissionBarrier = this.transitionTail;
        await admissionBarrier;
        if (this.closedError) throw this.closedError;

        const result = Promise.resolve().then(operation);
        this.activeOperations.add(result);
        void result.then(
            () => this.activeOperations.delete(result),
            () => this.activeOperations.delete(result)
        );
        return await result;
    }

    async transition<T>(operation: () => Promise<T>): Promise<T> {
        if (this.closedError) throw this.closedError;
        return await this.enqueueTransition(operation);
    }

    async close<T>(
        operation: () => Promise<T>,
        error = new Error("Async operation gate is closed")
    ): Promise<T> {
        if (this.closedError) throw this.closedError;
        this.closedError = error;
        return await this.enqueueTransition(operation);
    }

    private async enqueueTransition<T>(
        operation: () => Promise<T>
    ): Promise<T> {
        const previousTransition = this.transitionTail;
        const result = previousTransition.then(async () => {
            await this.waitForActiveOperations();
            return await operation();
        });
        this.transitionTail = result.then(
            () => undefined,
            () => undefined
        );
        return await result;
    }

    async waitUntilIdle(): Promise<void> {
        await this.transitionTail;
        await this.waitForActiveOperations();
    }

    private async waitForActiveOperations(): Promise<void> {
        while (this.activeOperations.size > 0) {
            await Promise.allSettled([...this.activeOperations]);
        }
    }
}
