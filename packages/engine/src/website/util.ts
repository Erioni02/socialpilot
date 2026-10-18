export { AppError, badRequest, isSecretPath, notFound, SetupRequiredError } from "@socialpilot/core";

export function slugifyLite(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "change"
  );
}
