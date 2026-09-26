import { useNavigate, useSearchParams } from 'react-router';
import { BatchesPage } from '../batches/BatchesPage';
import { AddFilesDialog } from './AddFilesDialog';

/** /studio/add-files: the dialog over Batches, so closing returns to the work list. */
export function AddFilesRoute() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (
    <>
      <BatchesPage />
      <AddFilesDialog batchId={params.get('batch')} onClose={() => navigate('/studio/work')} />
    </>
  );
}
