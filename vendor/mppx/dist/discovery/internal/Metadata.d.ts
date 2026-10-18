/** Metadata retained by one explicitly configured payment handler. */
export type Offer = {
    _canonicalRequest: Record<string, unknown>;
    description?: string | undefined;
    intent: string;
    name: string;
};
/** Metadata retained by a single or composed payment handler. */
export type Metadata = Offer | {
    offers: readonly Offer[];
};
/** Returns every explicitly configured offer from discovery metadata. */
export declare function offers(metadata: Metadata): readonly Offer[];
/** Converts configured handler metadata into a discovery payment offer. */
export declare function paymentOffer(metadata: Offer): Record<string, unknown>;
/** Returns whether metadata represents a composed handler. */
export declare function isComposed(metadata: Metadata): metadata is Extract<Metadata, {
    offers: unknown;
}>;
//# sourceMappingURL=Metadata.d.ts.map