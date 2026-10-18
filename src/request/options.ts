export type RequestOptions = {
  allowInsecurePayment?: boolean | undefined;
  bearer?: string | undefined;
  compressed?: boolean | undefined;
  data: string[];
  dataUrlencode: string[];
  dumpHeader?: string | undefined;
  dryRun?: boolean | undefined;
  followRedirects?: boolean | undefined;
  form: string[];
  get?: boolean | undefined;
  head?: boolean | undefined;
  headers: string[];
  includeHeaders?: boolean | undefined;
  insecure?: boolean | undefined;
  json?: string | undefined;
  connectTimeout?: number | undefined;
  maxRedirs?: number | undefined;
  maxTime?: number | undefined;
  method?: string | undefined;
  /** The explicit cap from `resolveMaxSpend`; payments apply `defaultMaxSpend` when unset. */
  maxSpend?: string | undefined;
  mach?: boolean | undefined;
  /** `--funding`; resolved with `fundingSetting`. */
  funding?: string | undefined;
  /** `--payment-network`: `tempo`, or a destination name such as `base`, to pay on; else ranked. */
  paymentNetwork?: string | undefined;
  /** `--max-slippage-bps` for Tempo DEX funding; `defaultMaxSlippageBps` when unset. */
  maxSlippageBps?: number | undefined;
  network?: string | undefined;
  noProxy?: boolean | undefined;
  output?: string | undefined;
  paymentIntent: PaymentIntent;
  paymentToken?: string | undefined;
  privateKey?: string | undefined;
  proxy?: string | undefined;
  referer?: string | undefined;
  remoteName?: boolean | undefined;
  requestHttp1?: boolean | undefined;
  requestHttp2?: boolean | undefined;
  retries?: number | undefined;
  retryAfter?: boolean | undefined;
  retryBackoffMs?: number | undefined;
  retryHttp?: string | undefined;
  retryJitter?: number | undefined;
  sse?: boolean | undefined;
  sseJson?: boolean | undefined;
  stream?: boolean | undefined;
  toon?: string | undefined;
  url: string;
  user?: string | undefined;
  userAgent?: string | undefined;
  writeMeta?: string | undefined;
};

export type PaymentIntent = "auto" | "session" | "charge";

export type RequestRunOptions = {
  stdout?: Pick<NodeJS.WriteStream, "write"> | undefined;
  stderr?: Pick<NodeJS.WriteStream, "write"> | undefined;
};
