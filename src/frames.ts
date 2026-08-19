// Binary frames carry a one-byte tag so document updates and awareness
// (cursor/presence) share one socket without a second connection.
export const DOC_MSG = 0;
export const AWARE_MSG = 1;

export function tag(kind: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 1);
  out[0] = kind;
  out.set(payload, 1);
  return out;
}

export function untag(frame: Uint8Array): { kind: number; payload: Uint8Array } {
  return { kind: frame[0], payload: frame.subarray(1) };
}
