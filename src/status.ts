/** Canonical gRPC status codes (numeric). */
export enum GrpcStatusCode {
  OK = 0,
  CANCELLED = 1,
  UNKNOWN = 2,
  INVALID_ARGUMENT = 3,
  DEADLINE_EXCEEDED = 4,
  NOT_FOUND = 5,
  ALREADY_EXISTS = 6,
  PERMISSION_DENIED = 7,
  RESOURCE_EXHAUSTED = 8,
  FAILED_PRECONDITION = 9,
  ABORTED = 10,
  OUT_OF_RANGE = 11,
  UNIMPLEMENTED = 12,
  INTERNAL = 13,
  UNAVAILABLE = 14,
  DATA_LOSS = 15,
  UNAUTHENTICATED = 16,
}

const NAME_TO_CODE: Record<string, number> = Object.keys(GrpcStatusCode)
  .filter((k) => Number.isNaN(Number(k)))
  .reduce((acc, name) => {
    acc[name] = (GrpcStatusCode as any)[name] as number;
    acc[name.toUpperCase()] = (GrpcStatusCode as any)[name] as number;
    return acc;
  }, {} as Record<string, number>);

/** Parse a status code from number or A6-style name (`UNAVAILABLE` / `14`). */
export function parseStatusCode(code: string | number): number {
  if (typeof code === 'number' && Number.isFinite(code)) {
    return code;
  }
  const raw = String(code).trim();
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  const upper = raw.toUpperCase();
  if (upper in NAME_TO_CODE) {
    return NAME_TO_CODE[upper];
  }
  throw new Error(`Unknown gRPC status code: ${code}`);
}

export function parseStatusCodeList(
  codes: ReadonlyArray<string | number>
): Set<number> {
  return new Set(codes.map(parseStatusCode));
}
