import type { ExtensionWorkOperationSummary, ExtensionWorkQueue } from './extension-work-queue';
import type {
  OfficialSourceOperationStore,
  OfficialSourceOperationSummary
} from './official-source-operation-store';

export type CollectorOperationSummary = ExtensionWorkOperationSummary | OfficialSourceOperationSummary;

export interface CollectorOperationReaderContext {
  workQueue: ExtensionWorkQueue;
  officialSourceOperations: OfficialSourceOperationStore;
}

export async function readCollectorOperation(
  context: CollectorOperationReaderContext,
  operationId: string
): Promise<CollectorOperationSummary | null> {
  const [browserOperation, officialOperation] = await Promise.all([
    context.workQueue.get(operationId),
    context.officialSourceOperations.get(operationId)
  ]);
  if (browserOperation && officialOperation) {
    throw new Error('collector_operation_identity_collision');
  }
  return browserOperation ?? officialOperation;
}
