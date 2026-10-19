import { NextResponse } from "next/server";
import { getStore } from "@/app/lib/db";
import { errorResponse, ErrorCode } from "@/app/lib/errors/server";
import {
  deriveAllocationAmounts,
  describeRate,
  parseAmountToStroops,
} from "@/app/lib/multi-recipient";
import { validateCreateStreamBody } from "@/app/lib/stream-validation";
import { formatBigInt } from "@/lib/format-bigint";
import type { Stream } from "@/app/types/openapi";

function toCanonicalRateString(rateLabel: string): string {
  if (!rateLabel) return "0";
  const match = rateLabel.match(/^\s*([0-9]+(?:\.[0-9]+)?)\s*[A-Za-z/\s]*$/);
  if (!match) return rateLabel.trim();
  return match[1].trim();
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse(
      ErrorCode.BAD_REQUEST,
      "Request body must be valid JSON.",
      400,
    );
  }

  const totalAmount = body?.totalAmount ?? body?.amount ?? body?.total_amount;
  const recipients = Array.isArray(body?.recipients) ? body.recipients : [];
  const token =
    typeof body?.token === "string" && body.token ? body.token : "XLM";
  const startTime =
    typeof body?.startTime === "string"
      ? body.startTime
      : new Date().toISOString();
  const endTime =
    typeof body?.endTime === "string"
      ? body.endTime
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  if (
    typeof totalAmount === "undefined" ||
    totalAmount === null ||
    recipients.length === 0
  ) {
    return errorResponse(
      ErrorCode.BAD_REQUEST,
      "totalAmount and recipients are required.",
      422,
    );
  }

  const startMs = Date.parse(startTime);
  const endMs = Date.parse(endTime);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return errorResponse(
      ErrorCode.BAD_REQUEST,
      "startTime must be before endTime.",
      422,
    );
  }

  let allocations;
  try {
    allocations = deriveAllocationAmounts(totalAmount, recipients);
  } catch (error) {
    return errorResponse(
      ErrorCode.BAD_REQUEST,
      error instanceof Error ? error.message : "Invalid allocation request.",
      422,
    );
  }

  if (allocations.length === 0) {
    return errorResponse(
      ErrorCode.BAD_REQUEST,
      "At least one recipient is required.",
      422,
    );
  }

  const windowSeconds = Math.max(1, Math.round((endMs - startMs) / 1000));
  const { streamRepository } = getStore();
  const manifest: Array<Record<string, unknown>> = [];

  for (const allocation of allocations) {
    if (
      typeof allocation.recipient !== "string" ||
      !allocation.recipient.trim()
    ) {
      return errorResponse(
        ErrorCode.BAD_REQUEST,
        "Each recipient must include a recipient address.",
        422,
      );
    }

    const rateLabel = describeRate(allocation.amount, token, windowSeconds);
    const canonicalRate = toCanonicalRateString(rateLabel);
    const rawTotal = allocation.amount.toString();

    const legBody = {
      recipient: allocation.recipient,
      rate: canonicalRate,
      schedule: "second",
      token,
      startTime,
      endTime,
      totalAmount: rawTotal,
    };

    const validationErrors = validateCreateStreamBody(
      legBody as Record<string, unknown>,
    );
    if (validationErrors.length > 0) {
      return errorResponse(
        "VALIDATION_ERROR",
        "One or more fan-out legs failed validation.",
        422,
      );
    }

    const id = `stream-${crypto.randomUUID().slice(0, 8)}`;
    const stream: Stream = {
      id,
      recipient: allocation.recipient,
      rate: canonicalRate,
      schedule: "second",
      status: "draft",
      nextAction: "start",
      token,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      totalAmount: rawTotal,
      startTime,
      endTime,
    } as Stream;

    streamRepository.streams.set(id, stream);

    manifest.push({
      id,
      recipient: allocation.recipient,
      percentage: allocation.percentage,
      amount: formatBigInt(allocation.amount, 7),
      amount_raw: rawTotal,
      rate: canonicalRate,
      rateLabel,
      schedule: "second",
      startTime,
      endTime,
      totalAmount: rawTotal,
    });
  }

  return NextResponse.json(
    {
      legs: manifest,
      manifest,
      totalAmount: formatBigInt(parseAmountToStroops(totalAmount), 7),
      totalAmount_raw: parseAmountToStroops(totalAmount).toString(),
      token,
    },
    { status: 201 },
  );
}
