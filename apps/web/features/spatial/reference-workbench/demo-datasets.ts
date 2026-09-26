/** Historical URL aliases only. Packages and sample metadata were retired. */
const legacyDatasetHashes = {
  'lake-view': '94d6cd80cd0b2ac4c0d7b5abf6b01dc93a70e373e6e607aae3d746579beea087',
  'shiv-vihar': '2a1668dfe509b828ef8696f96eff3d024ef3eff61d8c3b5249b6911a433fdd39',
} as const;
export function demoDataset(id: unknown) {
  if (typeof id !== 'string' || !Object.hasOwn(legacyDatasetHashes, id)) return undefined;
  return { sha256: legacyDatasetHashes[id as keyof typeof legacyDatasetHashes] };
}
