import { integrationBlocked } from "./integration-environment";
import { discoverIntegrationFiles, selectIntegrationSuite, validateIntegrationManifest } from "./integration-inventory";
import { integrationManifest, integrationProfiles } from "./integration-manifest";

const namedCampaigns = {
  "admin-event-operations": ["admin-external-queue-http", "admin-close-http"],
} as const;

export type CampaignSelection =
  | { suite: string }
  | { suites: readonly string[] }
  | { campaign: string }
  | { profile: keyof typeof integrationProfiles }
  | { all: true };

function campaignIds(selection: CampaignSelection) {
  if (Object.keys(selection).length !== 1) throw integrationBlocked("Use somente um modo de seleção.");
  let ids: readonly string[];
  if ("suite" in selection) ids = [selection.suite];
  else if ("suites" in selection) ids = selection.suites;
  else if ("all" in selection && selection.all === true) ids = integrationManifest.map(suite => suite.id);
  else if ("profile" in selection && Object.hasOwn(integrationProfiles, selection.profile)) {
    ids = integrationManifest.filter(suite => suite.profile === selection.profile).map(suite => suite.id);
  } else if ("campaign" in selection && Object.hasOwn(namedCampaigns, selection.campaign)) {
    ids = namedCampaigns[selection.campaign as keyof typeof namedCampaigns];
  } else throw integrationBlocked("Campanha desconhecida.");

  if (!ids.length || new Set(ids).size !== ids.length) throw integrationBlocked("Seleção vazia ou duplicada.");
  return ids;
}

export function selectCampaign(selection: CampaignSelection) {
  const suites = campaignIds(selection).map(selectIntegrationSuite);
  if (new Set(suites.map(suite => suite.profile)).size !== 1) throw integrationBlocked("Perfis incompatíveis.");
  return suites;
}

/** Internal inspection surface. It has no callers capable of opening a connection or launching a suite. */
export function inspectCampaign(selection: CampaignSelection) {
  if (validateIntegrationManifest(integrationManifest, discoverIntegrationFiles()).length) {
    throw integrationBlocked("Manifesto de integração divergente.");
  }
  return campaignIds(selection).map(id => {
    const suite = integrationManifest.find(item => item.id === id);
    if (!suite) throw integrationBlocked("Suíte de integração desconhecida.");
    const { profile, migration } = suite;
    return { id, profile, migration, profileEnabled: integrationProfiles[profile].enabled, runnable: false };
  });
}

export function refuseRealCampaign(): never {
  throw integrationBlocked("Execução PostgreSQL supervisionada indisponível nesta etapa.");
}
