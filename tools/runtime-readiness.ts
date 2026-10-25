export type RequestSettlement = {
  pending: Map<unknown, string>;
  lastActivity: number;
};
/** Browser networkidle can stall after an ORB failure; use the actual terminal request events. */
export async function waitForSettledRequests(
  state: RequestSettlement,
  timeoutMs = 15000,
  quietMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.pending.size === 0 && Date.now() - state.lastActivity >= quietMs)
      return;
    await new Promise<void>((r) => setTimeout(r, 50));
  }
  throw Error(
    "Requests did not settle: " + [...state.pending.values()].join(", "),
  );
}
