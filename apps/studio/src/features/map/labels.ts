export type LabelKind = 'selected' | 'hover' | 'space' | 'space-selected' | 'note' | 'code' | 'critical' | 'tick' | 'street';
export interface SceneLabel {
  id: string;
  text: string;
  kind: LabelKind;
}
