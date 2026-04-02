export const constants = {
  Z_BEST_COMPRESSION: 9,
  Z_BEST_SPEED: 1,
  Z_DEFAULT_COMPRESSION: -1,
} as const;

function unsupported(command: "gunzipSync" | "gzipSync"): never {
  throw new Error(
    `node:zlib ${command} is not available in the browser runtime. ` +
      "The just-bash browser bundle still imports node:zlib for gzip-related commands.",
  );
}

export function gunzipSync(
  _input: Uint8Array,
  _options?: { maxOutputLength?: number },
): Uint8Array {
  return unsupported("gunzipSync");
}

export function gzipSync(_input: Uint8Array, _options?: { level?: number }): Uint8Array {
  return unsupported("gzipSync");
}

const zlib = {
  constants,
  gunzipSync,
  gzipSync,
};

export default zlib;
