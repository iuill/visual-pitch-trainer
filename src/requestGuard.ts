export function createRequestGuard() {
  let generation = 0;
  return {
    begin() {
      const request = ++generation;
      return () => request === generation;
    },
    cancel() {
      generation++;
    },
  };
}
