import { registerAiTools } from "./ai";
import { registerBrandTools } from "./brand";
import { registerProjectTools } from "./project";
import { registerWebsiteTools } from "./website";

export { deps, loadProviders, setToolDeps } from "./deps";
export { saveProfileVersion, toProfileDTO } from "./brand";
export { testProviderConfig, type ProviderTestResult } from "./ai";

/** Tools shipped in Cycle 1. Later cycles add social, media, website-code and agent tools. */
export function registerCycle1Tools(): void {
  registerWebsiteTools();
  registerBrandTools();
  registerProjectTools();
  registerAiTools();
}
