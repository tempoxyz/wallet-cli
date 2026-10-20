/**
 * [MF-2] A route refused a quote because funding it would exceed the application's source-side
 * ceiling (`--max-funding-spend`), before anything was signed. Shared by every bridge route so the
 * CLI reports the amount the quote needed, whichever route quoted it.
 */
import { Funder } from "machine-fetch";

export class FundingLimitError extends Funder.FundingError {
  override readonly name: string = "FundingLimitError";
  /** The source debit the quote needs, fees and gas included, in atomic units. */
  readonly required: bigint;
  /** The source token the debit is in, when the route knows it. */
  readonly asset: string | undefined;

  constructor(required: bigint, limit: bigint, asset?: string) {
    super(`Funding needs ${required} atomic units of the source token, above the ${limit} allowed`);
    this.required = required;
    this.asset = asset;
  }
}

/**
 * [MF-2] A route refused a quote because the source account holds less of the source token than
 * the quote debits, before anything was signed. Without this, the route would sign a transaction
 * that reverts on chain, which a durable funder must treat as possibly having moved funds.
 */
export class SourceBalanceError extends Funder.FundingError {
  override readonly name: string = "SourceBalanceError";
  /** The source debit the quote needs, before gas, in atomic units. */
  readonly required: bigint;
  /** What the source account holds, in atomic units. */
  readonly held: bigint;
  readonly asset: string;

  constructor(required: bigint, held: bigint, asset: string) {
    super(`Funding needs ${required} atomic units of the source token; the wallet holds ${held}`);
    this.required = required;
    this.held = held;
    this.asset = asset;
  }
}
