// Encode all 128 UUID bits; no truncation or collision-prone initials.
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function propertyIdentifier(uuid: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      uuid,
    )
  )
    throw new Error("Invalid property UUID");
  let value = BigInt(`0x${uuid.replaceAll("-", "")}`);
  let code = "";
  for (let i = 0; i < 26; i++) {
    code = alphabet[Number(value & 31n)] + code;
    value >>= 5n;
  }
  return `3DU-${code}`;
}
export function childCode(kind: "F" | "S", ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1)
    throw new Error("Invalid identity ordinal");
  return `${kind}${String(ordinal).padStart(3, "0")}`;
}
export function identityLevel(label: string): string {
  return label.trim() || "Unassigned";
}
