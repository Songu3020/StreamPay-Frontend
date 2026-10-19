import { formatBigInt, parseBigInt } from "@/lib/format-bigint";

export const STROOPS_PER_XLM = 10n ** 7n;

export interface MultiRecipientAllocationInput {
  recipient: string;
  percentage: number | string;
}

export interface MultiRecipientAllocation {
  recipient: string;
  percentage: number;
  amount: bigint;
}

function normalizePercentage(value: number | string): number {
  const numeric =
    typeof value === "string" ? Number(value.trim()) : Number(value);

  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(
      "Recipient percentage must be a finite non-negative number.",
    );
  }

  return numeric;
}

export function parseAmountToStroops(value: string | number | bigint): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Amount must be finite.");
    }

    const decimal = value
      .toFixed(7)
      .replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "")
      .replace(/\.$/, "");
    const parsed = parseBigInt(decimal, 7);
    if (parsed === null) {
      throw new Error(`Unsupported number amount: ${value}`);
    }
    return parsed;
  }

  const trimmed = String(value).trim();
  if (trimmed.length === 0) {
    throw new Error("Amount cannot be empty.");
  }

  if (/^\d+$/.test(trimmed)) {
    return BigInt(trimmed);
  }

  const parsed = parseBigInt(trimmed, 7);
  if (parsed === null) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }

  return parsed;
}

export function describeRate(
  amount: bigint | string | number,
  asset: string,
  windowSeconds: number,
): string {
  const normalizedAmount = parseAmountToStroops(amount);
  const seconds = Math.max(1, windowSeconds);
  const displayRate = Number(formatBigInt(normalizedAmount, 7)) / seconds;
  const formatted = displayRate
    .toFixed(7)
    .replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, "")
    .replace(/\.$/, "");
  return `${formatted} ${asset}/s`;
}

export function deriveAllocationAmounts(
  totalAmount: bigint | string | number,
  recipients: MultiRecipientAllocationInput[],
): MultiRecipientAllocation[] {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return [];
  }

  const total = parseAmountToStroops(totalAmount);
  if (total < 0n) {
    throw new Error("Total amount cannot be negative.");
  }

  const percentages = recipients.map(({ percentage }) =>
    normalizePercentage(percentage),
  );
  const rawBasisTotal = percentages.reduce(
    (sum, percentage) => sum + percentage,
    0,
  );

  if (rawBasisTotal <= 0) {
    throw new Error("Recipient percentages must sum to a positive value.");
  }

  const scaledBasis = percentages.map((percentage) =>
    Math.round(percentage * 1_000_000),
  );
  const sumBasis = scaledBasis.reduce((sum, basis) => sum + basis, 0);
  const allocations = scaledBasis.map((basis, index) => {
    const amount = (total * BigInt(basis)) / BigInt(sumBasis || 1);
    return {
      recipient: recipients[index].recipient,
      percentage: percentages[index],
      amount,
    };
  });

  const actualTotal = allocations.reduce(
    (sum, allocation) => sum + allocation.amount,
    0n,
  );
  const dust = total - actualTotal;
  if (dust !== 0n && allocations.length > 0) {
    allocations[allocations.length - 1].amount += dust;
  }

  return allocations;
}
