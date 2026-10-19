import fc from "fast-check";
import {
  deriveAllocationAmounts,
  parseAmountToStroops,
} from "@/app/lib/multi-recipient";
import { encodeStellarPublicKey } from "@/app/lib/wallet-link";

function makeKey(seed: number) {
  return encodeStellarPublicKey(new Uint8Array(32).fill(seed));
}

describe("deriveAllocationAmounts", () => {
  it("keeps exact sums for percentage splits in stroops", () => {
    const total = 100n * 10n ** 7n;
    const allocations = deriveAllocationAmounts(total, [
      { recipient: makeKey(1), percentage: 33.3333 },
      { recipient: makeKey(2), percentage: 33.3333 },
      { recipient: makeKey(3), percentage: 33.3334 },
    ]);

    expect(allocations.map((a) => a.amount)).toHaveLength(3);
    expect(allocations.reduce((sum, a) => sum + a.amount, 0n)).toBe(total);
    expect(allocations.every((a) => a.amount >= 0n)).toBe(true);
  });

  it("converts decimal strings to stroops without float loss", () => {
    expect(parseAmountToStroops("922337203685.4775807")).toBe(
      BigInt("9223372036854775807"),
    );
    expect(parseAmountToStroops("100.01")).toBe(1_000_100_000n);
  });

  it("preserves conservation under property-based inputs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.bigInt({ min: 1n, max: 9_223_372_036_854_775_807n }),
        (count, total) => {
          const recipients = Array.from({ length: count }, (_, i) => ({
            recipient: makeKey(i + 10),
            percentage: Number(((i + 1) / count) * 100),
          }));

          const allocations = deriveAllocationAmounts(total, recipients);
          const sum = allocations.reduce((acc, item) => acc + item.amount, 0n);
          return sum === total;
        },
      ),
      { numRuns: 50 },
    );
  });
});
