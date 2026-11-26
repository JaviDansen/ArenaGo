import { createHash } from "node:crypto";
import { integrationBlocked } from "./integration-environment";
import { checkoutSchema } from "./integration-schema";
import { prepareStructuralReference } from "./integration-structural-reference";

type Approval = Readonly<{ source: string; sha256: string; kind: "synthetic" | "homologated" }>;
type ReferenceAuthority = Readonly<{
  approval(): Approval | undefined;
  readApprovedSource(source: string): Promise<Uint8Array>;
}>;

function freezeJson(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeJson);
    Object.freeze(value);
  }
  return value;
}

export async function loadCampaignReference(
  authority: ReferenceAuthority,
  purpose: "simulation" | "real",
  migrations = checkoutSchema().migrations,
) {
  try {
    const approved = authority.approval();
    if (!approved) throw new Error();
    const { source, sha256, kind } = approved;
    if (!source || !/^[a-f0-9]{64}$/u.test(sha256)
        || kind !== (purpose === "simulation" ? "synthetic" : "homologated")) throw new Error();

    // Hash and parse the same private copy. The adapter cannot swap this buffer after approval.
    const bytes = Buffer.from(await authority.readApprovedSource(source));
    if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error();
    const reference = freezeJson(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    const { postgresVersionNum } = prepareStructuralReference(reference, migrations);
    return Object.freeze({ sha256, postgresVersionNum, reference });
  } catch {
    throw integrationBlocked("Referência estrutural sem aprovação ou incompatível.");
  }
}

export type CampaignReferenceAuthority = ReferenceAuthority;
