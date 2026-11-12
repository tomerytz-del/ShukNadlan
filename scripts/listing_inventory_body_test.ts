import assert from "node:assert/strict";
import { readLimitedBody } from "../supabase/functions/listing-inventory-intake/body.ts";

function source(
  bytes: Uint8Array | null,
  contentLength: string | null,
  chunk = 0,
): { headers: { get(name: string): string | null }; body: ReadableStream<Uint8Array> | null } {
  return {
    headers: {
      get(name: string) {
        return name.toLowerCase() === "content-length" ? contentLength : null;
      },
    },
    body: bytes === null
      ? null
      : new ReadableStream<Uint8Array>({
        start(controller) {
          const step = chunk > 0 ? chunk : bytes.byteLength || 1;
          for (let i = 0; i < bytes.byteLength; i += step) {
            controller.enqueue(bytes.subarray(i, Math.min(i + step, bytes.byteLength)));
          }
          controller.close();
        },
      }),
  };
}

const aleph = new TextEncoder().encode("א");
assert.equal(aleph.byteLength, 2);
assert.equal("א".length, 1);

const tiny = await readLimitedBody(source(aleph, null), 1);
assert.equal(tiny.ok, false);
if (!tiny.ok) assert.equal(tiny.error, "payload_too_large");

const exact = await readLimitedBody(source(aleph, null), 2);
assert.equal(exact.ok, true);
if (exact.ok) assert.equal(exact.raw, "א");

let read = false;
const idle = new ReadableStream<Uint8Array>({
  pull(controller) {
    controller.close();
  },
});
const declared = await readLimitedBody({
  headers: { get: () => "50" },
  body: {
    getReader() {
      read = true;
      return idle.getReader();
    },
  } as ReadableStream<Uint8Array>,
}, 10);
assert.equal(declared.ok, false);
assert.equal(read, false);

const lying = await readLimitedBody(source(new Uint8Array(8), "2", 3), 4);
assert.equal(lying.ok, false);

const empty = await readLimitedBody(source(null, "0"), 10);
assert.equal(empty.ok, true);
if (empty.ok) assert.equal(empty.raw, "");

const badLen = await readLimitedBody(source(new Uint8Array([1]), "nope"), 10);
assert.equal(badLen.ok, false);

console.log("listing inventory body: ok");
