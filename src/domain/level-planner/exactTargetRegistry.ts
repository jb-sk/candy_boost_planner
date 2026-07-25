export type ExactLevelTarget = Readonly<{
  level: number;
  expInLevel: number;
}>;

const exactTargets = new Map<string, ExactLevelTarget>();

export function setExactLevelTarget(id: string, target: ExactLevelTarget): void {
  exactTargets.set(id, target);
}

export function getExactLevelTarget(id: string): ExactLevelTarget | undefined {
  return exactTargets.get(id);
}

export function pruneExactLevelTargets(validIds: ReadonlySet<string>): void {
  for (const id of exactTargets.keys()) {
    if (!validIds.has(id)) exactTargets.delete(id);
  }
}

export function clearExactLevelTargets(): void {
  exactTargets.clear();
}
