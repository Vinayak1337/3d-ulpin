import type { Metadata } from 'next';
import Explainer from '@/features/explainer/Explainer';

export const metadata: Metadata = {
  title: 'Inside 3D ULPIN · From evidence to record',
  description: 'An interactive walkthrough of local ML, spatial processing and evidence-linked 3D property records.',
};

export default function ExplainPage() {
  return <Explainer />;
}
