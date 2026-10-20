/**
 * [MF-2] A route refused a quote because funding it would exceed the application's source-side
 * ceiling (`--max-funding-spend`), before anything was signed. Shared by every bridge route so the
 * CLI reports the amount the quote needed, whichever route quoted it.
 */
import { FundingError } from "machine-fetch";

export class FundingLimitError extends FundingError {
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
