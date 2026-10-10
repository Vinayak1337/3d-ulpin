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
      'Spatial analysis not assessed: canonical geometry qualification is unavailable. '
        + 'Retained geometry is available for source inspection only.',
    ] : []),
    ...Array.from({ length: state.staleDetailLinkCount }, () => 'A linked detailed representation changed.'),
    ...(!state.hasSpaces ? ['No source-linked detailed spaces have been recorded for this property.'] : []),
    ...(!state.hasConfirmedParcel ? ['No evidenced parcel association has been confirmed.'] : []),
  ];
}
