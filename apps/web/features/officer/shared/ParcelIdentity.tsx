import type { ParcelIdentifier } from "@ulpin/contracts";
/** Reuses evidenced parcel assertions in map, register and parcel inspector. */
export default function ParcelIdentity({
  identifiers = [],
}: {
  identifiers?: ParcelIdentifier[];
}) {
  return (
    <div className="ui-parcel-identity">
      <small>2D ULPIN</small>
      {identifiers.length ? (
        identifiers.map((item) => (
          <div key={`${item.parcelId}:${item.scheme}:${item.value}`}>
            <strong>{item.value}</strong>{" "}
            <span>
              {item.scheme === "demo_ulpin"
                ? "Demo · not officially issued"
                : "Source assertion"}
            </span>
          </div>
        ))
      ) : (
        <span>Not supplied</span>
      )}
    </div>
  );
}
