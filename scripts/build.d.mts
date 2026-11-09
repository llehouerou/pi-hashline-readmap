export function verifyBundle(input: { code: string; metafile?: { inputs?: Record<string, unknown> } }): void;
export function buildBundle(options?: {
  rootDir?: string;
  outDir?: string;
  verify?: (input: { code: string; metafile: any }) => void;
}): Promise<string>;
export function runBuildCli(deps?: {
  build?: () => Promise<unknown>;
  log?: { error(message: string): void };
}): Promise<number>;
