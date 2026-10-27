// Browser-only minimal Buffer surface: client.ts encodes chunks with
// Buffer.from(part).toString("base64"). Node has Buffer; browsers do not, so
// this side-effect module installs just that path (base64 only) when absent.
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.Buffer === "undefined") {
  g.Buffer = {
    from(data: Uint8Array): { toString(enc: string): string } {
      return {
        toString: (enc: string): string => {
          if (enc !== "base64") throw new Error("unsupported_encoding");
          let s = "";
          for (let i = 0; i < data.length; i += 0x8000) {
            s += String.fromCharCode(...data.subarray(i, i + 0x8000));
          }
          return btoa(s);
        },
      };
    },
  };
}
export {};
