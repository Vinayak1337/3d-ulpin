type RegisterMissingState = {
  geometryAvailable: boolean;
  staleDetailLinkCount: number;
  hasSpaces: boolean;
  hasConfirmedParcel: boolean;
};

/** Missing statements report the read's absences; they are not instructions to add sources or review records. */
export function registerMissing(state: RegisterMissingState): string[] {
  return [
    ...(!state.geometryAvailable ? [
      'Spatial analysis was not assessed because the checks needed to use the recorded shapes are unavailable. '
        + 'The kept shapes are available only for inspecting the source.',
    ] : []),
    ...Array.from({ length: state.staleDetailLinkCount }, () => 'A linked detailed representation changed.'),
    ...(!state.hasSpaces ? ['No source-linked detailed spaces have been recorded for this property.'] : []),
    ...(!state.hasConfirmedParcel ? ['No evidenced parcel association has been confirmed.'] : []),
  ];
}
