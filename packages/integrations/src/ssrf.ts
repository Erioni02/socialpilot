import { isPublicIp } from "@sp/shared";

export function isPublicAddress(ip: string): boolean {
  return isPublicIp(ip);
}
