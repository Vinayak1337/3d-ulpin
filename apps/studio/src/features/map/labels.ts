export type LabelKind = 'selected' | 'hover' | 'space' | 'space-selected' | 'note';
export interface SceneLabel {
  id: string;
  text: string;
  kind: LabelKind;
}
