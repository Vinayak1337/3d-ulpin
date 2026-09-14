import { query } from "./db";
import { removeOrphan } from "./storage";

/** Remove only objects allocated by this attempt if its owning DB row was not saved. */
export async function originalAttempt<T>(
  table: "sources" | "area_acquisitions",
  id: string,
  action: (remember: (key: string) => void) => Promise<T>,
): Promise<T> {
  const keys: string[] = [];
  try {
    return await action((key) => keys.push(key));
  } finally {
    try {
      // The table is an application-controlled literal; IDs remain bound parameters.
      const saved = await query(`SELECT id FROM ${table} WHERE id=$1`, [id]);
      if (!saved.rows.length) for (const key of keys) await removeOrphan(key);
    } catch {
      // If commit state cannot be verified, retaining bytes is safer than deleting a possibly accepted original.
      console.warn(
        "Original cleanup could not verify the attempted write; source bytes were retained.",
      );
    }
  }
}
