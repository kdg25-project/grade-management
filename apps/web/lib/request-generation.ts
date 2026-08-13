/** True only for the most recently started request. */
export const isCurrentRequest = (responseGeneration: number, currentGeneration: number) => responseGeneration === currentGeneration;
