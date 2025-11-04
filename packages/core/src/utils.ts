export function millisecondsSince(initialTime: number): number {
  return Math.round((performance.now() - initialTime) * 1000) / 1000;
}
