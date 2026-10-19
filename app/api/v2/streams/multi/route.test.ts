import { POST } from "@/app/api/v2/streams/multi/route";
import { encodeStellarPublicKey } from "@/app/lib/wallet-link";

function key(seed: number) {
  return encodeStellarPublicKey(new Uint8Array(32).fill(seed));
}

describe("POST /api/v2/streams/multi", () => {
  it("creates canonical per-leg stream records and keeps exact conservation", async () => {
    const req = new Request("http://localhost/api/v2/streams/multi", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        totalAmount: "100.0000000",
        token: "XLM",
        startTime: "2026-01-01T00:00:00.000Z",
        endTime: "2026-01-31T00:00:00.000Z",
        recipients: [
          { recipient: key(1), percentage: 33.3333 },
          { recipient: key(2), percentage: 33.3333 },
          { recipient: key(3), percentage: 33.3334 },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.legs).toHaveLength(3);
    expect(
      body.legs.reduce(
        (sum: bigint, leg: any) => sum + BigInt(leg.amount_raw),
        0n,
      ),
    ).toBe(1_000_000_000n);
    expect(body.legs.every((leg: any) => leg.schedule === "second")).toBe(true);
    expect(body.legs.every((leg: any) => leg.startTime && leg.endTime)).toBe(
      true,
    );
    expect(body.legs.every((leg: any) => /^\d+$/.test(leg.amount_raw))).toBe(
      true,
    );
    expect(
      body.legs.every(
        (leg: any) => typeof leg.rate === "string" && leg.rate.length > 0,
      ),
    ).toBe(true);
  });

  it("rejects invalid recipient keys without persisting any legs", async () => {
    const req = new Request("http://localhost/api/v2/streams/multi", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        totalAmount: "10",
        token: "XLM",
        recipients: [{ recipient: "not-a-key", percentage: 100 }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(422);
  });
});
