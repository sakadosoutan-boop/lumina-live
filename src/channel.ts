export type ProgramChannel = Pick<
  BroadcastChannel,
  "postMessage" | "close" | "onmessage"
>;

/** Restricted/file origins can reject BroadcastChannel; file output also uses window.opener. */
export function createProgramChannel(): ProgramChannel {
  try {
    return new BroadcastChannel("lumina-program");
  } catch {
    return { onmessage: null, postMessage() {}, close() {} };
  }
}
