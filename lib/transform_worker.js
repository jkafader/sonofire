class TransformWorker {
    constructor() {
        this.worker = null;
        this.pendingTasks = new Map();  // taskId -> { resolve, reject }
        this.taskIdCounter = 0;
    }

    init() {
        if (this.worker) return;

        this.worker = new Worker('/lib/transforms/transform_worker_impl.js');

        this.worker.onmessage = (e) => {
            const { taskId, result, error } = e.data;
            const task = this.pendingTasks.get(taskId);

            if (!task) return;

            if (error) {
                task.reject(new Error(error));
            } else {
                task.resolve(result);
            }

            this.pendingTasks.delete(taskId);
        };

        this.worker.onerror = (e) => {
            console.error('Transform worker error:', e);
        };
    }

    async compute(transformType, inputData, params) {
        this.init();

        const taskId = this.taskIdCounter++;

        return new Promise((resolve, reject) => {
            this.pendingTasks.set(taskId, { resolve, reject });

            this.worker.postMessage({
                taskId,
                transformType,
                inputData,
                params
            });
        });
    }
}

export const transformWorker = new TransformWorker();
