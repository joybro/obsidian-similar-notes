import { describe, expect, it, vi } from "vitest";
import { AsyncOperationGate } from "../AsyncOperationGate";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe("AsyncOperationGate", () => {
    it("drains admitted work and blocks later work during a transition", async () => {
        const gate = new AsyncOperationGate();
        const first = deferred<void>();
        const lifecycle = deferred<void>();
        const events: string[] = [];

        const active = gate.run(async () => {
            events.push("active-start");
            await first.promise;
            events.push("active-end");
        });
        const transition = gate.transition(async () => {
            events.push("transition-start");
            await lifecycle.promise;
            events.push("transition-end");
        });
        const laterOperation = vi.fn(async () => {
            events.push("later");
        });
        const later = gate.run(laterOperation);

        await Promise.resolve();
        await Promise.resolve();
        expect(events).toEqual(["active-start"]);
        first.resolve();
        await active;
        await vi.waitFor(() =>
            expect(events).toEqual([
                "active-start",
                "active-end",
                "transition-start",
            ])
        );
        expect(laterOperation).not.toHaveBeenCalled();

        lifecycle.resolve();
        await Promise.all([transition, later]);
        expect(events).toEqual([
            "active-start",
            "active-end",
            "transition-start",
            "transition-end",
            "later",
        ]);
    });

    it("releases queued operations when a transition fails", async () => {
        const gate = new AsyncOperationGate();
        const transition = gate.transition(async () => {
            throw new Error("failed");
        });
        const operation = gate.run(async () => "ready");

        await expect(transition).rejects.toThrow("failed");
        await expect(operation).resolves.toBe("ready");
    });

    it("permanently rejects operations admitted after close begins", async () => {
        const gate = new AsyncOperationGate();
        const active = deferred<void>();
        const running = gate.run(async () => active.promise);
        await Promise.resolve();
        await Promise.resolve();
        const closing = gate.close(async () => undefined);
        const late = gate.run(async () => "too late");
        const lateExpectation = expect(late).rejects.toThrow("closed");

        active.resolve();
        await running;
        await closing;
        await lateExpectation;
        await expect(gate.run(async () => "later")).rejects.toThrow("closed");
    });
});
