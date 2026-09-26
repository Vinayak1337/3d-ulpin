import { useNavigate } from 'react-router';
import { BatchesPage } from '../batches/BatchesPage';
import { AddFilesDialog } from './AddFilesDialog';

/** /studio/add-files: the dialog over Batches, so closing returns to the work list. */
export function AddFilesRoute() {
  const navigate = useNavigate();
  return (
    <>
      <BatchesPage />
      <AddFilesDialog onClose={() => navigate('/studio/work')} />
    </>
  );
}
